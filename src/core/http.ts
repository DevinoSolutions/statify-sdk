// The request / retry / backoff engine.
//
// Retry policy (see README "Retries"):
//   Retryable: connection errors · per-attempt timeout · 408 · 429 rate_limited
//   (or a 429 with no known code) · 500/502/503/504.
//   NEVER: 429 quota_exhausted (its Retry-After can be hours) · any other 4xx ·
//   caller-signal aborts · a non-GET/HEAD request (only the raw escape hatch can
//   send one; every v1 operation is a GET).
//   Delay: Retry-After honored (delta-seconds AND HTTP-date, capped 60s); else
//   full-jitter backoff random(0, min(0.5*2^attempt, 8))s.
//   Timeout is PER ATTEMPT (an AbortController per try, linked to the caller's
//   signal). A caller abort surfaces as the caller's abort, not APITimeoutError.
//
// The API key is never stored as a field: `authorize` closes over it, so
// inspecting or serializing this object (or anything holding it) cannot print it.

import type { Problem } from '../types'
import {
    APIConnectionError,
    APIError,
    APITimeoutError,
    QuotaExhaustedError,
    RateLimitError,
    createApiError,
} from './errors'
import { parseRateLimit, type RateLimitInfo } from './rateLimit'
import { redact } from './redaction'
import {
    cappedRetryAfterMs,
    fullJitterBackoffMs,
    parseRetryAfterSeconds,
} from './retryPolicy'

export type FetchLike = typeof fetch

/** A query value. Arrays are sent comma-joined (`metrics=usage,downloads`). */
export type QueryValue = string | number | boolean | readonly string[] | undefined
export type QueryParams = Record<string, QueryValue>

/** Which documented header carries the API key. */
export type AuthHeader = 'bearer' | 'x-api-key'

export interface HttpConfig {
    baseUrl: string
    apiKey: string
    authHeader: AuthHeader
    fetchImpl: FetchLike
    timeoutMs: number
    maxRetries: number
    userAgent: string
    defaultHeaders: Record<string, string>
    /** Already-redacting sink; called with method/path/status/attempt/request-id only. */
    debug: ((message: string) => void) | undefined
}

export interface HttpRequest {
    method: string
    path: string
    query?: QueryParams | undefined
    headers?: Record<string, string> | undefined
    signal?: AbortSignal | undefined
    timeoutMs?: number | undefined
}

/** A decoded response plus everything around it. */
export interface APIResponse<T> {
    /** The decoded JSON body. */
    data: T
    /** The raw `Response` (its body is already consumed). */
    response: Response
    /** The `Request-Id` header: quote it to support. */
    requestId: string | undefined
    /** The rate-limit headers, parsed. */
    rateLimit: RateLimitInfo
    /** The response headers, lower-cased. */
    headers: Record<string, string>
}

const RETRYABLE_5XX = new Set([500, 502, 503, 504])
const RETRY_SAFE_METHODS = new Set(['GET', 'HEAD'])

type Settings = Omit<HttpConfig, 'apiKey' | 'authHeader'>

export class HttpClient {
    private readonly settings: Settings
    /** Writes the auth header. The key lives only in this closure. */
    private readonly authorize: (headers: Headers) => void

    constructor(config: HttpConfig) {
        const { apiKey, authHeader, ...settings } = config
        this.settings = settings
        this.authorize = (headers: Headers) => {
            headers.delete('authorization')
            headers.delete('x-api-key')
            if (authHeader === 'x-api-key') headers.set('x-api-key', apiKey)
            else headers.set('authorization', `Bearer ${apiKey}`)
        }
    }

    async request<T>(req: HttpRequest): Promise<APIResponse<T>> {
        const maxRetries = this.settings.maxRetries
        let attempt = 0
        for (;;) {
            try {
                return await this.attempt<T>(req, attempt)
            } catch (err) {
                if (!this.isRetryable(err, req) || attempt >= maxRetries)
                    throw err
                const delayMs = this.computeDelayMs(err, attempt)
                this.log(req, `retry in ${delayMs}ms`, attempt)
                await abortableSleep(delayMs, req.signal)
                attempt += 1
            }
        }
    }

