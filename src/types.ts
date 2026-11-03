// Wire DTOs, hand-written from the Statify OpenAPI 3.1 spec (`packages/contracts/
// openapi/v1.json` in the Statify repo) component schemas. Snake_case is kept
// from the wire; dates stay strings (`YYYY-MM-DD` calendar days, ISO 8601
// instants). Enum-ish fields are forward-compatible unions (`| (string & {})`):
// the known members still autocomplete, and a NEW server value widens to string
// instead of breaking a typed client.

/** A forward-compatible string union: the known members plus any future value. */
export type Open<T extends string> = T | (string & {})

/** A UTC calendar day, `YYYY-MM-DD`. */
export type IsoDate = string

// ---------------------------------------------------------------------------
// Errors (RFC 9457 problem document: the `Problem` schema)
// ---------------------------------------------------------------------------

/** Every stable problem `code` the v1 spec registers. Branch on these, never on `title`. */
export type ProblemCode = Open<
    | 'missing_credentials'
    | 'invalid_api_key'
    | 'unsupported_credential_type'
    | 'insufficient_scope'
    | 'workspace_required'
    | 'feature_not_enabled'
    | 'resource_not_found'
    | 'invalid_request'
    | 'idempotency_in_progress'
    | 'idempotency_key_reused'
    | 'rate_limited'
    | 'quota_exhausted'
    | 'internal_error'
>

/** One field-level validation failure. */
export interface FieldError {
    /** RFC 6901 JSON Pointer to the offending request field, e.g. `/limit`. */
    pointer: string
    /** Machine-readable per-field code (a zod issue code, or a named one), e.g. `too_big`. */
    code: string
    /** Human-readable explanation for this field. */
    message: string
}

/** An RFC 9457 problem document with the Statify `code` extension. */
export interface Problem {
    /** URI of the problem class; resolves to its docs page (`https://statify.now/docs/api/problems/<code>`). */
    type: string
    /** Short summary of the problem class. Never parse it: switch on `code`. */
    title: string
    /** The HTTP status, repeated from the response. */
    status: number
    /** Human-readable explanation of this occurrence. */
    detail?: string
    /** This occurrence, as `urn:request:<request_id>`. */
    instance: string
    /** Stable machine-readable problem code: the value SDKs branch on. */
    code: ProblemCode
    /** The `Request-Id` of the failing request: quote it to support. */
    request_id: string
    /** Field-level failures (present on some `invalid_request` problems). */
    errors?: FieldError[]
}

// ---------------------------------------------------------------------------
// Apps (`App`, `AppList`)
// ---------------------------------------------------------------------------

/** An app this workspace tracks. */
export interface App {
    /** The app's stable key in this workspace; every stats call names an app by it. Never changes. */
    slug: string
    /** Display name. */
    name: string
    /** App Store app id (Apple ID); null when not on the App Store. */
    apple_app_id: string | null
    /** App Store bundle id. */
    apple_bundle_id: string | null
    /** Google Play package name; null when not on Google Play. */
    play_package: string | null
    /** Microsoft Store product id; null when not on the Microsoft Store. */
    microsoft_product_id: string | null
    /** The app's public website host, used to match web analytics (GA4, Search Console). */
    web_domain: string | null
    /** The app's own MCP server URL, when it has one. */
    mcp_url: string | null
    /** npm packages counted for this app. */
    npm_packages: string[]
    /** PyPI packages counted for this app. */
    pypi_packages: string[]
}

/** The cursor envelope every `/v1` list answers. */
export interface ListEnvelope<T> {
    /** This page of results. */
    data: T[]
    /** True when another page follows this one. */
    has_more: boolean
    /** Opaque cursor for the next page (pass it as `after`); null on the last page. */
    next_cursor: string | null
}

/** One page of the workspace's tracked apps, in slug order. */
export type AppList = ListEnvelope<App>

// ---------------------------------------------------------------------------
// Stats (`AppStats`, `StatsPage`, `StatsSeries`, ...)
// ---------------------------------------------------------------------------

/**
 * The consumer metric groups a stats call can ask for.
 *
 * - `signups`: not collected yet; always answers a `not_synced` data gap.
 * - `new_users`: GA4 first visits to the app's website, NOT account signups. Its
 *   series label is always exactly
 *   `"visitors (GA4 first visits), ~2-day lag, quality=proxy — not signups"`
 *   (see {@link NEW_USERS_LABEL}) and its quality is always `proxy`.
 * - `traffic`, `usage`, `downloads`, `store_conversion`, `revenue`, `ratings`.
 */
export type AppStatsMetric = Open<
    | 'signups'
    | 'new_users'
    | 'traffic'
    | 'usage'
    | 'downloads'
    | 'store_conversion'
    | 'revenue'
    | 'ratings'
>

/**
 * The stores a series can come from (and the values the `store` filter accepts).
 * A series' own `store` may also be `total_all_stores` (see {@link SeriesStore}).
 */
export type AppStatsStore = Open<
    'apple' | 'play' | 'microsoft' | 'gsc' | 'bing' | 'ga4' | 'posthog' | 'ranks'
