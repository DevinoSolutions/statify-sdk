import type { HttpClient } from '../core/http'
import { Page } from '../core/pagination'
import type { App, AppList, AppStats } from '../types'
import type { RequestOptions } from './common'
import { statsQuery, type StatsQueryParams } from './stats'

export interface ListAppsParams {
    /** How many apps per page, 1 to 100 (server default 25). */
    limit?: number
    /**
     * The `nextCursor` of the previous page; omit it for the first page. A cursor
     * only works with the exact query that produced it (same `limit`).
     */
    after?: string
}

/** Params of `GET /v1/apps/{slug}/stats`. */
export type AppStatsParams = StatsQueryParams

/** `statify.apps`: the apps your workspace tracks, and one app's stats. */
export class AppsResource {
    constructor(private readonly http: HttpClient) {}

    /**
     * `GET /v1/apps`: one page of tracked apps, in slug order. The returned
     * `Page` is async-iterable across every following page.
     */
    async list(
        params?: ListAppsParams,
        opts?: RequestOptions,
    ): Promise<Page<App>> {
        const fetchPage = async (
            after: string | undefined,
        ): Promise<Page<App>> => {
            const { data } = await this.http.request<AppList>({
                method: 'GET',
                path: '/v1/apps',
                query: { limit: params?.limit, after },
                signal: opts?.signal,
                timeoutMs: opts?.timeoutMs,
                headers: opts?.headers,
            })
            return new Page<App>(data, fetchPage)
        }
        return fetchPage(params?.after)
    }

    /** Every tracked app across all pages: `for await (const app of statify.apps.listAutoPaging())`. */
    async *listAutoPaging(
        params?: ListAppsParams,
        opts?: RequestOptions,
    ): AsyncGenerator<App, void, undefined> {
        yield* await this.list(params, opts)
    }

    /**
     * `GET /v1/apps/{slug}/stats`: daily series and a period total per metric and
     * store for one app, each with its quality flag, lag and newest day. Throws
     * `NotFoundError` when the workspace tracks no app with this slug.
     */
    async stats(
        slug: string,
        params: AppStatsParams,
        opts?: RequestOptions,
    ): Promise<AppStats> {
        const { data } = await this.http.request<AppStats>({
            method: 'GET',
            path: `/v1/apps/${encodeURIComponent(slug)}/stats`,
            query: statsQuery(params),
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }
}
