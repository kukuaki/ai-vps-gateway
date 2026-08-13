# Release Checklist

## Local Safety Gate

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run build:desktop-runtime`
- [ ] `npm audit --json` reports no known vulnerabilities
- [ ] `npm run check:release-safety`
- [ ] `git diff --check`
- [ ] Search the staged tree for `.env`, SQLite, private-key extensions, tokens, real addresses, and real domains
- [ ] Build the macOS artifact into a temporary output directory
- [ ] Inspect ZIP, unpacked app, and `app.asar` contents
- [ ] Run packaged `--mcp` mode against demo data only

## GitHub Release Gate

- [ ] Confirm the commit contains source and docs only, not `data/`, `credentials/`, `release/`, `dist/`, or local SQLite files
- [ ] Create release notes from `CHANGELOG.md`
- [ ] Upload only the inspected macOS DMG/ZIP and checksums
- [ ] Do not upload screenshots containing live infrastructure
- [ ] Verify the release page after upload

## Community Gate

- [ ] Review the relevant community rules
- [ ] Use the manual post draft and remove irrelevant sections
- [ ] State the local-only scope and same-user limitation
- [ ] Do not publish automatically or use bulk cross-posting
