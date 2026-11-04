import type { HttpClient, QueryParams } from '../core/http'
import { Page, type PageFetcher } from '../core/pagination'
import type {
    AppStatsBreakdown,
    AppStatsCompareMode,
    AppStatsEntry,
    AppStatsMetric,
    AppStatsStore,
    IsoDate,
    Open,
    StatsCompareRange,
    StatsPage,
    StatsRange,
} from '../types'
import type { RequestOptions } from './common'

/** The query both stats operations take. */
export interface StatsQueryParams {
    /** First day, inclusive (UTC calendar day, `YYYY-MM-DD`). */
    from: IsoDate
    /** Last day, inclusive. At most 366 days from `from`. */
    to: IsoDate
    /**
     * The metric groups (at most 8, each once): an array, or a comma-separated
     * string. `new_users` is GA4 first visits to the website, never signups;
     * `signups` is distinct persons firing the app's signup event (a `not_synced`
     * data gap until a sync has looked).
     */
    metrics: readonly AppStatsMetric[] | string
    /** Only the series from this store. */
    store?: AppStatsStore
    /**
     * `previous_period`: also total the same number of days right before `from`
     * (`compare_total`, `change_pct`).
     */
    compare?: AppStatsCompareMode
    /**
     * `source`: split each `signups` series by acquisition source
     * (`series.breakdown`). `metrics` must include `signups`, or the API answers
     * 400. Breakdown points count toward the points cap.
     */
    by?: AppStatsBreakdown
}

/** Params of `GET /v1/stats`. */
export interface ListStatsParams extends StatsQueryParams {
    /** `all` for every tracked app, or the slugs (an array or a comma-separated string). */
    apps: Open<'all'> | readonly string[]
    /** Apps per page, 1 to 20 (server default 20). */
    limit?: number
    /** The `nextCursor` of the previous page; omit it for the first page. */
    after?: string
}

/** Serialize the shared stats query (internal). */
export function statsQuery(params: StatsQueryParams): QueryParams {
    return {
        from: params.from,
        to: params.to,
        metrics: params.metrics,
        store: params.store,
        compare: params.compare,
        by: params.by,
    }
}

/**
 * One page of `GET /v1/stats`: a `Page` of apps (each with its series) plus the
 * range and compare period the whole answer shares.
 */
export class StatsListPage extends Page<AppStatsEntry> {
    /** The requested range. */
    readonly range: StatsRange
    /** The previous period with `compare: 'previous_period'`, else null. */
    readonly compare: StatsCompareRange | null

    private readonly fetchNextStats: PageFetcher<StatsListPage>

    constructor(envelope: StatsPage, fetchNext: PageFetcher<StatsListPage>) {
        super(envelope, fetchNext)
        this.range = envelope.range
        this.compare = envelope.compare
        this.fetchNextStats = fetchNext
    }

    override async nextPage(): Promise<StatsListPage | null> {
        if (!this.hasMore || this.nextCursor === null) return null
        return this.fetchNextStats(this.nextCursor)
    }
}

/** `statify.stats`: series for several apps at once, paged by app. */
export class StatsResource {
    constructor(private readonly http: HttpClient) {}

    /**
     * `GET /v1/stats`: the series of every requested app (`apps: 'all'` or a
     * list), at most 20 apps per page, in slug order. The returned page is
     * async-iterable across every following page (one item per app).
     */
    async list(
        params: ListStatsParams,
        opts?: RequestOptions,
    ): Promise<StatsListPage> {
        const fetchPage = async (
            after: string | undefined,
        ): Promise<StatsListPage> => {
            const { data } = await this.http.request<StatsPage>({
                method: 'GET',
                path: '/v1/stats',
                query: {
                    apps: params.apps,
                    ...statsQuery(params),
                    limit: params.limit,
                    after,
                },
                signal: opts?.signal,
                timeoutMs: opts?.timeoutMs,
                headers: opts?.headers,
            })
            return new StatsListPage(data, fetchPage)
        }
        return fetchPage(params.after)
    }

    /** Every requested app's entry across all pages: `for await (const entry of statify.stats.listAutoPaging({ ... }))`. */
    async *listAutoPaging(
        params: ListStatsParams,
        opts?: RequestOptions,
    ): AsyncGenerator<AppStatsEntry, void, undefined> {
        yield* await this.list(params, opts)
    }
}