>

/**
 * The `store` of a series: one of {@link AppStatsStore}, or `total_all_stores` for
 * the one cross-store downloads total (present with two or more stores, at the
 * worst quality flag of its parts).
 */
export type SeriesStore = Open<AppStatsStore | 'total_all_stores'>

/**
 * How a series' `total` is formed:
 * - `sum`: volumes (downloads, visits), summed over the range;
 * - `mean`: daily active users and ratios, averaged, never summed;
 * - `latest`: stocks, the last day in the range;
 * - `ratio`: store conversion, downloads over the store's own denominator (named
 *   in `conversion_basis`).
 */
export type AppStatsAggregation = Open<'sum' | 'mean' | 'latest' | 'ratio'>

/**
 * The quality flag every number carries (store data law 5), best first:
 * - `exact`: the store's own exact count;
 * - `privacy_noised`: the store adds noise or thresholds small values (Apple);
 * - `lagged`: the source publishes late and may still revise recent days;
 * - `legacy_untrusted`: a legacy figure that can disagree with the store portal
 *   (Microsoft funnel numbers);
 * - `proxy`: a stand-in, not the thing itself (e.g. `new_users` = GA4 first
 *   visits, keyword ranks, package downloads).
 *
 * A series reports the WORST flag present in its range.
 */
export type FactQuality = Open<'exact' | 'privacy_noised' | 'lagged' | 'legacy_untrusted' | 'proxy'>

/**
 * Why a requested metric has no series (or one store has none):
 * - `not_synced`: no sync collects this metric yet (e.g. `signups`);
 * - `no_data`: nothing in the warehouse for this app (and store filter);
 * - `no_denominator`: a store has downloads but no impressions or page views to
 *   convert them on.
 */
export type AppStatsGapReason = Open<'not_synced' | 'no_data' | 'no_denominator'>

/** The only compare mode: the same number of days right before `from`. */
export type AppStatsCompareMode = Open<'previous_period'>

/** One day of a series. */
export interface StatsPoint {
    /** The UTC calendar day. */
    date: IsoDate
    /** That day's value. */
    value: number
}

/** One metric family of one app on one store. */
export interface StatsSeries {
    /** The metric group this series answers. */
    metric: AppStatsMetric
    /**
     * The canonical metric family (e.g. `downloads`, `ga4_new_users`,
     * `posthog_active_users`, `proceeds`, `store_conversion`).
     */
    family: string
    /** The source store, or `total_all_stores` for the one cross-store downloads total. */
    store: SeriesStore
    /**
     * What the number is, in words. `new_users` always reads
     * `"visitors (GA4 first visits), ~2-day lag, quality=proxy — not signups"`.
     */
    label: string
    /** How `total` is formed. See {@link AppStatsAggregation}. */
    aggregation: AppStatsAggregation
    /** The least trustworthy quality flag in the range (worst wins). See {@link FactQuality}. */
    quality: FactQuality
    /** The newest day this series holds at all. */
    latest_date: IsoDate
    /** The source's publishing lag: its newest days may still be revised. */
    lag_days: number
    /** `latest_date` minus `lag_days`: the last day the source considers final. */
    complete_through: IsoDate
    /**
     * True when nothing newer than `latest_date` arrived for more than 10 days:
     * read the series as historical, never as a fall to zero.
     */
    stale: boolean
    /** Days from `latest_date` to today (UTC). */
    days_stale: number
    /**
     * The range's value per `aggregation`, over the days up to `latest_date`;
     * null when the range holds no day.
     */
    total: number | null
    /**
     * The same over the previous period cut to the same number of days as this
     * series' own range (like for like); null without `compare` or without data.
     */
    compare_total: number | null
    /**
     * `total` vs `compare_total` in percent (2 decimals); null when either is null
     * or the previous value is 0.
     */
    change_pct: number | null
    /**
     * ISO currency of a `proceeds` (revenue) series. Revenue is one series per
     * currency, never converted or totalled across currencies. Null otherwise.
     */
    currency: string | null
    /**
     * What a `store_conversion` series divides downloads by (the store's own
     * definition, e.g. unique impressions on Apple, page views on Play); null
     * otherwise.
     */
    conversion_basis: string | null
    /**
     * The daily values, oldest first, ending on `latest_date` at the latest. A day
     * without data is omitted, never a zero.
     */
    points: StatsPoint[]
}

/** A requested metric this answer cannot give. */
export interface StatsDataGap {
    metric: AppStatsMetric
    /** Why. See {@link AppStatsGapReason}. */
    reason: AppStatsGapReason
    /** The store the gap is about; null when it is the whole metric. */
    store: string | null
}

/** The requested range. */
export interface StatsRange {
    /** First day, inclusive. */
    from: IsoDate
    /** Last day, inclusive. */
    to: IsoDate
    /** Days in the range. */
    days: number
}

/** The previous period (`compare=previous_period`). */
export interface StatsCompareRange {
    /** First day of the previous period. */
    from: IsoDate
    /** Last day of the previous period. */
    to: IsoDate
}

