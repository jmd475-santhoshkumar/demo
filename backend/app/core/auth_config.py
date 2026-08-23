import os

from dotenv import load_dotenv

load_dotenv()

# Real values arrive once JMAN's Entra ID admin finishes the app
# registration -- until then every one of these is empty and
# auth_service.is_sso_configured() is False, which is the switch the rest of
# this feature (login page, session middleware) reads to fully no-op. Same
# "absent env var -> clean degrade" posture as AZURE_OPENAI_*/AZURE_DEVOPS_PAT.
TENANT_ID = os.environ.get("AZURE_AD_TENANT_ID", "")
CLIENT_ID = os.environ.get("AZURE_AD_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("AZURE_AD_CLIENT_SECRET", "")
# The app's own callback route, as reachable through the frontend's Next.js
# rewrite proxy (e.g. http://localhost:3000/api/auth/callback in dev) -- this
# exact value is what gets registered as the Redirect URI in the Entra ID app
# registration, since Microsoft only redirects back to a pre-registered URI.
REDIRECT_URI = os.environ.get("AZURE_AD_REDIRECT_URI", "")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")

# Signs the app's own short-lived session cookie (HS256, separate from
# Microsoft's tokens). Not required for SSO_configured -- if unset, a random
# key is generated once per process so the app still works, it just means
# every restart invalidates existing sessions (fine for a single-worker app
# that already accepts that trade-off elsewhere, e.g. app/core/job_tracker.py).
SESSION_SECRET_KEY = os.environ.get("SESSION_SECRET_KEY", "")
if not SESSION_SECRET_KEY:
    import secrets
    SESSION_SECRET_KEY = secrets.token_hex(32)

SESSION_COOKIE_NAME = "resourceiq_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 12  # 12h

# Cookies must be Secure over HTTPS but that flag makes browsers drop them
# entirely over plain http://localhost -- derive it from FRONTEND_URL instead
# of a separate flag so local dev and prod both just work.
COOKIE_SECURE = FRONTEND_URL.startswith("https://")

AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}" if TENANT_ID else ""
AUTHORIZE_URL = f"{AUTHORITY}/oauth2/v2.0/authorize"
TOKEN_URL = f"{AUTHORITY}/oauth2/v2.0/token"
JWKS_URL = f"{AUTHORITY}/discovery/v2.0/keys"
ISSUER = f"{AUTHORITY}/v2.0"
SCOPE = "openid profile email User.Read"


def is_configured() -> bool:
    return bool(TENANT_ID and CLIENT_ID and CLIENT_SECRET and REDIRECT_URI)
