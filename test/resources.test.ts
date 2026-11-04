import { describe, expect, expectTypeOf, it } from 'vitest'
import {
    ALL_METRICS,
    NEW_USERS_LABEL,
    Page,
    Statify,
    StatsListPage,
    type App,
    type AppStats,
    type AppStatsEntry,
    type FactQuality,
    type StatsSeries,
} from '../src/index'
import { MOCK_API_KEY, MOCK_createFetch, MOCK_series } from './helpers/mockFetch'

function MOCK_app(slug: string): App {
    return {
        slug,
        name: slug.toUpperCase(),
        apple_app_id: null,
        apple_bundle_id: null,
        play_package: null,
        microsoft_product_id: null,
        web_domain: `${slug}.example`,
        mcp_url: null,
        npm_packages: [],
        pypi_packages: [],
    }
}

const RANGE = { from: '2026-10-01', to: '2026-10-30', days: 30 }

describe('query serialization', () => {
    it('apps.stats sends from, to, a comma-joined metrics list, store and compare, and encodes the slug', async () => {
        const mock = MOCK_createFetch(() => ({
            status: 200,
            body: { app: 'super-books', range: RANGE, compare: null, series: [], data_gaps: [] },
        }))
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })

        await statify.apps.stats('super books', {
            from: '2026-10-01',
            to: '2026-10-30',
            metrics: ['usage', 'downloads'],
            store: 'apple',
            compare: 'previous_period',
        })

        const url = mock.requests[0]!.url
        expect(url.pathname).toBe('/v1/apps/super%20books/stats')
        expect(Object.fromEntries(url.searchParams)).toEqual({
            from: '2026-10-01',
            to: '2026-10-30',
            metrics: 'usage,downloads',
            store: 'apple',
            compare: 'previous_period',
        })
    })

    it('apps.stats sends by=source and returns the signups breakdown as the API sent it', async () => {
        const series = {
            metric: 'signups',
            family: 'signups',
            store: 'posthog',
            label: 'signups (user_signed_up)',
            aggregation: 'sum',
            quality: 'exact',
            latest_date: '2026-10-30',
            lag_days: 0,
            complete_through: '2026-10-30',
            stale: false,
            days_stale: 1,
            total: 5,
            compare_total: null,
            change_pct: null,
            currency: null,
            conversion_basis: null,
            points: [{ date: '2026-10-30', value: 5 }],
            breakdown: [
                { source: 'google', total: 3, compare_total: null, change_pct: null, points: [{ date: '2026-10-30', value: 3 }] },
                { source: 'other', total: 2, compare_total: null, change_pct: null, points: [{ date: '2026-10-30', value: 2 }] },
            ],
        }
        const mock = MOCK_createFetch(() => ({
            status: 200,
            body: { app: 'super-books', range: RANGE, compare: null, series: [series], data_gaps: [] },
        }))
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })

        const stats = await statify.apps.stats('super-books', {
            from: '2026-10-01',
            to: '2026-10-30',
            metrics: ['signups'],
            by: 'source',
        })

        expect(Object.fromEntries(mock.requests[0]!.url.searchParams)).toEqual({
            from: '2026-10-01',
            to: '2026-10-30',
            metrics: 'signups',
            by: 'source',
        })
        expect(stats.series[0]!.breakdown?.map((b) => [b.source, b.total])).toEqual([
            ['google', 3],
            ['other', 2],
        ])
    })

    it('stats.list sends apps=all and omits unset optional params', async () => {
        const mock = MOCK_createFetch(() => ({
            status: 200,
            body: { range: RANGE, compare: null, data: [], has_more: false, next_cursor: null },
        }))
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })

        await statify.stats.list({
            apps: 'all',
            from: '2026-10-01',
            to: '2026-10-30',
            metrics: 'usage,downloads',
        })

        const url = mock.requests[0]!.url
        expect(url.pathname).toBe('/v1/stats')
        expect(Object.fromEntries(url.searchParams)).toEqual({
            apps: 'all',
            from: '2026-10-01',
            to: '2026-10-30',
            metrics: 'usage,downloads',
        })
    })

    it('stats.list comma-joins an apps array and sends limit and after', async () => {
        const mock = MOCK_createFetch(() => ({
            status: 200,
            body: { range: RANGE, compare: null, data: [], has_more: false, next_cursor: null },
        }))
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })

        await statify.stats.list({
            apps: ['superbooks', 'unotes'],
            from: '2026-10-01',
            to: '2026-10-30',
            metrics: ALL_METRICS,
            limit: 5,
            after: 'cur_1',
        })

        const q = mock.requests[0]!.url.searchParams
        expect(q.get('apps')).toBe('superbooks,unotes')
        expect(q.get('metrics')).toBe(ALL_METRICS.join(','))
        expect(q.get('limit')).toBe('5')
        expect(q.get('after')).toBe('cur_1')
    })

    it('freshness.get and usage.get call their paths with no query', async () => {
        const mock = MOCK_createFetch(() => ({ status: 200, body: {} }))
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })
        await statify.freshness.get()
        await statify.usage.get()
        expect(mock.requests.map(r => r.url.pathname + r.url.search)).toEqual([
            '/v1/freshness',
            '/v1/usage',
        ])
    })
})

