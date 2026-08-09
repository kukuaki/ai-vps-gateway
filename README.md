# AI VPS Gateway

[中文文档](./README.zh-CN.md)

Local-first VPS inventory, health monitoring, and MCP gateway for personal AI-assisted operations.

## Current scope

- Manual VPS inventory with local SQLite persistence.
- Synchronize VPS inventory and documented domain health checks from an existing `all-vps` directory.
- Network-safe liveness checks: TCP, SSH banner, and HTTP(S). ICMP is intentionally not required.
- Health history, audit events, archive and maintenance states.
- Project records linking VPS assets, Docker/systemd/process services, and structured runbooks.
- A local Vue WebUI bound to `127.0.0.1`.
- A local stdio MCP gateway for Codex and Claude Code. Read operations are available immediately; remote commands require an exclusive gateway session.

The gateway deliberately does **not** read, upload, or expose private key contents. Node resolves only a logical credential reference and lets the local `ssh` process read a key file from the gateway-owned credential directory; the explicit importer performs an opaque local file copy without parsing key bytes.

## Security model

- This repository must never contain private keys, `.env` files, access tokens, or production database dumps.
- The WebUI and API are loopback-only by default.
- MCP command execution is loopback-only and lease-based: one VPS has one active session, later sessions queue, idle sessions expire after 30 minutes, and every session has an eight-hour maximum by default.
- High-risk commands are recorded with a warning severity. A small absolute denylist blocks common root-directory recursive deletion, filesystem formatting, block-device writes, and fork-bomb patterns. This is a guardrail, not a complete shell sandbox.
- VPS records whose SSH user is `root` are enabled once from the WebUI for an eight-hour root-access window and a session is opened immediately. No per-command or per-session confirmation is required during that window; enabling, expiry, and revocation are audited.
- Command text and output are redacted before persistence and command records are pruned after 90 days by default. Asset/project summaries and audit events remain in local SQLite.
- A failed ICMP ping does not mark a VPS offline. SSH/TCP and configured service probes are authoritative.
- The `all-vps` synchronizer never reads private keys. Its sync operation preserves the local credential reference and emergency-root state.

## Requirements

- macOS or Linux
- Node.js 24+
- npm 11+

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

```bash
npm run typecheck
npm run test
npm run build
```

Runtime data is stored outside the repository by default:

```text
~/Library/Application Support/AI VPS Gateway/gateway.sqlite
```

Set `ALLVPS_DATA_DIR` to override it during development or testing.

SSH execution uses these local-only defaults:

```text
~/Library/Application Support/AI VPS Gateway/credentials/
~/.ssh/known_hosts
```

Put a user-managed key file in the credential directory, then set a VPS `credentialRef` to its filename only. The reference cannot contain a path. The gateway checks file metadata and permissions but never reads the key contents. Set `ALLVPS_CREDENTIAL_DIR` or `ALLVPS_KNOWN_HOSTS_FILE` to use another location. SSH host keys must already be present in `known_hosts`; the gateway refuses to silently trust a new host key.

## Synchronizing an Existing all-vps Inventory

The default local source is:

```text
~/Desktop/all-vps/VPS_INVENTORY.md
~/Desktop/all-vps/DOMAINS.md
```

Use the sync preview in the WebUI header, or run:

```bash
npm run sync:all-vps -- --dry-run
npm run sync:all-vps
```

Set `ALLVPS_SOURCE_DIR` to use another local directory. The synchronizer reads only those two Markdown documents. It does not scan the directory, read `.key` files, or import private keys, tokens, passwords, or environment variables.

Synchronization identifies an asset by SSH address and port, then updates documented identity, SSH login metadata, role, tags, access URL, and HTTP health checks. Local credential references and maintenance state are preserved. Assets removed from the source documents are shown in the preview and are never automatically archived. The WebUI validates the preview digest before applying a sync, so a changed source must be previewed again.

## Importing all-vps Credentials

This explicit local command is separate from Markdown synchronization. It only examines top-level `.key` and `.pem` filenames containing a registered VPS address, and requires exactly one match per VPS. It does not read, print, or upload key contents, delete the source file, overwrite an existing reference, or overwrite an existing gateway credential file.

```bash
npm run import:all-vps-credentials -- --dry-run
npm run import:all-vps-credentials
```

Imported copies are placed in `~/Library/Application Support/AI VPS Gateway/credentials/` with directory mode `0700` and file mode `0600`. The database stores only the logical filename.

## MCP

Start the local API first, then register the stdio adapter with your client:

```json
{
  "mcpServers": {
    "ai-vps-gateway": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/ai-vps-gateway", "run", "mcp"]
    }
  }
}
```

Available tools include `list_servers`, `get_server`, `get_dashboard`, `list_projects`, `get_project`, `list_sessions`, `open_session`, `get_session`, `run_command`, `close_session`, and `collect_metrics`.

The normal execution flow is: open a session, wait if it is queued, run commands through `run_command`, collect current metrics when needed, then close the session. A root VPS receives one eight-hour access window from the WebUI, then follows the same flow. The API and MCP adapter remain bound to `127.0.0.1`; the AI client receives neither a private key nor an unrestricted local SSH path.

Each project runbook has five sections: overview, deployment, verification, troubleshooting, and guardrails. It is stored in local SQLite and exposed to later AI sessions through read-only MCP queries. Do not put passwords, tokens, private keys, or complete environment variables in a runbook.

## License

[MIT](./LICENSE)
