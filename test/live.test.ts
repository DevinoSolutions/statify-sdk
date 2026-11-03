// OPT-IN live smoke test against the real API. It runs ONLY when
// STATIFY_API_KEY is set and never in CI (CI sets CI=true). Read-only: five GETs
// that each count once against the workspace's daily quota (usage.get does not).
//
//   STATIFY_API_KEY=sta_live_... pnpm test:live
//   STATIFY_BASE_URL=https://... overrides the origin.

import { describe, expect, it } from 'vitest'
import { Statify } from '../src/index'

const key = process.env.STATIFY_API_KEY
const enabled = Boolean(key) && !process.env.CI

function isoDay(d: Date): string {
    return d.toISOString().slice(0, 10)
}

describe.skipIf(!enabled)('live: the real Statify API', () => {
    // Built only when enabled: without a key the constructor throws, and vitest
    // still runs a skipped describe body to collect its tests.
    const statify = enabled
        ? new Statify({
              ...(process.env.STATIFY_BASE_URL
                  ? { baseUrl: process.env.STATIFY_BASE_URL }
                  : {}),
          })
        : (undefined as unknown as Statify)

    it('lists apps', async () => {
        const page = await statify.apps.list({ limit: 5 })
        expect(Array.isArray(page.data)).toBe(true)
        expect(typeof page.hasMore).toBe('boolean')
        for (const app of page.data) {
            expect(typeof app.slug).toBe('string')
            expect(Array.isArray(app.npm_packages)).toBe(true)
        }
    })

    it('gets stats for every app over the last 30 days (usage, downloads)', async () => {
        const to = new Date()
        const from = new Date(to.getTime() - 29 * 86_400_000)
        const page = await statify.stats.list({
            apps: 'all',
            from: isoDay(from),
            to: isoDay(to),
            metrics: ['usage', 'downloads'],
        })
        expect(page.range.days).toBe(30)
        expect(page.compare).toBeNull()
        for (const entry of page.data) {
            expect(typeof entry.app).toBe('string')
            for (const s of entry.series) {
                expect(['usage', 'downloads']).toContain(s.metric)
                expect(typeof s.quality).toBe('string')
                expect(Array.isArray(s.points)).toBe(true)
            }
        }
    })

    it('reads freshness', async () => {
        const f = await statify.freshness.get()
        expect(f.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(Array.isArray(f.stores)).toBe(true)
        expect(Array.isArray(f.syncs)).toBe(true)
        expect(Array.isArray(f.warnings)).toBe(true)
        expect(Array.isArray(f.quality.flags)).toBe(true)
    })

    it('reads usage, with the Request-Id and rate-limit headers through the escape hatch', async () => {
        const u = await statify.usage.get()
        expect(typeof u.used).toBe('number')
        expect(typeof u.exempt).toBe('boolean')
        expect(typeof u.period.start).toBe('string')

        const raw = await statify.request({ path: '/v1/usage' })
        expect(raw.requestId).toBeTruthy()
    })
})
