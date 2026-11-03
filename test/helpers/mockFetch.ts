// ============================================================================
// TEST FAKE: NOT part of the shipped SDK. A scripted stand-in for `fetch` that
// records every request and answers from a per-test handler. Nothing here
// mirrors production auth or logic. Real problem bodies come from the v1 spec
// (see MOCK_problem below).
// ============================================================================

export interface MOCK_RecordedRequest {
    url: URL
    method: string
    /** Lower-cased request headers. */
    headers: Record<string, string>
}

export interface MOCK_Reply {
    status: number
    /** Object -> JSON; string -> sent verbatim. */
    body?: unknown
    headers?: Record<string, string>
}

export type MOCK_Handler = (
    req: MOCK_RecordedRequest,
    callIndex: number,
) => MOCK_Reply | Promise<MOCK_Reply>

export interface MOCK_Fetch {
    fetch: typeof fetch
    requests: MOCK_RecordedRequest[]
}

export const MOCK_API_KEY = 'sta_live_MOCKkey1234567890abcdef'
export const MOCK_REQUEST_ID = '0b6f5d2e-4c1a-4f38-9d1e-2a7c9b1e5f00'

/** A fetch that answers from `handler` and records every call. */
export function MOCK_createFetch(handler: MOCK_Handler): MOCK_Fetch {
    const requests: MOCK_RecordedRequest[] = []
    const fetchImpl = (async (
        input: string | URL | Request,
        init?: RequestInit,
    ): Promise<Response> => {
        const headers: Record<string, string> = {}
        new Headers(init?.headers).forEach((v, k) => {
            headers[k.toLowerCase()] = v
        })
        const req: MOCK_RecordedRequest = {
            url: new URL(String(input)),
            method: init?.method ?? 'GET',
            headers,
        }
        const index = requests.length
        requests.push(req)
        const reply = await handler(req, index)
        const isJson = typeof reply.body !== 'string'
        const contentType =
            reply.status >= 400
                ? 'application/problem+json'
                : 'application/json'
        return new Response(
            reply.body === undefined
                ? null
                : isJson
                  ? JSON.stringify(reply.body)
                  : (reply.body as string),
            {
                status: reply.status,
                headers: {
                    'content-type': isJson ? contentType : 'text/html',
                    'request-id': MOCK_REQUEST_ID,
                    ...reply.headers,
                },
            },
        )
    }) as typeof fetch
    return { fetch: fetchImpl, requests }
}

/** A fetch that rejects like a refused connection. */
export function MOCK_failingFetch(): MOCK_Fetch {
    const requests: MOCK_RecordedRequest[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
        requests.push({ url: new URL(String(input)), method: 'GET', headers: {} })
        throw new TypeError('fetch failed')
    }) as typeof fetch
    return { fetch: fetchImpl, requests }
}

/** The titles the v1 spec registers per code (Problem.code enum). */
const MOCK_TITLES: Record<string, [number, string]> = {
    missing_credentials: [401, 'Authentication required'],
    invalid_api_key: [401, 'The API key was refused'],
    unsupported_credential_type: [403, 'This credential type cannot call this API'],
    insufficient_scope: [403, 'The credential lacks the required scope'],
    workspace_required: [403, 'No workspace is selected for this credential'],
    feature_not_enabled: [403, 'This feature is not enabled for the workspace'],
    resource_not_found: [404, 'Resource not found'],
    invalid_request: [400, 'The request is invalid'],
    rate_limited: [429, 'Too many requests'],
    quota_exhausted: [429, 'The plan quota is used up'],
    internal_error: [500, 'Something went wrong on our side'],
}

/** A problem body exactly as the server's `buildProblem` writes it. */
export function MOCK_problem(
    code: string,
    extra: { detail?: string; errors?: unknown[]; status?: number; title?: string } = {},
): { status: number; body: Record<string, unknown> } {
    const [status, title] = MOCK_TITLES[code] ?? [extra.status ?? 400, extra.title ?? 'Unknown']
    return {
        status,
        body: {
            type: `https://statify.now/docs/api/problems/${code}`,
            title,
            status,
            ...(extra.detail === undefined ? {} : { detail: extra.detail }),
            instance: `urn:request:${MOCK_REQUEST_ID}`,
            code,
            request_id: MOCK_REQUEST_ID,
            ...(extra.errors === undefined ? {} : { errors: extra.errors }),
        },
    }
}

/** A `StatsSeries` fixture shaped like the spec's example. */
export function MOCK_series(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        metric: 'downloads',
        family: 'downloads',
        store: 'apple',
        label: 'downloads (apple)',
        aggregation: 'sum',
        quality: 'privacy_noised',
        latest_date: '2026-10-30',
        lag_days: 2,
        complete_through: '2026-10-28',
        stale: false,
        days_stale: 4,
        total: 412,
        compare_total: null,
        change_pct: null,
        currency: null,
        conversion_basis: null,
        points: [
            { date: '2026-10-29', value: 10 },
            { date: '2026-10-30', value: 12 },
        ],
        ...overrides,
    }
}
