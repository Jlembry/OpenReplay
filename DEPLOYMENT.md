# OpenReplay — secure local and web deployment guide

This repository contains **one unchanged replay interface** and two hosting modes:

- **Local:** run `start_windows.bat`; binds only `127.0.0.1` and runs native parsing in a child process.
- **Web:** deploy `deploy/compose.yaml`; Caddy handles HTTPS, the API accepts uploads, and a separate parser container has **no network access**. No users need accounts, Steam sign-in or Faceit sign-in.

**Security statement:** Hardened does NOT mean impossible to compromise. A malicious `.dem` exercises a third-party native parser. The hosted parser's read/write access to the shared temporary jobs volume is a residual risk. An independent penetration test, dependency audit, real-demo regression tests, backup/recovery exercise, and service-specific operational review are required for a higher-trust public launch. The Docker configuration has NOT been run in this test environment (Docker is unavailable here).

## Local version (Windows)

1. Download the `OpenReplay_Local_Secure.zip` artifact from an official GitHub Release; verify its SHA-256 against the checksum published separately on the release page. Avoid random third-party downloads.
2. Extract to an entirely new folder. Don't merge with a prior version.
3. Install **64-bit Python 3.11, 3.12, or 3.13** (`3.13` recommended; Python `3.14+` lacks prebuilt wheels for some pinned packages) from an official source; check `py -3.13 --version`.
4. Run `start_windows.bat`. The first run installs explicitly versioned packages into `.venv`; later launches reuse that environment. The terminal prints the actual localhost URL.
5. Use that URL, not an old bookmark. The app never binds to all network interfaces in local mode.
6. To fully stop it, use **Ctrl+C** in the terminal. The local process deletes its own temporary session storage when it exits normally, and job expiry cleans active sessions. A forced shutdown or power loss may leave orphaned OS temp data; it must be removed using OS cleanup tooling.

The local application makes HTTPS requests to GitHub Raw to retrieve radar metadata/images when available. Initial dependency installation accesses the configured Python package index. Demo uploads go to the local Python process; they do **not** get sent to that map host. The app doesn't request Steam/Faceit credentials or register users.

### Local risk limitations

- The local parser is a subprocess running under the **same Windows user**. This gives a time limit and crash isolation, but is **not** a full OS sandbox. Don't describe arbitrary `.dem` files as intrinsically safe. For stronger containment, use an isolated VM/non-admin user or a properly isolated sandbox.
- Use Windows Defender/OS patching and keep Python & dependencies updated. Do not run the app as Administrator.
- Session cookies and an anti-CSRF token prevent normal web pages from commanding the API; other local programs running as the same user remain in your threat model.

## Public website (Linux VPS + domain + Docker Compose)

**Recommended initial hosting:** an isolated Linux VM/VPS under your control with Docker Engine + Docker Compose v2, persistent disk, at least 4 vCPU and 8 GiB RAM for moderate test traffic. With a 900MB upload allowance, reserve substantial free storage and bandwidth; the service is not sized for arbitrary production traffic. Do not deploy it as a static-only site (e.g. GitHub Pages): parsing requires a backend worker.

### 1. Prepare the server

1. Register a domain/subdomain, e.g. `replay.example.com`, and create an **A (and, if configured, AAAA)** DNS record targeting your VPS.
2. Patch the host OS. Create a non-root operator account, enable SSH keys, disable password/root SSH login after verifying keys, and activate the host firewall.
3. Only expose inbound **22/TCP (ideally restricted to your IP), 80/TCP, 443/TCP and 443/UDP**. Never publish the Python API on 8000 or the Docker database/volume.
4. Install maintained Docker Engine and Compose following the official instructions. Restrict membership in the `docker` group: it effectively grants host root privileges.
5. Clone your own audited OpenReplay GitHub repository.

### 2. Configure secrets and domain

```bash
cd OpenReplay/deploy
cp .env.example .env
python3 -c 'import secrets; print(secrets.token_urlsafe(64))'
```

Edit `.env` and enter your real `OPENREPLAY_DOMAIN` and the generated value as `OPENREPLAY_SECRET`. Use one line each, no quotes or spaces. **Never commit `.env`**, screenshot it, or paste it into bug reports. Never use the placeholder or an ordinary password. Secure permissions:

```bash
chmod 600 .env
```

The secret signs short-lived browser sessions and anonymous replay ownership. Rotating it will immediately invalidate existing sessions; existing temporary replays cannot be opened with old cookies after rotation. For anonymous, no-login processing this is expected.

### 3. Build and start

```bash
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml build
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml ps
```

The `caddy` service acquires/renews TLS certificates for the configured domain. It publishes ports 80/443 only. `api` and `parser` share an ephemeral job volume; the parser has `network_mode: none`, read-only root filesystem, an unprivileged UID, dropped Linux capabilities, limited memory/CPU/process count and a per-job timeout. The API also runs non-root and is **not publicly port-mapped**. Only Caddy can reach it on its private Docker network.

### 4. Verify from another computer before sharing the URL