/** One app's series over the range (`GET /v1/apps/{slug}/stats`). */
export interface AppStats {
    /** The app's slug (see `GET /v1/apps`). */
    app: string
    range: StatsRange
    /** The previous period with `compare=previous_period`, else null. */
    compare: StatsCompareRange | null
    series: StatsSeries[]
    data_gaps: StatsDataGap[]
}

/** One app's series on a `GET /v1/stats` page. */
export interface AppStatsEntry {
    /** The app's slug (see `GET /v1/apps`). */
    app: string
    series: StatsSeries[]
    data_gaps: StatsDataGap[]
}

/** One page of apps, each with its series (`GET /v1/stats`). */
export interface StatsPage extends ListEnvelope<AppStatsEntry> {
    range: StatsRange
    /** The previous period with `compare=previous_period`, else null. */
    compare: StatsCompareRange | null
}

// ---------------------------------------------------------------------------
// Freshness (`Freshness`)
// ---------------------------------------------------------------------------

/** How old a source's data is. */
export interface FreshnessStaleness {
    /** The newest day of analytics data (money rows ride their own calendar). */
    latest_date: IsoDate
    /** Days from `latest_date` to today (UTC). */
    days_stale: number
    /** The source's publishing lag: being this many days behind is normal. */
    lag_days: number
    /**
     * True when nothing newer arrived for more than 10 days: read its windows as
     * historical, not as zeros.
     */
    stale: boolean
}

/** Freshness of one store across the workspace. */
export interface FreshnessStore extends FreshnessStaleness {
    store: string
    /** Apps with data from this store. */
    apps: number
    /** Analytics rows held for this store. */
    rows: number
}

/** Freshness of one app on one store. */
export interface FreshnessAppStore extends FreshnessStaleness {
    app: string
    store: string
}

/** Status of a sync run. */
export type SyncStatus = Open<'ok' | 'partial' | 'failed' | 'running'>

/** The last sync run of one adapter. */
export interface FreshnessSync {
    adapter: string
    /** `ok`, `partial`, `failed` or `running`. */
    status: SyncStatus
    /** ISO 8601 instant. */
    started_at: string
    /** ISO 8601 instant; null while running. */
    finished_at: string | null
    rows_written: number
    /** Hours since the run finished; null while running. */
    age_hours: number | null
}

/** How far the numbers can be trusted (store data law 5). */
export interface FreshnessQuality {
    /** Quality flags present in the warehouse. */
    flags: string[]
    /** What each source's numbers mean. */
    caveats: string[]
    notes: string[]
}

/** How current the workspace's data is (`GET /v1/freshness`). */
export interface Freshness {
    /** Today (UTC) as the answer saw it. */
    as_of: IsoDate
    /** Per store. */
    stores: FreshnessStore[]
    /** Per app x store (at most 200 rows, app then store order). */
    apps: FreshnessAppStore[]
    /** Tracked apps with no data from any source yet. */
    apps_with_no_data: string[]
    /** The last sync run per adapter. */
    syncs: FreshnessSync[]
    /** Stale sources, failed or stuck syncs: read these before any number. */
    warnings: string[]
    quality: FreshnessQuality
}

// ---------------------------------------------------------------------------
// Usage (`Usage`)
// ---------------------------------------------------------------------------

/** The current quota period: one UTC day. */
export interface UsagePeriod {
    /** Start of the period (00:00 UTC), ISO 8601. */
    start: string
    /** End of the period, exclusive (the next 00:00 UTC): the quota resets then. */
    end: string
}

/** The workspace's API usage in the current period (`GET /v1/usage`). */
export interface Usage {
    period: UsagePeriod
    /** Requests the workspace's keys made in the period. */
    used: number
    /** Requests allowed per period; null when the workspace is exempt. */
    limit: number | null
    /** Requests left in the period; null when the workspace is exempt. */
    remaining: number | null
    /** True when the workspace has no daily quota. */
    exempt: boolean
}

// ---------------------------------------------------------------------------
// Constants carried from the contract
// ---------------------------------------------------------------------------

/** The exact `label` of every `new_users` series: GA4 first visits, not signups. */
export const NEW_USERS_LABEL =
    'visitors (GA4 first visits), ~2-day lag, quality=proxy — not signups'

/** Every metric group, in the order the API lists them. Handy for `metrics: ALL_METRICS`. */
export const ALL_METRICS = [
    'signups',
    'new_users',
    'traffic',
    'usage',
    'downloads',
    'store_conversion',
    'revenue',
    'ratings',
] as const satisfies readonly AppStatsMetric[]

/** The caps a stats call is held to; over a cap is a 400 `invalid_request`, never a trimmed answer. */
export const STATS_CAPS = Object.freeze({
    /** `from`..`to` inclusive. */
    rangeDays: 366,
    metricGroups: 8,
    /** Every `points` entry of the whole answer (every app of a page), together. */
    points: 5_000,
    /** `GET /v1/stats` apps per page. */
    appsPerPage: 20,
})
