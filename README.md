# OpenReplay — CS2 2D Demo Reviewer

![OpenReplay logo](static/openreplay-wide.png)

OpenReplay is an open-source, account-free Counter-Strike 2 demo reviewer with the existing v26 replay features and enhanced local/web privacy boundaries.

## Get started

**Windows local application:** Extract the local release archive, run `start_windows.bat`, then open the URL printed by the launcher. It binds to `127.0.0.1` only. No Steam/Faceit sign-in is required.

**Self-hosted public website:** Use the web archive and follow [DEPLOYMENT.md](DEPLOYMENT.md) to deploy Caddy (HTTPS), the private API, and the no-network parsing worker via Docker Compose. A static GitHub Pages site is not sufficient for this backend.

**Features:** 2D map and dual-floor radar playback, rounds and timeline, speed/zoom/pan, utility effects and trajectories, killfeed, independent player filters, player stats and full loadouts, bomb placement and timers, and radar drawing/selection. See [FEATURES_V26.md](FEATURES_V26.md) for extensive feature history.

## Privacy and trust

- **Local mode:** `.dem` is sent only to a server on your own machine. Radar assets may be fetched from GitHub; first-time Python dependency installation contacts your configured package index.
- **Web mode:** `.dem` is uploaded to the website operator's server for temporary parsing. The original is removed after processing; derived replay data expires within the configured retention window (default 120 minutes). Other anonymous browser sessions cannot fetch your replay by knowing its ID alone.
- Neither mode requires an account, Steam sign-in, or Faceit sign-in. No intentional analytics or advertising code is bundled.
- The parsed data may include player names and Steam IDs; treat it as private.

**The application is hardened, not guaranteed safe against every possible attack.** Native demo parsing remains a trust-sensitive dependency; Windows local subprocess isolation is not a complete OS sandbox, and the hosted worker shares a temporary volume across jobs. Read [README_SECURITY_RELEASE.md](README_SECURITY_RELEASE.md), [SECURITY.md](SECURITY.md), and [DEPLOYMENT.md](DEPLOYMENT.md) before distributing to others.

## Development tests

```bash
python -m pip install --only-binary=:all: -r requirements.txt pytest httpx
python -m pytest -q
for f in tests/frontend*.cjs; do node "$f"; done
```

The self-hosted production configuration requires separate live DNS/HTTPS/container testing and a real CS2 recording. No real `.dem` was supplied in the development environment.

## Open source

The source repository contains both runtime modes. Do not commit `.env`, `.venv`, temporary jobs, real replay JSON, `.dem` files, or private keys. GitHub CI checks regression tests and dependencies. Follow [DEPLOYMENT.md](DEPLOYMENT.md) for repository initialization and release instructions.
