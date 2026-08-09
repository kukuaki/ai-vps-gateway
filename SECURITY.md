# Security Policy

## Scope

AI VPS Gateway is designed for a single local operator. It binds its API to
`127.0.0.1` and does not expose an internet-facing control plane.

## Secret handling

- Do not commit private keys, tokens, passwords, `.env` files, database dumps,
  or SSH configuration containing secrets.
- The gateway does not read private key contents. Its explicit local importer copies an opaque, uniquely address-matched `.key` or `.pem` file into the protected credential directory without parsing or exposing its bytes. SSH validates the logical reference and reads the file only during a gateway session.
- The optional `all-vps` synchronizer reads only `VPS_INVENTORY.md` and `DOMAINS.md` from its configured source directory. It does not enumerate files or read `.key` files.
- Project runbooks are local operational notes. Keep passwords, tokens, private keys,
  complete environment variables, and sensitive business data out of them.
- The local SQLite data directory is created with mode `0700`; the database is
  set to `0600`.
- Remote commands require a per-VPS session lease. Command text and output are
  redacted before storage, with command records pruned after 90 days by default.
- `root` SSH records require one local WebUI action that enables an eight-hour
  root-access window and opens a session. The grant, session, command, and
  expiry events are auditable; individual commands do not require confirmation.
- The command policy is a conservative denylist and warning layer. It is not a
  complete sandbox for arbitrary shell syntax or obfuscated commands.
- SSH starts with a clean environment, disables `ProxyCommand` and `ProxyJump`,
  and supports binding a selected server to a physical interface. This is a
  routing control for the local gateway, not a guarantee that every operating
  system-level TUN route is changed.
- Remote project inventory is metadata-only and bounded. It must not be
  expanded to read configuration contents, environment variables, logs, or
  credentials without a separate security review.

## Reporting a vulnerability

Please open a private GitHub security advisory for this repository. Do not
include exploit details in a public issue before a fix is available.
