"""Anonymous per-browser sessions and request boundary checks. No accounts or tracking."""
from __future__ import annotations
import hashlib, hmac, os, secrets, time
from urllib.parse import urlsplit
from fastapi import HTTPException, Request

MODE = os.getenv('OPENREPLAY_MODE', 'local').lower()
if MODE not in {'local','web'}:
    raise RuntimeError('OPENREPLAY_MODE must be local or web')
_SECRET = os.getenv('OPENREPLAY_SECRET', '')
if MODE == 'web' and len(_SECRET) < 48:
    raise RuntimeError('Public deployment requires a high-entropy OPENREPLAY_SECRET (48+ characters)')
SECRET = _SECRET.encode() if _SECRET else secrets.token_bytes(32)
WEB_HOST = os.getenv('OPENREPLAY_HOSTNAME','').lower().strip()
if MODE == 'web' and (not WEB_HOST or '/' in WEB_HOST or ':' in WEB_HOST):
    raise RuntimeError('Set OPENREPLAY_HOSTNAME to a domain, e.g. replay.example.com')
COOKIE = 'openreplay_session'
SESSION_SECONDS = 8 * 3600 if MODE == 'web' else 12 * 3600

def sign(value: str) -> str:
    return hmac.new(SECRET, value.encode('ascii'), hashlib.sha256).hexdigest()

def new_session() -> str:
    payload = secrets.token_hex(24) + '.' + str(int(time.time()))
    return payload + '.' + sign(payload)

def session_id(cookie: str | None) -> str | None:
    if not cookie or len(cookie) > 200: return None
    parts = cookie.split('.')
    if len(parts) != 3: return None
    sid, ts, sig = parts
    if len(sid)!=48 or any(c not in '0123456789abcdef' for c in sid):return None
    try: age = time.time() - int(ts)
    except ValueError: return None
    if age < -60 or age > SESSION_SECONDS: return None
    if not hmac.compare_digest(sign(sid+'.'+ts), sig):return None
    return sid

def owner_hash(sid: str) -> str:
    return sign('owner:'+sid)

def csrf_value(sid: str) -> str:
    return sign('csrf:'+sid)

def valid_host(request: Request) -> bool:
    host=request.headers.get('host','').lower().rstrip('.')
    if MODE == 'local':
        name, sep, port = host.partition(':')
        if name not in {'127.0.0.1','localhost'}:return False
        return not sep or (port.isdecimal() and 8765 <= int(port) <= 8790)
    return host == WEB_HOST

def same_origin(request: Request) -> bool:
    origin=request.headers.get('origin')
    if not origin: return True
    try:
        url=urlsplit(origin)
        target=f'{url.hostname or ""}{":"+str(url.port) if url.port else ""}'.lower()
        if MODE == 'local': return url.scheme=='http' and target == request.headers.get('host','').lower()
        return url.scheme=='https' and target == WEB_HOST
    except ValueError: return False

def browser_allowed(request: Request) -> bool:
    site=request.headers.get('sec-fetch-site','')
    return site in {'','none','same-origin'}

def cookie_name(request: Request | None = None) -> str:
    # HTTP cookies are not port-scoped (RFC 6265). Suffix the port in local mode
    # so multiple local instances on 8765..8790 do not overwrite each other's session.
    if MODE == 'local' and request is not None:
        _, sep, port = request.headers.get('host', '').lower().rstrip('.').partition(':')
        if sep and port.isdecimal() and 8765 <= int(port) <= 8790:
            return f'{COOKIE}_{port}'
    return COOKIE

def require_session(request: Request, mutate: bool=False) -> str:
    sid=session_id(request.cookies.get(cookie_name(request)))
    if not sid: raise HTTPException(401,'Reload OpenReplay to initialize a private session')
    if mutate and not hmac.compare_digest(request.headers.get('x-openreplay-csrf',''), csrf_value(sid)):
        raise HTTPException(403,'Invalid request token')
    return sid

def set_cookie(response, cookie: str, request: Request | None = None):
    response.set_cookie(cookie_name(request),cookie,max_age=SESSION_SECONDS,httponly=True,secure=MODE=='web',samesite='strict',path='/')
