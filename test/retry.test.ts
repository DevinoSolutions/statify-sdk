import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    APIConnectionError,
    APIDecodeError,
    APITimeoutError,
    AuthenticationError,
    InvalidRequestError,
    NotFoundError,
    PermissionDeniedError,
    QuotaExhaustedError,
    RateLimitError,
    Statify,
    type Usage,
} from '../src/index'
import { fullJitterBackoffMs } from '../src/core/retryPolicy'
import {
    MOCK_API_KEY,
    MOCK_createFetch,
    MOCK_failingFetch,
    MOCK_problem,
    type MOCK_Reply,
} from './helpers/mockFetch'

const MOCK_USAGE: Usage = {
    period: { start: '2026-11-03T00:00:00.000Z', end: '2026-11-04T00:00:00.000Z' },
    used: 1,
    limit: 10000,
    remaining: 9999,
    exempt: false,
}
const OK: MOCK_Reply = { status: 200, body: MOCK_USAGE }

function client(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
    return new Statify({ apiKey: MOCK_API_KEY, fetch: fetchImpl, ...extra })
}

/** Script replies in order; the last one repeats. */
function sequence(...replies: MOCK_Reply[]) {
    return MOCK_createFetch((_req, i) => replies[Math.min(i, replies.length - 1)]!)
}

beforeEach(() => {
    vi.useFakeTimers()
    // Full jitter draws 0.5 -> attempt 0 waits 250ms, attempt 1 waits 500ms.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('retryable failures are retried with backoff', () => {
    it('5xx twice then 200: two full-jitter backoffs, then the answer', async () => {
        const mock = sequence(MOCK_problem('internal_error'), { status: 503 }, OK)
        const p = client(mock.fetch).usage.get()

        await vi.advanceTimersByTimeAsync(0)
        expect(mock.requests).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(249)
        expect(mock.requests).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(mock.requests).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(500)
        expect(mock.requests).toHaveLength(3)
        await expect(p).resolves.toEqual(MOCK_USAGE)
    })

    it('429 rate_limited waits exactly Retry-After seconds before retrying', async () => {
        const mock = sequence(
            { ...MOCK_problem('rate_limited'), headers: { 'retry-after': '2' } },
            OK,
        )
        const p = client(mock.fetch).usage.get()

        await vi.advanceTimersByTimeAsync(1999)
        expect(mock.requests).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(mock.requests).toHaveLength(2)
        await expect(p).resolves.toEqual(MOCK_USAGE)
    })

    it('honors a Retry-After HTTP-date', async () => {
        const now = Date.now()
        const mock = sequence(
            {
                ...MOCK_problem('rate_limited'),
                headers: { 'retry-after': new Date(now + 5000).toUTCString() },
            },
            OK,
        )
        const p = client(mock.fetch).usage.get()
        await vi.advanceTimersByTimeAsync(3000)
        expect(mock.requests).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(3000)
        expect(mock.requests).toHaveLength(2)
        await expect(p).resolves.toEqual(MOCK_USAGE)
    })

    it('caps a long Retry-After on rate_limited at 60s', async () => {
        const mock = sequence(
            { ...MOCK_problem('rate_limited'), headers: { 'retry-after': '600' } },
            OK,
        )
        const p = client(mock.fetch).usage.get()
        await vi.advanceTimersByTimeAsync(59_999)
        expect(mock.requests).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(mock.requests).toHaveLength(2)
        await expect(p).resolves.toEqual(MOCK_USAGE)
    })

    it('a 429 with no known code is treated as a rate limit and retried', async () => {
        const mock = sequence({ status: 429, headers: { 'retry-after': '1' } }, OK)
        const p = client(mock.fetch).usage.get()
        await vi.advanceTimersByTimeAsync(1000)
        await expect(p).resolves.toEqual(MOCK_USAGE)
        expect(mock.requests).toHaveLength(2)
    })

    it('408 is retried', async () => {
        const mock = sequence({ status: 408 }, OK)
        const p = client(mock.fetch).usage.get()
        await vi.advanceTimersByTimeAsync(250)
        await expect(p).resolves.toEqual(MOCK_USAGE)
        expect(mock.requests).toHaveLength(2)
    })

    it('a connection error is retried, then surfaces as APIConnectionError once retries are spent', async () => {
        const mock = MOCK_failingFetch()
        const p = client(mock.fetch).usage.get()
        const caught = p.catch((e: unknown) => e)
        await vi.advanceTimersByTimeAsync(250 + 500)
        const err = await caught
        expect(err).toBeInstanceOf(APIConnectionError)
        expect((err as Error).cause).toBeInstanceOf(TypeError)
        expect(mock.requests).toHaveLength(3) // 1 + maxRetries (2)
    })

    it('a rate limit that outlasts every retry surfaces as RateLimitError', async () => {
        const mock = sequence({ ...MOCK_problem('rate_limited'), headers: { 'retry-after': '1' } })
        const caught = client(mock.fetch).usage.get().catch((e: unknown) => e)
        await vi.advanceTimersByTimeAsync(2000)
        expect(await caught).toBeInstanceOf(RateLimitError)
        expect(mock.requests).toHaveLength(3)
    })

    it('a per-attempt timeout is APITimeoutError and is retried', async () => {
        let calls = 0
        const hanging = ((_url: string | URL | Request, init?: RequestInit) => {
            calls += 1
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () =>
                    reject(new DOMException('aborted', 'AbortError')),
                )
            })
        }) as typeof fetch
        const caught = client(hanging, { timeoutMs: 1000, maxRetries: 1 })
            .usage.get()
            .catch((e: unknown) => e)
        await vi.advanceTimersByTimeAsync(1000) // attempt 0 times out
        expect(calls).toBe(1)
        await vi.advanceTimersByTimeAsync(250) // backoff
        expect(calls).toBe(2)
        await vi.advanceTimersByTimeAsync(1000) // attempt 1 times out
        expect(await caught).toBeInstanceOf(APITimeoutError)
    })
})

