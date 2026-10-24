# Security policy

OpenReplay is a community project processing **untrusted Counter-Strike 2 demo files**.
Supported versions: latest security build only.

Please use GitHub's **Private vulnerability reporting** feature (Settings → Security → Private vulnerability reporting) after the repository owner enables it. Do not publicly publish exploit demonstrations or private replay contents before coordinated disclosure.

The local application is accessible only via localhost and has no account system. Public deployments must use the supplied HTTPS proxy, private API-only container networking, isolated no-network parser worker, and per-browser anonymous sessions. Production operators are responsible for TLS keys, OS patches, monitoring, backups, firewall, incident response, and user privacy disclosures.

Never include a real user demo or an `.env` secret in a bug report.
