# Security Policy

## Scope

AI VPS Gateway is designed for a single local operator. It binds its API to
`127.0.0.1` and does not expose an internet-facing control plane.

## Secret handling

- Do not commit private keys, tokens, passwords, `.env` files, database dumps,
  or SSH configuration containing secrets.
- The `0.1.x` release does not import or read private keys.
- The local SQLite data directory is created with mode `0700`; the database is
  set to `0600`.

## Reporting a vulnerability

Please open a private GitHub security advisory for this repository. Do not
include exploit details in a public issue before a fix is available.
