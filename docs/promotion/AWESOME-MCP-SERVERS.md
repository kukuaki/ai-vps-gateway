# Awesome MCP Servers Submission Readiness

## Current Decision

Prepare the listing text, but do not open or submit a pull request automatically.

The curated list currently expects a public, usable MCP server entry and uses Glama-related discovery/introspection checks in its contribution workflow. This project can be evaluated only after its public installation story is clear and the local-only trust boundary is stated accurately.

## Proposed Listing

```markdown
- [AI VPS Gateway](https://github.com/kukuaki/ai-vps-gateway) - Local-first MCP gateway for AI-assisted VPS operations with per-VPS session leases, SSH credential custody, project Runbooks, metrics, liveness checks, and audit events. **[TypeScript] [macOS] [VPS] [DevOps]**
```

Before submission:

- confirm the repository's default branch and latest release are public;
- verify the README's install flow from a clean machine;
- confirm any Glama introspection result matches the actual tools and transport;
- remove claims that imply a public remote gateway or complete shell sandbox;
- read the current [CONTRIBUTING.md](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md) and submit one manual PR only.

## No Automated Posting

This file is a review artifact. It does not grant permission to fork, open a PR, comment, or post to any community. Human review is required immediately before submission.
