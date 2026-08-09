# Security Policy

## Scope

AI VPS Gateway is designed for a single local operator. It binds its API to
`127.0.0.1` and does not expose an internet-facing control plane.

## Secret handling

- Do not commit private keys, tokens, passwords, `.env` files, database dumps,
  or SSH configuration containing secrets.
- The gateway does not import or read private key contents. It validates only the metadata and permissions of a logical credential reference, then passes the restricted path to the local `ssh` process.
- The optional `all-vps` synchronizer reads only `VPS_INVENTORY.md` and `DOMAINS.md` from its configured source directory. It does not enumerate files or read `.key` files.
- Project runbooks are local operational notes. Keep passwords, tokens, private keys,
  complete environment variables, and sensitive business data out of them.
- The local SQLite data directory is created with mode `0700`; the database is
  set to `0600`.
- Remote commands require a per-VPS session lease. Command text and output are
  redacted before storage, with command records pruned after 90 days by default.
- `root` SSH records require a time-limited WebUI emergency-root grant. The
  grant, session, command, and expiry events are auditable.
- The command policy is a conservative denylist and warning layer. It is not a
  complete sandbox for arbitrary shell syntax or obfuscated commands.

## Reporting a vulnerability

Please open a private GitHub security advisory for this repository. Do not
include exploit details in a public issue before a fix is available.
