import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Statify, VERSION } from '../src/index'
import {
    MOCK_API_KEY,
    MOCK_createFetch,
    MOCK_problem,
    MOCK_REQUEST_ID,
} from './helpers/mockFetch'

const MOCK_USAGE = {
    period: {
        start: '2026-11-03T00:00:00.000Z',
        end: '2026-11-04T00:00:00.000Z',
    },
    used: 120,
    limit: 10000,
    remaining: 9880,
    exempt: false,
}

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('the client sends the documented auth, base URL and user agent', () => {
    it('sends the key as a Bearer token to app.statify.now by default', async () => {
        const mock = MOCK_createFetch(() => ({ status: 200, body: MOCK_USAGE }))
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })

        await statify.usage.get()

        const req = mock.requests[0]!
        expect(req.url.origin).toBe('https://app.statify.now')
        expect(req.url.pathname).toBe('/v1/usage')
        expect(req.method).toBe('GET')
        expect(req.headers.authorization).toBe(`Bearer ${MOCK_API_KEY}`)
        expect(req.headers['x-api-key']).toBeUndefined()
        expect(req.headers['user-agent']).toBe(`statify-sdk-ts/${VERSION}`)
        expect(req.headers.accept).toBe('application/json')
    })

    it('sends the key in x-api-key instead when authHeader is x-api-key', async () => {
        const mock = MOCK_createFetch(() => ({ status: 200, body: MOCK_USAGE }))
        const statify = new Statify({
            apiKey: MOCK_API_KEY,
            fetch: mock.fetch,
            authHeader: 'x-api-key',
        })
        await statify.usage.get()
        expect(mock.requests[0]!.headers['x-api-key']).toBe(MOCK_API_KEY)
        expect(mock.requests[0]!.headers.authorization).toBeUndefined()
    })

    it('honors a custom base URL, keeping any path prefix', async () => {
        const mock = MOCK_createFetch(() => ({ status: 200, body: MOCK_USAGE }))
        const statify = new Statify({
            apiKey: MOCK_API_KEY,
            fetch: mock.fetch,
            baseUrl: 'http://localhost:3000/proxy',
        })
        await statify.usage.get()
        expect(mock.requests[0]!.url.toString()).toBe(
            'http://localhost:3000/proxy/v1/usage',
        )
    })

    it('merges default and per-request headers but never lets them replace the key', async () => {
        const mock = MOCK_createFetch(() => ({ status: 200, body: MOCK_USAGE }))
        const statify = new Statify({
            apiKey: MOCK_API_KEY,
            fetch: mock.fetch,
            defaultHeaders: { 'X-Team': 'growth', Authorization: 'Bearer nope' },
        })
        await statify.usage.get({ headers: { 'X-Trace': 'abc', 'x-api-key': 'nope' } })
        const h = mock.requests[0]!.headers
        expect(h['x-team']).toBe('growth')
        expect(h['x-trace']).toBe('abc')
        expect(h.authorization).toBe(`Bearer ${MOCK_API_KEY}`)
        expect(h['x-api-key']).toBeUndefined()
    })

    it('reads STATIFY_API_KEY from the environment when no key is passed', async () => {
        vi.stubEnv('STATIFY_API_KEY', MOCK_API_KEY)
        const mock = MOCK_createFetch(() => ({ status: 200, body: MOCK_USAGE }))
        const statify = new Statify({ fetch: mock.fetch })
        await statify.usage.get()
        expect(mock.requests[0]!.headers.authorization).toBe(`Bearer ${MOCK_API_KEY}`)
    })

    it('throws a clear error when there is no key at all', () => {
        vi.stubEnv('STATIFY_API_KEY', '')
        expect(() => new Statify()).toThrow(/Missing Statify API key/)
    })

    it('keeps VERSION in sync with package.json', () => {
        const pkg = JSON.parse(
            readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
        ) as { version: string; private?: boolean }
        expect(VERSION).toBe(pkg.version)
        // Publishing waits for the owner's yes: npm refuses a private package.
        expect(pkg.private).toBe(true)
    })
})

describe('the client is server-side only', () => {
    it('throws when constructed where window is defined', () => {
        vi.stubGlobal('window', {})
        expect(() => new Statify({ apiKey: MOCK_API_KEY })).toThrow(
            /browser-like environment/,
        )
    })

    it('allows a browser only with dangerouslyAllowBrowser', () => {
        vi.stubGlobal('window', {})
        expect(
            () => new Statify({ apiKey: MOCK_API_KEY, dangerouslyAllowBrowser: true }),
        ).not.toThrow()
    })
})

