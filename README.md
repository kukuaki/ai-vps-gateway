# AI VPS Gateway

[中文文档](./README.zh-CN.md)

Local-first VPS inventory, health monitoring, and MCP gateway for personal AI-assisted operations.

## Current scope

- Manual VPS inventory with local SQLite persistence.
- Network-safe liveness checks: TCP, SSH banner, and HTTP(S). ICMP is intentionally not required.
- Health history, audit events, archive and maintenance states.
- A local Vue WebUI bound to `127.0.0.1`.
- A read-only stdio MCP server for Codex and Claude Code.

The first release deliberately does **not** read, import, upload, or expose private keys. Remote write operations, credential isolation, session leases, and emergency-root controls are being added after the inventory and health layer is stable.

## Security model

- This repository must never contain private keys, `.env` files, access tokens, or production database dumps.
- The WebUI and API are loopback-only by default.
- MCP tools are read-only in `0.1.x`.
- A failed ICMP ping does not mark a VPS offline. SSH/TCP and configured service probes are authoritative.

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

Available tools in the first release: `list_servers`, `get_server`, and `get_dashboard`.

## License

[MIT](./LICENSE)
