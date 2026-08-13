# Official MCP Registry Readiness

## Current Decision

Do **not** publish this repository to the official MCP Registry yet.

The current MCP adapter is a local control client for a user's own gateway. It depends on local SQLite state, local SSH credentials, local `known_hosts`, and a loopback API. Publishing it as though it were a generic public server would create a misleading installation promise and could encourage unsafe credential handling.

The official Registry expects publicly installable server metadata, normally backed by a public npm package or public container. The Registry stores metadata, not the package artifact. Its preview status, namespace rules, immutable versions, and publication requirements can change; consult the official documentation before any publication:

- [Registry quickstart](https://modelcontextprotocol.io/registry/quickstart)
- [Registry overview](https://modelcontextprotocol.io/registry/about)
- [Registry FAQ](https://modelcontextprotocol.io/registry/faq)

## Required Work Before Reconsidering

1. Decide whether to publish a separate, narrowly scoped public MCP launcher or keep this as a local application-only MCP adapter.
2. Define a safe public installation contract that never bundles or requests the user's SSH private keys.
3. Create a public package with a stable `bin` entry point and versioned release artifacts.
4. Add the required `mcpName` namespace and a matching `server.json` only after the package identity is finalized.
5. Authenticate the publisher account manually; never commit npm tokens or Registry credentials.
6. Publish a test version and inspect the Registry response before enabling automated release publishing.

## Do Not Do Yet

- Do not set `private: false` just to satisfy the Registry.
- Do not add a fake `mcpName` or placeholder `server.json` to imply publication.
- Do not upload local configuration, server inventory, credentials, or screenshots.
- Do not run `npm publish` or `mcp-publisher publish` without an explicit release decision and authenticated account.
