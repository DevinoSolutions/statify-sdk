# @statifynow/sdk

The official TypeScript SDK for the [Statify](https://statify.now) public API
(`https://app.statify.now/v1`). Read your workspace's app-store, web and product
analytics (downloads, store conversion, revenue, ratings, traffic, usage) with
typed responses, typed errors, automatic retries and cursor pagination.

- **Zero runtime dependencies.** Native `fetch`, `AbortSignal`.
- **Node.js >= 20.** ESM and CommonJS builds, full type declarations.
- **Read-only.** Every v1 operation is a `GET`, so every retry is safe.
- **Server-side only.** Your API key is a secret. The client throws if it
  detects a browser environment.

> **Private beta: not on npm yet.** The package is `"private": true` (so
> `npm publish` refuses it) and is published only once the owner says yes. The
> package name may still change before the first release; it lives in one
> place, `package.json`.

## Install

```bash
# Private beta: build a tarball from this repo and install that
pnpm install && pnpm build && pnpm pack          # -> statifynow-sdk-0.1.0.tgz
pnpm add /path/to/statifynow-sdk-0.1.0.tgz       # in your project

# Once published: npm install @statifynow/sdk
```

## Quickstart

```ts
import { Statify } from '@statifynow/sdk'

const statify = new Statify() // reads process.env.STATIFY_API_KEY

// Usage and downloads for every tracked app over October, vs September.
for await (const entry of statify.stats.listAutoPaging({
    apps: 'all',
    from: '2026-10-01',
    to: '2026-10-31',
    metrics: ['usage', 'downloads'],
    compare: 'previous_period',
})) {
    for (const s of entry.series) {
        console.log(entry.app, s.store, s.label, s.total, `${s.change_pct ?? '-'}%`, s.quality)
    }
    for (const gap of entry.data_gaps) console.log(entry.app, 'gap:', gap.metric, gap.reason)
}
```

## Authentication

Statify accepts a **workspace API key** (`sta_live_…`), sent on every request as
`Authorization: Bearer <key>` (default) or in the `x-api-key` header. Create keys
in the Statify app. OAuth access tokens are for the MCP server only; the REST
API refuses them with `unsupported_credential_type`.

```ts
// Explicit:
const statify = new Statify({ apiKey: 'sta_live_…' })

// Or omit it and the SDK reads process.env.STATIFY_API_KEY:
const statify = new Statify()

// Send it as x-api-key instead of a Bearer token:
const statify = new Statify({ authHeader: 'x-api-key' })
```

The key is held in a closure: it never appears in `JSON.stringify(client)`,
`util.inspect(client)`, thrown errors (even when the server echoes it), or debug
logs.

### Client options

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | `process.env.STATIFY_API_KEY` | Your `sta_live_…` key. Throws if unset. |
| `baseUrl` | `https://app.statify.now` | API origin (paths already include `/v1`). A path prefix is kept. |
| `timeoutMs` | `60000` | Per-attempt timeout. |
| `maxRetries` | `2` | Retries after the first attempt. `0` disables them. |
| `fetch` | `globalThis.fetch` | Override the fetch implementation. |
| `defaultHeaders` | `{}` | Headers sent on every request (they can never replace the key header). |
| `authHeader` | `'bearer'` | `'bearer'` or `'x-api-key'`. |
| `debug` | `false` | `true` logs to stderr; a function receives redacted log lines. Never headers or bodies. |
| `dangerouslyAllowBrowser` | `false` | Allow construction where `window` exists (not recommended). |

## Resources

```ts
// GET /v1/apps: the apps your workspace tracks, in slug order
const page = await statify.apps.list({ limit: 50 })
for await (const app of statify.apps.listAutoPaging()) console.log(app.slug, app.name)

// GET /v1/apps/{slug}/stats: one app
const stats = await statify.apps.stats('superbooks', {
    from: '2026-10-01',
    to: '2026-10-31',
    metrics: ['downloads', 'store_conversion', 'revenue'],
    store: 'apple', // optional: only this store's series
    compare: 'previous_period', // optional
})

// GET /v1/stats: several apps (apps: 'all' or a list), paged by app (max 20 per page)
const first = await statify.stats.list({ apps: ['superbooks', 'unotes'], from, to, metrics: 'usage,downloads' })

// GET /v1/freshness: how far each source's data reaches, last syncs, warnings
const freshness = await statify.freshness.get()

// GET /v1/usage: today's request count against the daily quota (never counted itself)
const usage = await statify.usage.get()
```

Every method takes a trailing `opts?` with `{ signal, timeoutMs, headers }`.
`metrics` takes an array or a comma-separated string; `ALL_METRICS` lists every
group.

### Caps

A range of at most **366 days**, at most **8 metric groups**, at most **5,000
points** per answer (every app of a page together), at most **20 apps** per
`/v1/stats` page. Over a cap is a `400 invalid_request` naming it, never a
trimmed answer (`STATS_CAPS` carries these numbers).

## Reading the numbers

Every series says what it is, how its total is formed and how far to trust it.

| Field | Meaning |
| --- | --- |
| `quality` | The worst quality flag in the range (see below). |
| `aggregation` | How `total` is formed: `sum` (volumes), `mean` (daily active users, ratios; never summed), `latest` (stocks: the last day in range), `ratio` (store conversion on `conversion_basis`). |
| `latest_date` / `lag_days` / `complete_through` | The newest day held, the source's publishing lag, and the last day the source considers final. Days after `complete_through` may still be revised. |
| `stale` / `days_stale` | `stale` is true when nothing newer arrived for more than 10 days: read the series as historical, never as a fall to zero. |
| `total` / `compare_total` / `change_pct` | The range's value, the previous period's (like for like), and the change in percent. Null when there is nothing to compare. |
| `points` | Daily values, oldest first. A day without data is omitted, never a zero. |
| `currency` | Revenue is one series **per currency**, never converted or totalled across currencies. |
| `store` | The source, or `total_all_stores` for the one cross-store downloads total (present with two or more stores, at the worst flag of its parts). |

### Quality flags

| Flag | Meaning |
| --- | --- |
| `exact` | The store's own exact count. |
| `privacy_noised` | The store adds noise or hides small values (Apple). |
| `lagged` | The source publishes late and may still revise recent days. |
| `legacy_untrusted` | A legacy figure that can disagree with the store portal (Microsoft funnel numbers). |
| `proxy` | A stand-in, not the thing itself: `new_users`, keyword ranks, package downloads. |

### `new_users` and `signups`

- **`new_users` is not signups.** It is GA4 first visits to the app's website,
  always `quality: 'proxy'`, and its label is always exactly
  `visitors (GA4 first visits), ~2-day lag, quality=proxy — not signups`
  (exported as `NEW_USERS_LABEL`).
- **`signups` is not collected yet.** Asking for it answers a `data_gaps` entry
  with `reason: 'not_synced'`, never an empty series.

Other gap reasons: `no_data` (nothing in the warehouse for this app and store
filter) and `no_denominator` (a store has downloads but nothing to convert them
on).

Enum fields are forward-compatible: a value the API adds later arrives as a
plain string instead of breaking your types or your parsing.

## Pagination

`list()` returns a `Page`. Iterate it with `for await` to walk **every** item
across all pages (the SDK sends `next_cursor` back as `after` for you, reusing
your original query), use `listAutoPaging()` for the same thing in one call, or
page manually.

```ts
// Every app across all pages:
for await (const app of statify.apps.listAutoPaging({ limit: 100 })) console.log(app.slug)

// Manual page control:
let page = await statify.stats.list({ apps: 'all', from, to, metrics: ['downloads'] })
console.log(page.range, page.compare) // shared by every page of a /v1/stats answer
while (page) {
    for (const entry of page.data) console.log(entry.app, entry.series.length)
    const next = await page.nextPage()
    if (!next) break
    page = next
}
```

> A cursor only works with the exact query that produced it. The SDK never
> changes your params while paging; don't hand a cursor to a different call.

## Errors

Every non-2xx response throws a typed error. The class is chosen by the problem
`code` first, falling back to the HTTP status for an unknown or absent code (so
a new server code never breaks your `instanceof` handling).

```ts
import {
    APIError,
    AuthenticationError,
    InvalidRequestError,
    NotFoundError,
    PermissionDeniedError,
    QuotaExhaustedError,
    RateLimitError,
} from '@statifynow/sdk'

try {
    await statify.apps.stats('superbooks', { from, to, metrics: ['downloads'] })
} catch (err) {
    if (err instanceof QuotaExhaustedError) {
        // The workspace's daily quota is spent; it resets at 00:00 UTC.
        console.log('quota back in', err.retryAfterSeconds, 's')
    } else if (err instanceof RateLimitError) {
        // Still over the per-key burst limit after the automatic retries.
    } else if (err instanceof InvalidRequestError) {
        console.log(err.detail, err.errors) // [{ pointer: '/to', code: 'too_big', message: '…' }]
    } else if (err instanceof APIError) {
        console.log(err.status, err.code, err.title, err.requestId)
    }
}
```

Every `APIError` carries `status`, `code`, `type` (the problem's docs URI),
`title`, `detail`, `requestId`, `errors` (field-level failures, `[]` when none),
`headers`, `retryAfterSeconds` and `rateLimit`. The `.message` is
`title: detail (request_id)` and never contains your API key. Quote the
`requestId` to support. All SDK errors extend `StatifyError`.

### Error code reference

| Code | Status | SDK error class |
| --- | --- | --- |
| `invalid_request` | 400 | `InvalidRequestError` |
| `missing_credentials` | 401 | `AuthenticationError` |
| `invalid_api_key` | 401 | `AuthenticationError` |
| `unsupported_credential_type` | 403 | `PermissionDeniedError` |
| `insufficient_scope` | 403 | `PermissionDeniedError` |
| `workspace_required` | 403 | `PermissionDeniedError` |
| `feature_not_enabled` | 403 | `PermissionDeniedError` |
| `resource_not_found` | 404 | `NotFoundError` |
| `rate_limited` | 429 | `RateLimitError` |
| `quota_exhausted` | 429 | `QuotaExhaustedError` |
| `internal_error` | 500 | `APIServerError` |

Transport-level failures throw `APIConnectionError` (with `cause`) or
`APITimeoutError`. (`idempotency_in_progress` / `idempotency_key_reused` exist in
the shared code registry but no read-only v1 operation returns them.)

## Retries

The SDK retries transient failures up to `maxRetries` times (default 2) after
the first attempt. Every v1 operation is a `GET`, so retrying is always safe.

**Retried:** connection errors · per-attempt timeouts · `408` · `429`
`rate_limited` (or a `429` with no known code) · `500` / `502` / `503` / `504`.

**Never retried:** `429` `quota_exhausted` (the daily quota is spent and its
`Retry-After` can be hours: you get a `QuotaExhaustedError` at once) · any other
`4xx` · requests you aborted with your own `signal` · a non-GET sent through
`statify.request()`.

**Backoff:** `Retry-After` is honored when present (delta-seconds and HTTP-date,
capped at 60 s); otherwise full-jitter exponential backoff,
`random(0, min(0.5 · 2^attempt, 8))` seconds.

## Rate limits and the daily quota

Two limits apply, and both answer `429` with `Retry-After`:

- **Per-key burst** (`rate_limited`): requests per minute per API key. The SDK
  waits and retries for you.
- **Per-workspace daily quota** (`quota_exhausted`): requests per UTC day across
  every key of the workspace; it resets at 00:00 UTC. Not retried.
  `statify.usage.get()` shows `used`, `limit` and `remaining`, and is never
  counted or refused by the quota.

Every counted response carries IETF draft-11 `RateLimit-Policy` / `RateLimit`
headers plus `X-RateLimit-Limit` / `-Remaining` / `-Reset`. Read them, together
with the `Request-Id`, through the raw escape hatch or on any error:

```ts
const { data, requestId, rateLimit } = await statify.request<Usage>({ path: '/v1/usage' })
rateLimit.policies // [{ name: 'per-key-minute', quota: 60, windowSeconds: 60 }, { name: 'per-workspace-day', … }]
rateLimit.current // { policy: 'per-key-minute', remaining: 42, resetSeconds: 60 }
rateLimit.remaining // X-RateLimit-Remaining
```

`statify.request()` takes `{ path, query?, headers?, signal?, timeoutMs? }`, uses
the same auth, retries and error mapping, and returns `{ data, response,
requestId, rateLimit, headers }`.

## Server-side only

The constructor throws when `window` is defined: an API key shipped to a browser
is a leaked key. Call Statify from your server, a worker or a script. Pass
`dangerouslyAllowBrowser: true` only behind a deliberate proxy setup.

## Development

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm build
pnpm smoke:dist # loads the built ESM + CJS entries against a mock fetch

# Opt-in live smoke test (read-only, a few requests against your quota; never in CI):
STATIFY_API_KEY=sta_live_… pnpm test:live
```

Changes to the public surface get a changeset (`pnpm changeset`). There is no
release workflow yet: it is added when the owner approves publishing.

## License

MIT © Devino Solutions