describe('non-retryable failures surface at once', () => {
    it('quota_exhausted is NOT retried even though it carries Retry-After', async () => {
        const mock = sequence(
            { ...MOCK_problem('quota_exhausted'), headers: { 'retry-after': '3600' } },
            OK,
        )
        const err = await client(mock.fetch).usage.get().catch((e: unknown) => e)
        expect(err).toBeInstanceOf(QuotaExhaustedError)
        expect((err as QuotaExhaustedError).retryAfterSeconds).toBe(3600)
        expect(mock.requests).toHaveLength(1)
    })

    for (const [code, Ctor] of [
        ['invalid_request', InvalidRequestError],
        ['invalid_api_key', AuthenticationError],
        ['insufficient_scope', PermissionDeniedError],
        ['resource_not_found', NotFoundError],
    ] as const) {
        it(`${code} is not retried`, async () => {
            const mock = sequence(MOCK_problem(code), OK)
            const err = await client(mock.fetch).usage.get().catch((e: unknown) => e)
            expect(err).toBeInstanceOf(Ctor)
            expect(mock.requests).toHaveLength(1)
        })
    }

    it('maxRetries: 0 disables retries', async () => {
        const mock = sequence({ status: 503 }, OK)
        const err = await client(mock.fetch, { maxRetries: 0 }).usage.get().catch((e: unknown) => e)
        expect((err as { status: number }).status).toBe(503)
        expect(mock.requests).toHaveLength(1)
    })

    it('a non-GET sent through the raw escape hatch is never retried', async () => {
        const mock = sequence({ status: 503 }, OK)
        const err = await client(mock.fetch)
            .request({ method: 'POST', path: '/v1/something' })
            .catch((e: unknown) => e)
        expect((err as { status: number }).status).toBe(503)
        expect(mock.requests).toHaveLength(1)
    })

    it('a caller abort during the backoff wait rejects with the caller reason and stops retrying', async () => {
        const mock = sequence({ status: 503 }, OK)
        const controller = new AbortController()
        const caught = client(mock.fetch)
            .usage.get({ signal: controller.signal })
            .catch((e: unknown) => e)
        await vi.advanceTimersByTimeAsync(100)
        const reason = new Error('caller gave up')
        controller.abort(reason)
        await vi.advanceTimersByTimeAsync(1000)
        expect(await caught).toBe(reason)
        expect(mock.requests).toHaveLength(1)
    })
})

describe('backoff math', () => {
    it('full jitter grows 0.5s * 2^attempt and caps at 8s', () => {
        const max = () => 0.999999
        expect(fullJitterBackoffMs(0, max)).toBe(499)
        expect(fullJitterBackoffMs(1, max)).toBe(999)
        expect(fullJitterBackoffMs(4, max)).toBe(7999)
        expect(fullJitterBackoffMs(10, max)).toBe(7999)
        expect(fullJitterBackoffMs(3, () => 0)).toBe(0)
    })
})

describe('review hardening (2026-11-03)', () => {
    it('a header echoing the key is scrubbed on errors and on the raw response', async () => {
        const echo = { 'x-echo-authorization': `Bearer ${MOCK_API_KEY}` }
        const failing = sequence({ ...MOCK_problem('invalid_request'), headers: echo })
        const err = await client(failing.fetch).usage.get().catch((e: unknown) => e)
        expect(JSON.stringify((err as { headers: unknown }).headers)).not.toContain(MOCK_API_KEY)
        const ok = sequence({ ...OK, headers: echo })
        const res = await client(ok.fetch).request({ method: 'GET', path: '/v1/usage' })
        expect(JSON.stringify(res.headers)).not.toContain(MOCK_API_KEY)
    })

    it('a quota_exhausted body without its title is still classified by code and never retried', async () => {
        const mock = sequence({
            status: 429,
            body: { code: 'quota_exhausted', status: 429 },
            headers: { 'retry-after': '3600' },
        })
        const err = await client(mock.fetch).usage.get().catch((e: unknown) => e)
        expect(err).toBeInstanceOf(QuotaExhaustedError)
        expect((err as { title: string }).title).toBe('HTTP 429')
        expect(mock.requests).toHaveLength(1)
    })

    it('a 200 whose body is not JSON is an APIDecodeError, sent once', async () => {
        const mock = sequence({ status: 200, body: '<html>maintenance</html>' })
        const err = await client(mock.fetch).usage.get().catch((e: unknown) => e)
        expect(err).toBeInstanceOf(APIDecodeError)
        expect(err).not.toBeInstanceOf(APIConnectionError)
        expect(mock.requests).toHaveLength(1)
    })

    it('refuses a maxRetries or timeoutMs that would never terminate', () => {
        const { fetch } = sequence(OK)
        for (const maxRetries of [Number.NaN, Infinity, -1, 1.5]) {
            expect(() => client(fetch, { maxRetries })).toThrow(/maxRetries/)
        }
        for (const timeoutMs of [Number.NaN, 0, -5, Infinity]) {
            expect(() => client(fetch, { timeoutMs })).toThrow(/timeoutMs/)
        }
    })
})
