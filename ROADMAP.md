# Roadmap

This roadmap describes the direction of a local-only AI operations gateway. It is intentionally conservative around credentials and remote change automation.

## Available Now

- Manual VPS inventory and guided SSH binding.
- Liveness checks that do not depend on ICMP.
- Current and historical performance panels with threshold alerts.
- Detailed project records, service/port inventory, and persistent Runbooks.
- One active AI session per VPS with queueing and audit events.
- Codex and Claude Code stdio MCP integration.
- macOS desktop packaging and menubar controls.

## Next

- Improve inventory confidence scoring and present ambiguous Nginx/upstream ownership for review.
- Add import adapters for common SSH managers, including Termius, without copying secrets into the repository.
- Add optional encrypted backup/export of local metadata with an explicit user-controlled destination.
- Add more focused Runbook templates for Docker Compose, systemd, PM2, Nginx, databases, and proxy nodes.
- Add signed, reproducible macOS release artifacts and a documented update channel.

## Later

- Optional multi-user mode with separate OS accounts and explicit RBAC.
- Optional remote control node for users who accept the additional trust and availability model.
- Public MCP distribution only after the local credential and transport contract has a safe, independently installable form.

## Deliberately Out Of Scope For The Local-Only Edition

- Publicly exposing the gateway API.
- Sending private keys or unrestricted local SSH access to an AI client.
- Installing a permanent agent on every VPS by default.
- Automatically deleting remote projects or shared Nginx/proxy infrastructure.
- Automatically posting to forums, social media, or community repositories.