describe('cursor pagination', () => {
    // Three pages of apps: a,b | c,d | e, then has_more=false.
    function threeAppPages() {
        return MOCK_createFetch(req => {
            const after = req.url.searchParams.get('after')
            if (after === null)
                return { status: 200, body: { data: [MOCK_app('a'), MOCK_app('b')], has_more: true, next_cursor: 'cur_2' } }
            if (after === 'cur_2')
                return { status: 200, body: { data: [MOCK_app('c'), MOCK_app('d')], has_more: true, next_cursor: 'cur_3' } }
            if (after === 'cur_3')
                return { status: 200, body: { data: [MOCK_app('e')], has_more: false, next_cursor: null } }
            throw new Error(`MOCK: unexpected cursor ${after}`)
        })
    }

    it('apps.listAutoPaging walks every app across 3 pages and stops on has_more=false', async () => {
        const mock = threeAppPages()
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })

        const slugs: string[] = []
        for await (const app of statify.apps.listAutoPaging({ limit: 2 })) slugs.push(app.slug)

        expect(slugs).toEqual(['a', 'b', 'c', 'd', 'e'])
        expect(mock.requests).toHaveLength(3)
        // The original query is reused on every page; only `after` advances.
        expect(mock.requests.map(r => r.url.searchParams.get('limit'))).toEqual(['2', '2', '2'])
        expect(mock.requests.map(r => r.url.searchParams.get('after'))).toEqual([null, 'cur_2', 'cur_3'])
    })

    it('apps.list returns one page with manual nextPage(), null at the end', async () => {
        const mock = threeAppPages()
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })

        const first = await statify.apps.list({ limit: 2 })
        expect(first).toBeInstanceOf(Page)
        expect(first.data.map(a => a.slug)).toEqual(['a', 'b'])
        expect(first.hasMore).toBe(true)
        expect(first.nextCursor).toBe('cur_2')
        const second = await first.nextPage()
        const third = await second!.nextPage()
        expect(third!.data.map(a => a.slug)).toEqual(['e'])
        expect(await third!.nextPage()).toBeNull()
        expect(mock.requests).toHaveLength(3)
    })

    it('stats.listAutoPaging yields one entry per app across pages and keeps range/compare on each page', async () => {
        const compare = { from: '2026-09-01', to: '2026-09-30' }
        const entry = (app: string): AppStatsEntry => ({
            app,
            series: [MOCK_series() as unknown as StatsSeries],
            data_gaps: [{ metric: 'signups', reason: 'not_synced', store: null }],
        })
        const mock = MOCK_createFetch(req => {
            const after = req.url.searchParams.get('after')
            if (after === null)
                return { status: 200, body: { range: RANGE, compare, data: [entry('a')], has_more: true, next_cursor: 's2' } }
            if (after === 's2')
                return { status: 200, body: { range: RANGE, compare, data: [entry('b')], has_more: true, next_cursor: 's3' } }
            return { status: 200, body: { range: RANGE, compare, data: [entry('c')], has_more: false, next_cursor: null } }
        })
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })
        const params = {
            apps: 'all',
            from: '2026-10-01',
            to: '2026-10-30',
            metrics: ['usage', 'downloads'],
            compare: 'previous_period',
        } as const

        const apps: string[] = []
        for await (const e of statify.stats.listAutoPaging(params)) apps.push(e.app)
        expect(apps).toEqual(['a', 'b', 'c'])
        expect(mock.requests).toHaveLength(3)
        for (const r of mock.requests) {
            expect(r.url.searchParams.get('apps')).toBe('all')
            expect(r.url.searchParams.get('compare')).toBe('previous_period')
        }

        const page = await statify.stats.list(params)
        expect(page).toBeInstanceOf(StatsListPage)
        expect(page.range).toEqual(RANGE)
        expect(page.compare).toEqual(compare)
        const next = await page.nextPage()
        expect(next).toBeInstanceOf(StatsListPage)
        expect(next!.range).toEqual(RANGE)
    })
})

describe('forward-compatible enums', () => {
    it('an unknown quality, store, aggregation, metric or gap reason passes through untouched', async () => {
        const series = MOCK_series({
            metric: 'brand_new_metric',
            store: 'huawei',
            aggregation: 'median',
            quality: 'estimated',
        })
        const mock = MOCK_createFetch(() => ({
            status: 200,
            body: {
                app: 'superbooks',
                range: RANGE,
                compare: null,
                series: [series],
                data_gaps: [{ metric: 'signups', reason: 'paused_upstream', store: 'apple' }],
            },
        }))
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })
        const stats = await statify.apps.stats('superbooks', {
            from: '2026-10-01',
            to: '2026-10-30',
            metrics: ['downloads'],
        })
        expect(stats.series[0]!.quality).toBe('estimated')
        expect(stats.series[0]!.store).toBe('huawei')
        expect(stats.data_gaps[0]!.reason).toBe('paused_upstream')
    })

    it('types: known members autocomplete and any other string still type-checks', () => {
        expectTypeOf<'proxy'>().toExtend<FactQuality>()
        expectTypeOf<'some_future_flag'>().toExtend<FactQuality>()
        expectTypeOf<AppStats['series'][number]['total']>().toEqualTypeOf<number | null>()
        expect(NEW_USERS_LABEL).toBe(
            'visitors (GA4 first visits), ~2-day lag, quality=proxy — not signups',
        )
    })
})
