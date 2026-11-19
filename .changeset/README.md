# Changesets

Run `pnpm changeset` in a PR that changes the public surface, then commit the
generated file. To release, run `pnpm changeset version` in a PR: it bumps
`package.json` and writes `CHANGELOG.md`. When that PR merges,
`.github/workflows/release.yml` publishes the new version to npm.
