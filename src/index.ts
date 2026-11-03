// Public entry point of the Statify TypeScript SDK.

export { Statify, default } from './client'
export type { RawRequestOptions, StatifyOptions } from './client'

export { VERSION } from './version'

// Errors
export {
    APIConnectionError,
    APIError,
    APIServerError,
    APITimeoutError,
    AuthenticationError,
    ConflictError,
    InvalidRequestError,
    NotFoundError,
    PermissionDeniedError,
    QuotaExhaustedError,
    RateLimitError,
    StatifyError,
} from './core/errors'

// Pagination
export { Page } from './core/pagination'
export type { PageFetcher } from './core/pagination'
export { StatsListPage } from './resources/stats'

// Rate limits
export { parseRateLimit } from './core/rateLimit'
export type {
    RateLimitInfo,
    RateLimitPolicy,
    RateLimitState,
} from './core/rateLimit'

// Resource params and options
export type { AppStatsParams, ListAppsParams } from './resources/apps'
export type { RequestOptions } from './resources/common'
export type { ListStatsParams, StatsQueryParams } from './resources/stats'

// HTTP escape-hatch types
export type {
    APIResponse,
    AuthHeader,
    FetchLike,
    QueryParams,
    QueryValue,
} from './core/http'

// Constants
export { ALL_METRICS, NEW_USERS_LABEL, STATS_CAPS } from './types'

// Wire DTOs
export type {
    App,
    AppList,
    AppStats,
    AppStatsAggregation,
    AppStatsCompareMode,
    AppStatsEntry,
    AppStatsGapReason,
    AppStatsMetric,
    AppStatsStore,
    FactQuality,
    FieldError,
    Freshness,
    FreshnessAppStore,
    FreshnessQuality,
    FreshnessStaleness,
    FreshnessStore,
    FreshnessSync,
    IsoDate,
    ListEnvelope,
    Open,
    Problem,
    ProblemCode,
    SeriesStore,
    StatsCompareRange,
    StatsDataGap,
    StatsPage,
    StatsPoint,
    StatsRange,
    StatsSeries,
    SyncStatus,
    Usage,
    UsagePeriod,
} from './types'