describe('the API key never leaks', () => {
    it('is absent from JSON.stringify and util.inspect of the client and its resources', () => {
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: MOCK_createFetch(() => ({ status: 200 })).fetch })
        expect(JSON.stringify(statify)).not.toContain(MOCK_API_KEY)
        expect(inspect(statify, { depth: 10, showHidden: true })).not.toContain(MOCK_API_KEY)
        for (const resource of [statify.apps, statify.stats, statify.freshness, statify.usage]) {
            expect(inspect(resource, { depth: 10, showHidden: true })).not.toContain(MOCK_API_KEY)
            expect(JSON.stringify(resource)).not.toContain(MOCK_API_KEY)
        }
    })

    it('is redacted from error messages even when the server echoes it', async () => {
        const problem = MOCK_problem('invalid_api_key', {
            detail: `The key ${MOCK_API_KEY} is revoked.`,
        })
        const mock = MOCK_createFetch(() => problem)
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })
        const err = (await statify.usage.get().catch((e: unknown) => e)) as Error
        expect(err.message).not.toContain(MOCK_API_KEY)
        expect(err.message).toContain('sta_live_***')
        expect(err.message).toContain(MOCK_REQUEST_ID)
        expect(inspect(err)).not.toContain(MOCK_API_KEY)
        expect(JSON.stringify(err)).not.toContain(MOCK_API_KEY)
        expect((err as unknown as { detail: string }).detail).toBe('The key sta_live_*** is revoked.')
    })

    it('redacts the exact key from error text even when it is not sta_-shaped', async () => {
        const oddKey = 'legacy-secret-0123456789'
        const mock = MOCK_createFetch(() =>
            MOCK_problem('invalid_request', {
                detail: `bad ${oddKey}`,
                errors: [{ pointer: '/x', code: 'custom', message: `saw ${oddKey}` }],
            }),
        )
        const statify = new Statify({ apiKey: oddKey, fetch: mock.fetch })
        const err = await statify.usage.get().catch((e: unknown) => e)
        expect(inspect(err, { depth: 10 })).not.toContain(oddKey)
        expect(JSON.stringify(err)).not.toContain(oddKey)
    })

    it('is redacted from debug logs, which carry method, path, status and request id', async () => {
        const lines: string[] = []
        const mock = MOCK_createFetch(() => ({ status: 200, body: MOCK_USAGE }))
        const statify = new Statify({
            apiKey: MOCK_API_KEY,
            fetch: mock.fetch,
            debug: m => lines.push(m),
        })
        await statify.request({ path: `/v1/usage`, query: { probe: MOCK_API_KEY } })
        expect(lines.join('\n')).not.toContain(MOCK_API_KEY)
        expect(lines[0]).toContain('GET /v1/usage -> 200')
        expect(lines[0]).toContain(`req=${MOCK_REQUEST_ID}`)
    })
})

describe('the raw escape hatch', () => {
    it('returns the body with the Request-Id and the parsed rate-limit headers', async () => {
        const mock = MOCK_createFetch(() => ({
            status: 200,
            body: MOCK_USAGE,
            headers: {
                'ratelimit-policy':
                    '"per-key-minute";q=60;w=60, "per-workspace-day";q=10000;w=86400',
                ratelimit: '"per-key-minute";r=42;t=60',
                'x-ratelimit-limit': '60',
                'x-ratelimit-remaining': '42',
                'x-ratelimit-reset': '1793750460',
            },
        }))
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })
        const res = await statify.request<typeof MOCK_USAGE>({ path: '/v1/usage' })
        expect(res.data.used).toBe(120)
        expect(res.requestId).toBe(MOCK_REQUEST_ID)
        expect(res.response.status).toBe(200)
        expect(res.rateLimit).toEqual({
            policies: [
                { name: 'per-key-minute', quota: 60, windowSeconds: 60 },
                { name: 'per-workspace-day', quota: 10000, windowSeconds: 86400 },
            ],
            current: { policy: 'per-key-minute', remaining: 42, resetSeconds: 60 },
            limit: 60,
            remaining: 42,
            resetAt: 1793750460,
        })
    })

    it('tolerates a response with no rate-limit headers', async () => {
        const mock = MOCK_createFetch(() => ({ status: 200, body: MOCK_USAGE }))
        const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch })
        const res = await statify.request({ path: '/v1/usage' })
        expect(res.rateLimit.policies).toEqual([])
        expect(res.rateLimit.current).toBeUndefined()
        expect(res.rateLimit.remaining).toBeUndefined()
    })
})
