# OpenReplay web service — privacy notice template

**This is a technical draft, not legal advice. Before publishing, replace bracketed placeholders and confirm all claims against your actual hosting provider, logging, backups, CDN, malware scanning and jurisdiction.**

**Operator:** [site operator/business/contact email]
**Website:** [https://your-domain]
**Last updated:** [date]

## What we process

OpenReplay lets you upload a Counter-Strike 2 `.dem` recording without creating an account or signing into Steam/Faceit. We temporarily receive the recording and process it on our server to produce replay data, including gameplay events, player names, Steam IDs where recorded, positions and match information. The original demo is deleted after processing; derived replay data is retained in our temporary service storage for up to **120 minutes** by default and is then deleted by an expiry job.

We create a short-lived, HttpOnly, Secure, SameSite browser-session cookie to keep anonymous uploads private to the same browser session. This cookie is **not** an advertising or cross-site tracking cookie. Session access expires after roughly eight hours. We do not intentionally include advertising or behavior analytics code in the distributed application.

## Who can access this information

Our server processes the uploaded file. Other browser sessions cannot retrieve a replay solely using its ID without the matching anonymous session cookie. The operator/hosting platform administrators may be technically able to access temporary data as part of hosting, security and operations. Native demo parsing runs in a worker isolated from the network, but platform compromise is still possible; no system can promise complete protection.

## Other network services

Our hosted backend may request Counter-Strike radar images and calibration metadata from an external GitHub-hosted repository. Those requests do not include the uploaded demo. The site also relies on [list actual infrastructure/hosting/CDN/anti-abuse vendors] to deliver the service. Update this section before publishing, especially if Cloudflare, monitoring or analytics are added.

## Your controls

Uploaded replays are associated with anonymous, expiring browser access. A protected replay-deletion API is provided for integrated controls; the current UI does not expose a dedicated Delete Replay button. Closing the tab does not necessarily delete the server-side replay immediately; temporary files expire on the configured schedule. If you have a deletion/privacy request, contact [operator email].

## Security and legal notes

We use HTTPS, browser session protections, content restrictions, upload limits and a network-isolated parser worker. These measures reduce risk but cannot guarantee there are no vulnerabilities. The hosting operator must accurately disclose hosting locations, actual retention of infrastructure logs/backups, and applicable privacy rights, and maintain a tested incident response process.
