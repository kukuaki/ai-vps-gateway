# GitHub Metadata Checklist

这份文件只记录建议值和人工操作步骤，不会自动修改 GitHub 设置。

## Suggested Repository Metadata

**Description**

> Local-first MCP gateway for AI-assisted VPS operations: SSH leases, project Runbooks, health checks, metrics, audit logs, and a macOS menubar client.

**Topics**

```text
aiops
claude
codex
devops
electron
mcp
mcp-server
operations
runbook
server-management
ssh
vps
```

Topics are intentionally lowercase and hyphenated. Keep the final list focused rather than adding every related keyword.

**Website**

```text
https://kukuaki.github.io/ai-vps-gateway/
```

## Project Website Deployment

The repository publishes the static project website from [`../../site/`](../../site/) through [`.github/workflows/deploy-pages.yml`](../../.github/workflows/deploy-pages.yml).

For the first deployment, a repository administrator must enable Pages once in **Settings** -> **Pages** and select **GitHub Actions** under **Build and deployment**. Later changes to `site/` on `main` deploy automatically. The workflow intentionally does not publish the application runtime, local SQLite data, credentials, or any `all-vps` source files.

## Social Preview

Use [`../../assets/social-preview.png`](../../assets/social-preview.png). It is a generated demo graphic and contains no runtime data. GitHub recommends a PNG, JPG, or GIF under 1 MB and a display size of at least 640x320; the project asset is 1280x640.

Manual path: repository **Settings** -> **General** -> **Social preview** -> upload the asset.

## Discussions

Enable Discussions only after the repository has a public README and a tested release. Suggested categories:

- Announcements: release notes and security notices;
- Q&A: setup and MCP client questions;
- Ideas: proposals that do not yet have an implementation;
- Show and tell: redacted demos and Runbook examples.

Do not use Discussions for vulnerability reports. Keep security reports private through GitHub Security Advisories.

## Promotion Boundary

- GitHub description, topics, templates, Discussions settings, and social preview are repository maintenance tasks.
- LinuxDo, V2EX, Reddit, Discord, and other community posts require human review and manual submission.
- Do not paste real VPS addresses, domains, screenshots, logs, or configuration snippets into promotional material.
- See [`COMMUNITY-RESEARCH.zh-CN.md`](./COMMUNITY-RESEARCH.zh-CN.md) for public demand signals and a manual posting order.