    private async attempt<T>(
        req: HttpRequest,
        attempt: number,
    ): Promise<APIResponse<T>> {
        const url = this.buildUrl(req.path, req.query)
        const controller = new AbortController()
        const timeoutMs = req.timeoutMs ?? this.settings.timeoutMs

        // Link the caller's signal so a caller abort cancels this attempt.
        const caller = req.signal
        const onCallerAbort = () => controller.abort(caller?.reason)
        if (caller) {
            if (caller.aborted) controller.abort(caller.reason)
            else caller.addEventListener('abort', onCallerAbort, { once: true })
        }

        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            controller.abort()
        }, timeoutMs)

        let response: Response
        try {
            response = await this.settings.fetchImpl(url, {
                method: req.method,
                headers: this.buildHeaders(req),
                signal: controller.signal,
            })
        } catch (err) {
            // A caller abort wins over an SDK timeout: re-surface the caller's
            // reason unchanged (never converted to APITimeoutError, never retried).
            if (caller?.aborted) throw caller.reason ?? err
            if (timedOut) throw new APITimeoutError()
            throw new APIConnectionError('Connection error.', { cause: err })
        } finally {
            clearTimeout(timer)
            if (caller) caller.removeEventListener('abort', onCallerAbort)
        }

        const headers = headersToRecord(response.headers)
        const requestId = headers['request-id']

        if (response.ok) {
            this.log(req, `${response.status}`, attempt, requestId)
            const data = (await parseJsonBody(response)) as T
            return {
                data,
                response,
                requestId,
                rateLimit: parseRateLimit(headers),
                headers,
            }
        }

        const { problem, rawText } = await readErrorBody(response)
        const error = createApiError({
            status: response.status,
            problem,
            rawText,
            headers,
        })
        this.log(
            req,
            `${response.status} ${error.code ?? ''}`.trim(),
            attempt,
            error.requestId,
        )
        throw error
    }

    private isRetryable(err: unknown, req: HttpRequest): boolean {
        if (!RETRY_SAFE_METHODS.has(req.method.toUpperCase())) return false
        // Caller aborts and anything that is not ours: never retry.
        if (isAbortError(err)) return false
        if (err instanceof APIConnectionError) return true // incl. timeouts
        if (err instanceof QuotaExhaustedError) return false
        if (err instanceof RateLimitError) return true
        if (err instanceof APIError) {
            return err.status === 408 || RETRYABLE_5XX.has(err.status)
        }
        return false
    }

    private computeDelayMs(err: unknown, attempt: number): number {
        if (err instanceof APIError) {
            const seconds = parseRetryAfterSeconds(err.headers['retry-after'])
            if (seconds !== undefined) return cappedRetryAfterMs(seconds * 1000)
        }
        return fullJitterBackoffMs(attempt)
    }

    private buildUrl(path: string, query: QueryParams | undefined): string {
        const base = this.settings.baseUrl.endsWith('/')
            ? this.settings.baseUrl
            : `${this.settings.baseUrl}/`
        const url = new URL(path.replace(/^\//, ''), base)
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value === undefined) continue
                url.searchParams.set(
                    key,
                    isStringArray(value) ? value.join(',') : String(value),
                )
            }
        }
        return url.toString()
    }

    private buildHeaders(req: HttpRequest): Headers {
        const headers = new Headers()
        headers.set('accept', 'application/json')
        headers.set('user-agent', this.settings.userAgent)
        for (const [k, v] of Object.entries(this.settings.defaultHeaders))
            headers.set(k, v)
        if (req.headers) {
            for (const [k, v] of Object.entries(req.headers)) headers.set(k, v)
        }
        // Last, so a stray header can never replace or duplicate the key.
        this.authorize(headers)
        return headers
    }

    private log(
        req: HttpRequest,
        outcome: string,
        attempt: number,
        requestId?: string,
    ): void {
        if (!this.settings.debug) return
        const msg =
            `${req.method} ${req.path} -> ${outcome} ` +
            `[attempt ${attempt}]` +
            (requestId ? ` req=${requestId}` : '')
        this.settings.debug(redact(msg))
    }

    toJSON(): Record<string, unknown> {
        return { baseUrl: this.settings.baseUrl }
    }

    [Symbol.for('nodejs.util.inspect.custom')](): string {
        return `HttpClient { baseUrl: ${JSON.stringify(this.settings.baseUrl)} }`
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isStringArray(value: QueryValue): value is readonly string[] {
    return Array.isArray(value)
}

function headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {}
    headers.forEach((value, key) => {
        record[key.toLowerCase()] = value
    })
    return record
}

async function parseJsonBody(response: Response): Promise<unknown> {
    const text = await response.text()
    if (text.trim() === '') return undefined
    try {
        return JSON.parse(text)
    } catch (err) {
        throw new APIConnectionError(
            `The API answered ${response.status} with a body that is not JSON.`,
            { cause: err },
        )
    }
}

async function readErrorBody(
    response: Response,
): Promise<{ problem: Problem | undefined; rawText: string | undefined }> {
    let text: string
    try {
        text = await response.text()
    } catch {
        return { problem: undefined, rawText: undefined }
    }
    if (text.trim() === '') return { problem: undefined, rawText: undefined }
    try {
        const parsed: unknown = JSON.parse(text)
        if (isProblem(parsed)) return { problem: parsed, rawText: text }
        return { problem: undefined, rawText: text }
    } catch {
        return { problem: undefined, rawText: text }
    }
}

function isProblem(value: unknown): value is Problem {
    if (typeof value !== 'object' || value === null) return false
    const v = value as Record<string, unknown>
    // A problem body always carries a machine `code` and a human `title`.
    return typeof v.code === 'string' && typeof v.title === 'string'
}

function isAbortError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        (err as { name?: unknown }).name === 'AbortError'
    )
}

/** A sleep that rejects with the signal's reason if the caller aborts mid-wait. */
function abortableSleep(
    ms: number,
    signal: AbortSignal | undefined,
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
            return
        }
        const timer = setTimeout(() => {
            cleanup()
            resolve()
        }, ms)
        const onAbort = () => {
            cleanup()
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        const cleanup = () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}