- Visit `https://replay.example.com` and check the valid certificate/lock icon. `http://` should redirect to HTTPS.
- In browser Developer Tools → Network, confirm `POST /api/demos` stays on **your domain**, and no network request sends a `.dem` to a third party. External radar downloads are server-side GitHub map requests.
- Inspect the `openreplay_session` cookie: **HttpOnly, Secure, SameSite=Strict**; check CSP/frame/no-sniff/referrer headers.
- Open the site in two fresh **different** browser profiles. Upload a dummy demo in one; confirm the other cannot retrieve its status/replay even if handed the job ID.
- Send invalid files, oversized/chunked multipart uploads, malformed demos and repeated uploads; verify rejection and that CPU/disk don't grow unbounded.
- Check containers: `docker compose ... ps`, `docker inspect` and `docker compose ... logs parser`. Ensure `api` port 8000 is not exposed externally; confirm parser has no network namespace/interface except loopback.
- Test an actual real `.dem` thoroughly: upload, parsing, weapons, kills, rounds, radar images, timeline and web speed. **This project has not been end-to-end tested with a real recording here.**
- Wait at least the configured retention interval (default **120 minutes**) and ensure replay JSON and original demos are deleted. Also test upload/worker crash/restart and disk saturation.
- Arrange an independent security review prior to announcing the service as production-ready.

### Anonymous privacy model

The website receives demos on **your server**. Processing is NOT exclusively client-side. The original `.dem` is deleted after parsing; the parsed JSON remains in temporary container storage for up to 120 minutes by default. Replay IDs are restricted to the uploader's anonymous signed-cookie session, and replay responses prohibit caching. Data is unencrypted at rest inside the isolated Docker volume (file permissions and host protections are essential). Do not promise zero data access: the site operator/host/root can access temporary files, and a native parser exploit remains possible.

A public privacy notice should say exactly that. If zero server possession of demos is a requirement, a future browser-side WebAssembly parser would require separate engineering work and validation.

### Operations and scaling

- `docker compose --env-file .env -f compose.yaml logs -f --tail=100 api parser caddy`
- `docker compose --env-file .env -f compose.yaml down` stops containers without removing volumes. **Do not** run `down -v` casually; it also removes Caddy certificate state and the temporary replay volume.
- Keep Docker/host/Caddy/Python patched. Monitor disk, CPU, memory, TLS certificate validity, abuse traffic, upload rates, and parser restarts.
- Do **not** simply add multiple API replicas. Rate limiting currently lives in-process and job coordination is optimized for a **single API and one parser**; scaling requires shared rate-limit accounting, resilient queueing and tenant-isolated workers.
- For true production isolation, replace the shared-volume worker with a new job-scoped disposable sandbox/VM per file. Run a load test on real recordings before setting allowed uploads and memory caps.

## Open-source GitHub release steps

1. Create a new public GitHub repo (for example `openreplay`), without an autogenerated README if uploading this full folder as-is.
2. In the extracted **source-repository** folder, run:

```bash
git init
git branch -M main
git add .
git status --short
git commit -m "Initial OpenReplay secure local and web release"
git remote add origin https://github.com/YOUR_USERNAME/openreplay.git
git push -u origin main
```

3. Confirm `.env`, `.venv`, `.dem`, `replay.json`, `status.json`, browser cookies, private keys, and temporary/cache data did **not** enter Git history. `.gitignore` helps, but **does not erase files already committed**.
4. Turn on GitHub **Dependabot alerts/security updates**, secret scanning/push protection if available, and private vulnerability reporting. Review CI's pip-audit and regression status. Add a LICENSE suitable for your goals (one is already bundled); do not change licenses casually.
5. Create signed/tagged releases; generate SHA-256 checksums of each downloadable ZIP and publish them in the release notes. GitHub source openness makes audits possible, not automatic proof of security.
6. Keep local and web release instructions separate. Document the web server's exact retention and third-party network requests in the public privacy policy.

## Known remaining security limitations (do not hide these)

1. A third-party **native** `.dem` parser hasn't been fuzz-audited here. Local subprocess isolation is not a full Windows sandbox. The public worker cannot access the internet, but **can access all temporarily queued replay files** on its shared volume.
2. Public per-IP/session upload limits live in memory and are designed for one API replica. They are not a full DDoS shield; a CDN/WAF, upstream traffic policing and network monitoring are additional options.
3. Top-level Python dependencies are version-pinned, but the complete transitive install is **not hash locked**. Run pip-audit, generate and test a full hash-locked requirements file, and review packages before claiming reproducibility/security assurance. Docker images are version-tagged, not yet pinned to validated digests.
4. Public infrastructure is unverified here because Docker, DNS, TLS provisioning and a real deployment weren't available. The web bundle is a self-hosting candidate, **not a formally certified zero-risk public service**.
5. Map radar metadata/images come from an external GitHub repository at runtime. A verified, bundled offline asset set would be stronger for supply-chain assurance.
6. Anonymous session cookies expire after eight hours; parsed data expires after 120 minutes. Session loss means losing access to that temporary replay, by design.
