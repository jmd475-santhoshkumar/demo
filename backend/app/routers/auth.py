import logging
import secrets

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.core import auth_config
from app.services import auth_service

logger = logging.getLogger("resourceiq.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

_STATE_COOKIE = "sso_state"
_PKCE_COOKIE = "sso_pkce"


@router.get("/config")
def get_auth_config() -> dict:
    return {"sso_enabled": auth_service.is_sso_configured()}


@router.get("/login")
def login():
    if not auth_service.is_sso_configured():
        return RedirectResponse(f"{auth_config.FRONTEND_URL}/login?error=not_configured", status_code=302)

    state = secrets.token_urlsafe(24)
    verifier, challenge = auth_service.generate_pkce_pair()
    resp = RedirectResponse(auth_service.build_authorize_url(state, challenge), status_code=302)
    # Short-lived, single-use -- only alive for the round trip to Microsoft
    # and back, checked once in /callback below then discarded.
    resp.set_cookie(_STATE_COOKIE, state, httponly=True, secure=auth_config.COOKIE_SECURE, samesite="lax", max_age=600, path="/")
    resp.set_cookie(_PKCE_COOKIE, verifier, httponly=True, secure=auth_config.COOKIE_SECURE, samesite="lax", max_age=600, path="/")
    return resp


@router.get("/callback")
def callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return RedirectResponse(f"{auth_config.FRONTEND_URL}/login?error={error}", status_code=302)

    expected_state = request.cookies.get(_STATE_COOKIE)
    verifier = request.cookies.get(_PKCE_COOKIE)
    if not code or not state or not expected_state or state != expected_state or not verifier:
        return RedirectResponse(f"{auth_config.FRONTEND_URL}/login?error=invalid_state", status_code=302)

    try:
        tokens = auth_service.exchange_code_for_tokens(code, verifier)
        claims = auth_service.validate_id_token(tokens["id_token"])
        session_token = auth_service.create_session_token(claims)
    except Exception:
        logger.exception("Microsoft SSO callback failed")
        return RedirectResponse(f"{auth_config.FRONTEND_URL}/login?error=sso_failed", status_code=302)

    resp = RedirectResponse(auth_config.FRONTEND_URL, status_code=302)
    resp.delete_cookie(_STATE_COOKIE, path="/")
    resp.delete_cookie(_PKCE_COOKIE, path="/")
    resp.set_cookie(
        auth_config.SESSION_COOKIE_NAME,
        session_token,
        httponly=True,
        secure=auth_config.COOKIE_SECURE,
        samesite="lax",
        max_age=auth_config.SESSION_MAX_AGE_SECONDS,
        path="/",
    )
    return resp


@router.get("/me")
def me(request: Request) -> dict:
    claims = auth_service.decode_session_token(request.cookies.get(auth_config.SESSION_COOKIE_NAME))
    if not claims:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"email": claims.get("email"), "name": claims.get("name")}


@router.post("/logout")
def logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth_config.SESSION_COOKIE_NAME, path="/")
    return resp
