# @devinosolutions/statify-sdk

## 0.1.1

### Patch Changes

- The README's release section says new versions are published through npm Trusted Publishing,
  with no stored npm token. No code change.

## 0.1.0

First public release. Read-only client for the Statify public API
(`https://app.statify.now/v1`):

- `statify.apps.list()` / `listAutoPaging()`: the workspace's tracked apps, cursor-paged.
- `statify.apps.stats(slug, …)` and `statify.stats.list({ apps: 'all', … })` / `listAutoPaging()`:
  daily series and period totals for downloads, store conversion, revenue, ratings, traffic,
  usage and signups, each with its quality flag, lag and freshness; `compare: 'previous_period'`.
- Signups broken down by acquisition source with `by: 'source'` (`StatsSourceBreakdown`).
- `statify.freshness.get()` and `statify.usage.get()`: data freshness per source and the API quota.
- Typed RFC 9457 errors (`APIError` subclasses such as `QuotaExhaustedError` and `RateLimitError`,
  with `code`, `status` and `requestId`),
  automatic retries that honour `Retry-After`, timeouts and `AbortSignal`, and the
  rate-limit headers parsed on every response.
- Zero runtime dependencies; ESM and CommonJS builds with type declarations; Node.js >= 20.
