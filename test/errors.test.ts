import { describe, expect, it } from 'vitest'
import {
    APIError,
    APIServerError,
    AuthenticationError,
    InvalidRequestError,
    NotFoundError,
    PermissionDeniedError,
    QuotaExhaustedError,
    RateLimitError,
    Statify,
    StatifyError,
} from '../src/index'
import {
    MOCK_API_KEY,
    MOCK_createFetch,
    MOCK_problem,
    MOCK_REQUEST_ID,
} from './helpers/mockFetch'

async function errorFor(
    reply: { status: number; body?: unknown; headers?: Record<string, string> },
): Promise<APIError> {
    const mock = MOCK_createFetch(() => reply)
    // maxRetries 0: this file is about mapping, not retrying.
    const statify = new Statify({ apiKey: MOCK_API_KEY, fetch: mock.fetch, maxRetries: 0 })
    return statify.apps
        .stats('superbooks', { from: '2026-10-01', to: '2026-10-30', metrics: ['usage'] })
        .then(
            () => {
                throw new Error('expected a throw')
            },
            (e: unknown) => e as APIError,
        )
}

describe('every problem code maps to its error class', () => {
    const cases: [string, new (...a: never[]) => APIError, number][] = [
        ['invalid_request', InvalidRequestError, 400],
        ['missing_credentials', AuthenticationError, 401],
        ['invalid_api_key', AuthenticationError, 401],
        ['unsupported_credential_type', PermissionDeniedError, 403],
        ['insufficient_scope', PermissionDeniedError, 403],
        ['workspace_required', PermissionDeniedError, 403],
        ['feature_not_enabled', PermissionDeniedError, 403],
        ['resource_not_found', NotFoundError, 404],
        ['rate_limited', RateLimitError, 429],
        ['quota_exhausted', QuotaExhaustedError, 429],
        ['internal_error', APIServerError, 500],
    ]

    for (const [code, Ctor, status] of cases) {
        it(`${code} -> ${Ctor.name} (${status})`, async () => {
            const err = await errorFor({
                ...MOCK_problem(code),
                headers: { 'retry-after': '30' },
            })
            expect(err).toBeInstanceOf(Ctor)
            expect(err).toBeInstanceOf(APIError)
            expect(err).toBeInstanceOf(StatifyError)
            expect(err.name).toBe(Ctor.name)
            expect(err.status).toBe(status)
            expect(err.code).toBe(code)
            expect(err.type).toBe(`https://statify.now/docs/api/problems/${code}`)
            expect(err.requestId).toBe(MOCK_REQUEST_ID)
            expect(err.retryAfterSeconds).toBe(30)
        })
    }

    it('quota_exhausted is not a RateLimitError, so a rate-limit catch never retries a spent quota', async () => {
        const err = await errorFor(MOCK_problem('quota_exhausted'))
        expect(err).not.toBeInstanceOf(RateLimitError)
    })
})

describe('problem details survive onto the error', () => {
    it('an invalid_request carries detail, field errors and a legible message', async () => {
        const err = await errorFor(
            MOCK_problem('invalid_request', {
                detail: 'The range is 400 days; the cap is 366.',
                errors: [{ pointer: '/to', code: 'too_big', message: 'At most 366 days from `from`.' }],
            }),
        )
        expect(err).toBeInstanceOf(InvalidRequestError)
        expect(err.title).toBe('The request is invalid')
        expect(err.detail).toBe('The range is 400 days; the cap is 366.')
        expect(err.errors).toEqual([
            { pointer: '/to', code: 'too_big', message: 'At most 366 days from `from`.' },
        ])
        expect(err.message).toBe(
            `The request is invalid: The range is 400 days; the cap is 366. (${MOCK_REQUEST_ID})`,
        )
    })

    it('errors[] is an empty array when the problem has none', async () => {
        const err = await errorFor(MOCK_problem('resource_not_found'))
        expect(err.errors).toEqual([])
    })

    it('a 429 carries the parsed rate-limit headers', async () => {
        const err = await errorFor({
            ...MOCK_problem('quota_exhausted'),
            headers: {
                'retry-after': '3600',
                'ratelimit-policy': '"per-key-minute";q=60;w=60, "per-workspace-day";q=10000;w=86400',
                ratelimit: '"per-workspace-day";r=0;t=3600',
            },
        })
        expect(err.retryAfterSeconds).toBe(3600)
        expect(err.rateLimit.current).toEqual({
            policy: 'per-workspace-day',
            remaining: 0,
            resetSeconds: 3600,
        })
        expect(err.rateLimit.policies.map(p => p.name)).toEqual([
            'per-key-minute',
            'per-workspace-day',
        ])
    })
})

describe('the mapper never throws on surprises', () => {
    it('an unknown code falls back to the status class', async () => {
        const err = await errorFor(
            MOCK_problem('brand_new_code', { status: 403, title: 'Something new' }),
        )
        expect(err).toBeInstanceOf(PermissionDeniedError)
        expect(err.code).toBe('brand_new_code')
    })

    it('an unknown 4xx status with no code is a plain APIError', async () => {
        const err = await errorFor({ status: 418, body: { hello: 'teapot' } })
        expect(err.constructor).toBe(APIError)
        expect(err.title).toBe('HTTP 418')
        expect(err.requestId).toBe(MOCK_REQUEST_ID)
    })

    it('a non-JSON 502 becomes APIServerError with a bounded snippet in detail', async () => {
        const html = `<html>${'x'.repeat(2000)}</html>`
        const err = await errorFor({ status: 502, body: html })
        expect(err).toBeInstanceOf(APIServerError)
        expect(err.detail!.length).toBe(500)
        expect(err.detail!.startsWith('<html>')).toBe(true)
    })

    it('an empty-bodied 500 still maps', async () => {
        const err = await errorFor({ status: 500 })
        expect(err).toBeInstanceOf(APIServerError)
        expect(err.detail).toBeUndefined()
    })
})
