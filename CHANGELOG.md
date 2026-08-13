# Changelog

All notable changes to this project are documented here.

## [0.1.1] - 2026-08-13

### Security And Reliability

- Added loopback API authentication, exact Host/Origin checks, health challenge proofs, and desktop IPC sender validation.
- Kept per-session capability tokens out of persistent storage and MCP responses; audit metadata now stores opaque command run IDs instead of command text.
- Serialized remote operations per VPS session and blocked session close or queue promotion while an operation is in flight.
- Preserved manual Runbooks and notes while refreshing automatically discovered inventory fields.
- Generalized Nginx and project discovery so shared reverse proxies are classified from runtime evidence rather than project-specific names.
- Added a repository-safe demo seed path, release checks, issue forms, and promotion drafts without publishing to third-party communities automatically.

## [0.1.0] - 2026-08-11

### Added

- Local-first macOS desktop client with WebUI, menubar resident, and stdio MCP support.
- Manual VPS registration with guided first-run Ed25519 SSH binding.
- TCP, SSH banner, HTTP(S), current metrics, 30-day history, trend charts, and deduplicated alerts.
- Project records with technology stacks, service managers, ports, Web endpoints, and five-part Runbooks.
- Read-only remote inventory for Docker, systemd, PM2/Node, listening ports, and filtered Nginx routes.
- Per-VPS exclusive sessions with queueing, idle expiry, maximum lease duration, and capability tokens.
- Local API authentication, exact loopback origin checks, command/output redaction, audit records, and a small irreversible-operation denylist.
- Demo data seed script and end-to-end MCP regression coverage.

### Security Notes

- Runtime databases, gateway tokens, SSH credentials, and host fingerprints remain outside the repository.
- MCP responses omit private key material, capability tokens, and internal credential references.
- The shell policy is a conservative guardrail, not a complete sandbox. Same-user macOS processes are outside the gateway's OS isolation boundary.
