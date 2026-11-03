# Changesets

Run `pnpm changeset` in a PR that changes the public surface, then commit the
generated file. `pnpm version` (changeset version) bumps `package.json` and
writes `CHANGELOG.md`.

Publishing is NOT wired: the package is `"private": true` until the owner says
yes, and `access` here stays `restricted` until then.
