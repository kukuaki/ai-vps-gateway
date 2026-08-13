# Community Post Drafts (Manual Review Only)

**Status: draft, never auto-post.** Before publishing, verify that the repository is public, the download link works, all screenshots are redacted, and the target community's rules allow the post.

## Short Launch Draft

### Title

AI VPS Gateway: a local-first MCP control plane for Codex and Claude Code

### Body

I built [AI VPS Gateway](https://github.com/kukuaki/ai-vps-gateway) to keep AI-assisted VPS operations behind a local control plane instead of handing an AI client an SSH private key.

The current local-only edition provides:

- stdio MCP tools for Codex and Claude Code;
- one active session per VPS, with queueing for later requests;
- gateway-owned SSH credentials and guided first-run public-key binding;
- TCP, SSH banner, and HTTP(S) liveness checks without relying on ICMP;
- current metrics, 30-day trends, threshold alerts, and high-risk audit events;
- project records with stacks, Docker/systemd/PM2 services, ports, Web endpoints, and five-part Runbooks;
- a macOS desktop client with a menubar resident and MCP setup flow.

The project is intentionally loopback-only and does not install a permanent agent on each VPS. Its command policy is a small irreversible-operation guardrail, not a complete shell sandbox; other processes under the same local OS user remain outside the gateway's isolation boundary.

The repository includes bilingual documentation, redacted demo data, and MCP end-to-end tests. Feedback on inventory ownership, shared Nginx routes, Runbooks, and safe local AI operations is welcome.
