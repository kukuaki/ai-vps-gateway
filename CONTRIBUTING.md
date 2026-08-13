# Contributing

感谢参与 AI VPS Gateway。项目优先保证本机安全边界、可审计行为和可恢复的运维流程。

## Before You Start

- Read [README.md](./README.md), [README.zh-CN.md](./README.zh-CN.md), and [SECURITY.md](./SECURITY.md).
- Do not use real VPS data, private keys, `.env` files, production SQLite databases, or real domains in tests, screenshots, or pull requests.
- Use `scripts/seed-demo-data.ts` or test fixtures with RFC 5737 addresses and `example.test` domains for demos.

## Local Checks

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run build:desktop-runtime
npm run check:release-safety
git diff --check
```

For a macOS package check, use a temporary output directory and inspect the artifact before sharing it:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --config.directories.output=/private/tmp/ai-vps-gateway-package-audit
```

## Change Guidelines

- Keep the gateway loopback-only unless a design review explicitly changes the threat model.
- Keep private keys and capability tokens opaque to WebUI/MCP responses.
- Preserve the one-active-session-per-VPS lease and its audit trail.
- Treat remote inventory as bounded metadata collection. Do not add config, environment, log, or credential reads casually.
- When updating `servers`, `services`, or `webEndpoints`, preserve the complete existing lists.
- Add a focused regression test for security, session, inventory, or data-model changes.
- Keep user-authored Runbooks and project notes separate from automatically discovered fields.

## Pull Requests

Describe the user-visible behavior, security impact, migration needs, and verification commands. If a change touches remote operations, include its failure and rollback behavior. Screenshots must use demo data only.

## Security Reports

Do not open a public issue for an exploitable credential or control-plane vulnerability. Follow [SECURITY.md](./SECURITY.md) and use a private GitHub security advisory.
