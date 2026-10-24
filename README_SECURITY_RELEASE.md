# OpenReplay — Security Release

**Use the included `DEPLOYMENT.md` for complete local setup, web hosting, GitHub, and privacy instructions.**

The replay features, CS2 parsing/output schema, visual layout, round navigation, utility effects, loadouts, and controls are inherited from OpenReplay v26. The security changes concern HTTP boundaries, anonymous session ownership, temporary-file handling, parser process isolation, and packaging.

## Protections implemented

- Host/Origin/Fetch-Metadata checks, anti-CSRF token on uploads/deletes, signed HttpOnly SameSite cookies (Secure in web mode)
- Anonymous per-browser replay authorization and short session lifetimes, with no login/Steam/Faceit account required
- Security response headers, API and replay no-store, no public API spec, and no permissive CORS
- Strict extension/header checks, streaming byte limit, per-IP/session request quotas, active job cap, temporary storage cap, sanitized error messages
- Child-process parsing with a hard timeout and original-upload deletion; web parser further isolated into a non-root, no-network worker container with a read-only root filesystem and resource caps
- Explicit automatic replay expiry (default 120 min), optional private DELETE endpoint, map URL allowlist/redirect denial and bounded downloads
- Version-pinned **direct** Python dependencies, dependency alerts, CI security tests, git exclusions, HTTPS reverse proxy and no public API port

## What this does not guarantee

It is not possible to guarantee no flaws or vulnerabilities. The parser is third-party native code and has not undergone independent penetration/fuzz tests here. Docker Compose could not be executed in the audit environment. A real CS2 `.dem` was not supplied for complete end-to-end testing. Public parser workers share a temporary job volume, and large or adversarial uploads can still require operational safeguards and tenant-specific isolation.

## Tests

- `python -m pytest -q` — original Python regression suite plus dedicated security cases
- `for f in tests/frontend*.cjs; do node "$f"; done` — original frontend logic suites
- Docker Compose, SSL, a real malicious demo corpus and Windows Installer testing require your deployment environment.
