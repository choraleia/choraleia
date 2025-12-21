# Security Policy

## Reporting Vulnerabilities
Please email security@example.com or use a private channel (do not open a public Issue).

## Supported Scope
- Latest commit on the main branch
- The two most recent released versions (after release)

## Sensitive Data
Terminal output is stored only in memory and not written to disk. Do not enter production secrets in sessions.

## Recommendations
- By default, bind the server to localhost only (`server.host: 127.0.0.1`).
- If you bind to a non-loopback address (for LAN access), use a firewall to restrict source access to the configured port.
- Configuration is loaded from `~/.choraleia/config.yaml` (`server.host`, `server.port`). Audit changes to this file in deployments.
