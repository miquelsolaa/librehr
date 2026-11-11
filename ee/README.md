# LibreHR Business (`ee/`)

Code in this directory is **not** AGPL. It is source-available under the [LibreHR Enterprise License](LICENSE). Everything outside `ee/` is the AGPL-3.0-or-later Community edition. The decision is recorded in [ADR 0004](../docs/adr/0004-open-core-licensing.md); the feature split is in [docs/editions.md](../docs/editions.md).

## What you may do without paying

- Read, run and change this code for development, testing and contributing.
- Evaluate it outside production for up to 30 days.

Production use (real employee data) needs a licence key or a LibreHR Cloud subscription.

## How it plugs in

- `ee/` packages may import `@librehr/core`, `@librehr/db` and `@librehr/contracts`.
- Nothing outside `ee/` imports this code, except the API extension loader (`apps/api/src/extensions/load.ts`) and API tests. Lint enforces it.
- Removing this directory must leave a working Community build.

## Licence keys

Licence keys are signed tokens checked **offline** against the public key in `ee/core/src/licensing/public-key.ts`. LibreHR never contacts a licence server. Set the key with the `LIBREHR_LICENSE_KEY` environment variable (see the [self-hosting guide](../docs/guides/self-hosting.md)). Without a valid key the instance runs as Community: no core feature and no data is ever locked.

## Contributing

Contributions here follow the same rules as the rest of the repository (`CONTRIBUTING.md`) and require agreeing to [CLA.md](../CLA.md).
