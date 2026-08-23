"""Microsoft Entra ID (Azure AD) sign-in -- authorization-code + PKCE flow.

Fully wired end to end, but genuinely inert until AZURE_AD_TENANT_ID/
CLIENT_ID/CLIENT_SECRET/REDIRECT_URI are set (see app/core/auth_config.py):
is_sso_configured() is the single switch that gates the login route, the
session-enforcement middleware in app/main.py, and the frontend's login wall.
Until those creds land, the app behaves exactly as it does today -- open,
no login required.

No server-side session store: the "session" is a small JWT this backend
signs itself (HS256, app/core/auth_config.SESSION_SECRET_KEY) and hands back
as an httpOnly cookie. Matches the existing "flat, no extra infra" posture
(job_tracker.py is in-memory too) and is enough for 20-30 internal users on
one worker.
"""
import base64
import hashlib
import logging
import secrets
import time

import jwt
import requests
from jwt.algorithms import RSAAlgorithm

from app.core import auth_config

logger = logging.getLogger("resourceiq.auth")

_jwks_cache: dict = {}
_jwks_fetched_at: float = 0.0
_JWKS_TTL_SECONDS = 24 * 60 * 60


def is_sso_configured() -> bool:
    return auth_config.is_configured()


def generate_pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(40)).rstrip(b"=").decode("ascii")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    return verifier, challenge


def build_authorize_url(state: str, code_challenge: str) -> str:
    params = {
        "client_id": auth_config.CLIENT_ID,
        "response_type": "code",
        "redirect_uri": auth_config.REDIRECT_URI,
        "response_mode": "query",
        "scope": auth_config.SCOPE,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    query = "&".join(f"{k}={requests.utils.quote(v, safe='')}" for k, v in params.items())
    return f"{auth_config.AUTHORIZE_URL}?{query}"


def exchange_code_for_tokens(code: str, code_verifier: str) -> dict:
    resp = requests.post(
        auth_config.TOKEN_URL,
        data={
            "client_id": auth_config.CLIENT_ID,
            "client_secret": auth_config.CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": auth_config.REDIRECT_URI,
            "code_verifier": code_verifier,
            "scope": auth_config.SCOPE,
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def _get_jwks(kid: str | None) -> dict:
    global _jwks_cache, _jwks_fetched_at
    stale = time.time() - _jwks_fetched_at > _JWKS_TTL_SECONDS
    # Also refetch on a cache miss for the requested key -- Microsoft rotates
    # signing keys occasionally outside the normal TTL window.
    unknown_kid = kid is not None and kid not in _jwks_cache
    if not _jwks_cache or stale or unknown_kid:
        resp = requests.get(auth_config.JWKS_URL, timeout=10)
        resp.raise_for_status()
        _jwks_cache = {k["kid"]: k for k in resp.json().get("keys", [])}
        _jwks_fetched_at = time.time()
    return _jwks_cache


def validate_id_token(id_token: str) -> dict:
    """Verifies Microsoft's signature, issuer, audience and expiry, and
    returns the token's claims (oid, name, preferred_username/email, ...)."""
    header = jwt.get_unverified_header(id_token)
    jwks = _get_jwks(header.get("kid"))
    jwk = jwks.get(header.get("kid"))
    if not jwk:
        raise ValueError("Microsoft signing key not found for this token")
    public_key = RSAAlgorithm.from_jwk(jwk)
    return jwt.decode(
        id_token,
        public_key,
        algorithms=["RS256"],
        audience=auth_config.CLIENT_ID,
        issuer=auth_config.ISSUER,
    )


def create_session_token(claims: dict) -> str:
    email = claims.get("preferred_username") or claims.get("email") or ""
    now = int(time.time())
    payload = {
        "sub": claims.get("oid") or claims.get("sub"),
        "email": email,
        "name": claims.get("name"),
        "iat": now,
        "exp": now + auth_config.SESSION_MAX_AGE_SECONDS,
    }
    return jwt.encode(payload, auth_config.SESSION_SECRET_KEY, algorithm="HS256")


def decode_session_token(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        return jwt.decode(token, auth_config.SESSION_SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
