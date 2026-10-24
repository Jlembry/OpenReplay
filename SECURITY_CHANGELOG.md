# Security hardening release: change log from v26

**Replay behavior was intentionally preserved.** Parser extraction logic and the core replay UI controls/layout remain from v26. New code affects API request validation, anonymous storage ownership, isolated parsing, retention and distribution.

## Implemented and tested

1. `security.py`: signed expiring anonymous browser cookie, HMAC scoped replay ownership, deterministic CSRF token, Host/Origin/Fetch-Metadata checks and domain-only web sessions.
2. `server.py`: loopback-only local launch, no public OpenAPI, no permissive CORS, CSP/frame/nosniff/referrer/permissions headers, conditional HSTS, private replay responses with no-store, upload size validation, rate limits and concurrency limits, independent cookie authorization for status/data/delete requests, short retention and janitor cleanup, sanitized parser errors, restrictive radar-download URL handling with no redirects.
3. `worker.py`: file-backed queue and parser subprocess with a wall-clock timeout. Original demo is unlinked after processing; parsing errors are not returned with local paths. In public mode the worker runs in an entirely separate container with disabled networking, non-root user, read-only base filesystem, limited CPU/RAM/PIDs and dropped capabilities.
4. Frontend: initialization of same-origin anonymous session and upload anti-CSRF token; web mode changes only privacy-status wording. Everything else about replay and controls remains as in v26.
5. `start_windows.bat`: always enters local mode, uses a venv with pinned top-level dependencies, and only accepts wheel downloads.
6. `deploy/`: Dockerfile, HTTPS Caddy reverse proxy, 900MB API body limits, a private API without published host ports, isolated worker, environment secret template and Compose resource limits.
7. GitHub packaging: `.gitignore`, `.dockerignore`, `SECURITY.md`, weekly Dependabot, CI tests and pip-audit, release guidance and privacy disclosures.

## Validation carried out in this workspace

- 70 passing Python tests (64 prior tests + 6 new security tests).
- 17 passing Node.js/frontend regression suites, syntax checks for app JS and Python modules.
- In-process web API test with HTTPS-origin session cookie, upload queue, anti-CSRF check and browser-origin denial.
- Browser UI smoke test using a file-based synthetic API stub: no page errors, intact headings, speed controls and scoreboard.
- Compose configuration parsed structurally as YAML and inspected for a non-public API and no-network parser.

## Verification not possible here

- Real CS2 demo and native `demoparser2` compatibility (no uploaded actual .dem file).
- Docker images building/running, Caddy configuration adapting, DNS issuance, TLS, real VPS firewall and real Windows launcher behavior (no deployment infrastructure available).
- Independent native-parser audit, systematic fuzzing, penetration test, denial-of-service load test, container escape assessment, third-party dependency vulnerability-proofing.

## Remaining concerns

- A local subprocess is **not** an OS sandbox. A vulnerable native parser running under the Windows user's privileges remains a security concern.
- Hosted parser workers do not have network access but **share one writable temporary job volume**. A worker process exploit could affect other temporary jobs; per-job ephemeral sandbox/VM isolation would be a significant further improvement.
- Rate limits are stored in process memory and support only one API replica. High-volume public launch needs stronger network/WAF controls and centralized queues/rates.
- Direct dependencies are pinned, not the complete transitive dependency graph with hashes; see deployment guide.
- Local map asset requests fetch from GitHub Raw; operator/host can view uploaded demos on public deployments. No absolute privacy or security guarantee is possible.
