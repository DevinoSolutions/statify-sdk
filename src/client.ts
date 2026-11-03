// The Statify client. The API key lives in a CLOSURE inside the HttpClient,
// never as an instance field, so `JSON.stringify(client)` and
// `util.inspect(client)` cannot leak it. A custom inspect + toJSON make that
// explicit and pin it in tests.

import type {
    APIResponse,
    AuthHeader,
    FetchLike,
    QueryParams,
} from './core/http'
import { HttpClient } from './core/http'
import { redactExact } from './core/redaction'
import { AppsResource } from './resources/apps'
import { FreshnessResource } from './resources/freshness'
import { StatsResource } from './resources/stats'
import { UsageResource } from './resources/usage'
import { VERSION } from './version'

const DEFAULT_BASE_URL = 'https://app.statify.now'
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_RETRIES = 2

export interface StatifyOptions {
    /**
     * Your workspace API key (`sta_live_...`). Falls back to
     * `process.env.STATIFY_API_KEY`. The constructor throws if neither is set.
     */
    apiKey?: string
    /** API origin. Default `https://app.statify.now` (paths already include `/v1`). */
    baseUrl?: string
    /** Per-attempt timeout in ms (default 60000). */
    timeoutMs?: number
    /** Retries after the first attempt (default 2). `0` disables retries. */
    maxRetries?: number
    /** Override the fetch implementation (tests, proxies, custom agents). */
    fetch?: FetchLike
    /** Headers sent on every request. They can never replace the API key header. */
    defaultHeaders?: Record<string, string>
    /**
     * Which documented header carries the key: `bearer` (default,
     * `Authorization: Bearer <key>`) or `x-api-key`.
     */
    authHeader?: AuthHeader
    /**
     * Debug logging. `true` logs method/path/status/attempt/request-id to
     * stderr; a function receives the same (already-redacted) strings. Never
     * logs headers or bodies.
     */
    debug?: boolean | ((message: string) => void)
    /**
     * Allow construction in a browser-like environment. Default false: the
     * constructor throws when `window` is defined, because a secret API key must
     * not ship to a browser. Set true only behind a deliberate proxy setup.
     */
    dangerouslyAllowBrowser?: boolean
}

/** Options for the raw `statify.request` escape hatch. */
export interface RawRequestOptions {
    /** Default `GET`. Only GET/HEAD requests are ever retried. */
    method?: string
    /** A path under the base URL, e.g. `/v1/apps`. */
    path: string
    query?: QueryParams
    headers?: Record<string, string>
    signal?: AbortSignal
    timeoutMs?: number
}

export class Statify {
    /** `GET /v1/apps`, `GET /v1/apps/{slug}/stats`. */
    readonly apps: AppsResource
    /** `GET /v1/stats`. */
    readonly stats: StatsResource
    /** `GET /v1/freshness`. */
    readonly freshness: FreshnessResource
    /** `GET /v1/usage`. */
    readonly usage: UsageResource

    /** The resolved base URL (safe to expose: no secret). */
    readonly baseUrl: string

    // Drives the escape hatch; the key lives in the closure inside it.
    private readonly http: HttpClient

    constructor(options: StatifyOptions = {}) {
        const apiKey = options.apiKey ?? readEnvKey()
        if (!apiKey) {
            throw new Error(
                'Missing Statify API key. Pass `new Statify({ apiKey })` or set ' +
                    'the STATIFY_API_KEY environment variable.',
            )
        }

        const hasWindow =
            typeof (globalThis as { window?: unknown }).window !== 'undefined'
        if (!options.dangerouslyAllowBrowser && hasWindow) {
            throw new Error(
                'Statify was constructed in a browser-like environment. Your ' +
                    'API key is a secret and must stay server-side. If you have ' +
                    'a deliberate proxy setup, pass `dangerouslyAllowBrowser: true`.',
            )
        }

        this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL

        const rawDebug = options.debug
        const safe = (message: string) => redactExact(message, apiKey)
        const debug =
            rawDebug === true
                ? (message: string) => {
                      process.stderr.write(`[statify] ${safe(message)}\n`)
                  }
                : typeof rawDebug === 'function'
                  ? (message: string) => rawDebug(safe(message))
                  : undefined

        const fetchImpl = options.fetch ?? globalThis.fetch
        if (typeof fetchImpl !== 'function') {
            throw new Error(
                'No fetch implementation found. Use Node.js >= 20, or pass `fetch`.',
            )
        }

        this.http = new HttpClient({
            baseUrl: this.baseUrl,
            apiKey,
            authHeader: options.authHeader ?? 'bearer',
            fetchImpl,
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
            userAgent: `statify-sdk-ts/${VERSION}`,
            defaultHeaders: options.defaultHeaders ?? {},
            debug,
        })

        this.apps = new AppsResource(this.http)
        this.stats = new StatsResource(this.http)
        this.freshness = new FreshnessResource(this.http)
        this.usage = new UsageResource(this.http)
    }

    /**
     * Raw escape hatch: call any path with the client's auth, retries and error
     * mapping, and get the decoded body together with the `Response`, the
     * `Request-Id` and the parsed rate-limit headers.
     *
     * ```ts
     * const { data, requestId, rateLimit } = await statify.request<Usage>({ path: '/v1/usage' })
     * ```
     */
    async request<T = unknown>(
        options: RawRequestOptions,
    ): Promise<APIResponse<T>> {
        return this.http.request<T>({
            method: options.method ?? 'GET',
            path: options.path,
            query: options.query,
            headers: options.headers,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
        })
    }

    /** Never serialize the client: it could tempt a key leak. */
    toJSON(): Record<string, unknown> {
        return { baseUrl: this.baseUrl }
    }

    [Symbol.for('nodejs.util.inspect.custom')](): string {
        return `Statify { baseUrl: ${JSON.stringify(this.baseUrl)} }`
    }
}

function readEnvKey(): string | undefined {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process
    return proc?.env?.STATIFY_API_KEY
}

export default Statify
