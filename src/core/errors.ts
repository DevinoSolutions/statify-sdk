// The typed RFC 9457 error hierarchy. Mapping is code-driven first (the problem
// `code` registry in the v1 spec), with a status-class fallback so an UNKNOWN
// future `code` never throws the mapper: it maps by status instead
// (forward-compat). Every `.message` is `title: detail (request_id)` and NEVER
// contains the API key.

import type { FieldError, Problem, ProblemCode } from '../types'
import { parseRateLimit, type RateLimitInfo } from './rateLimit'
import { redact } from './redaction'
import { parseRetryAfterSeconds } from './retryPolicy'

/** Base class for every error this SDK throws. */
export class StatifyError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message)
        this.name = new.target.name
        if (options?.cause !== undefined) {
            // Preserve the underlying cause for debugging (network/DNS errors).
            ;(this as { cause?: unknown }).cause = options.cause
        }
        // Restore the prototype chain across the TS -> ES target down-level.
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

/** A transport-level failure (DNS, connection refused, TLS). `cause` is kept. */
export class APIConnectionError extends StatifyError {
    constructor(message = 'Connection error.', options?: { cause?: unknown }) {
        super(message, options)
    }
}

/** A per-attempt timeout elapsed (the request was aborted by the SDK deadline). */
export class APITimeoutError extends APIConnectionError {
    constructor(message = 'Request timed out.') {
        super(message)
    }
}

/** Fields shared by every HTTP-level (non-2xx) error. */
export interface APIErrorInit {
    status: number
    code: ProblemCode | undefined
    type: string | undefined
    title: string
    detail: string | undefined
    requestId: string | undefined
    errors: FieldError[] | undefined
    headers: Record<string, string>
}

/**
 * Any non-2xx response. The subclass is chosen by the problem `code`, then by
 * the HTTP status when the code is missing or new.
 */
export class APIError extends StatifyError {
    /** The HTTP status. */
    readonly status: number
    /** The stable problem `code` (switch on this, never on `title`/`message`). */
    readonly code: ProblemCode | undefined
    /** The problem `type` URI (its docs page). */
    readonly type: string | undefined
    /** The problem `title`. */
    readonly title: string
    /** The problem `detail`, or a short snippet of a non-JSON body. */
    readonly detail: string | undefined
    /** The `Request-Id` of the failing request: quote it to support. */
    readonly requestId: string | undefined
    /** Field-level failures (some `invalid_request` problems). Empty when none. */
    readonly errors: FieldError[]
    /** The response headers, lower-cased. */
    readonly headers: Record<string, string>
    /** `Retry-After`, in seconds, when the response carried one. */
    readonly retryAfterSeconds: number | undefined
    /** The rate-limit headers of the response, parsed. */
    readonly rateLimit: RateLimitInfo

    constructor(init: APIErrorInit) {
        super(APIError.buildMessage(init))
        this.status = init.status
        this.code = init.code
        this.type = init.type
        this.title = init.title
        this.detail = init.detail
        this.requestId = init.requestId
        this.errors = init.errors ?? []
        this.headers = init.headers
        this.retryAfterSeconds = parseRetryAfterSeconds(
            init.headers['retry-after'],
        )
        this.rateLimit = parseRateLimit(init.headers)
    }

    private static buildMessage(init: APIErrorInit): string {
        const base = init.detail ? `${init.title}: ${init.detail}` : init.title
        const withId = init.requestId ? `${base} (${init.requestId})` : base
        return redact(withId)
    }
}

/** 400 `invalid_request` (also the 422 fallback): a parameter, cursor or cap was refused. See `errors`. */
export class InvalidRequestError extends APIError {}
/** 401 `missing_credentials` / `invalid_api_key`: no key, or the key is unknown, revoked or expired. */
export class AuthenticationError extends APIError {}
/**
 * 403 `insufficient_scope` / `unsupported_credential_type` / `workspace_required`
 * / `feature_not_enabled`: the key cannot call this operation.
 */
export class PermissionDeniedError extends APIError {}
/** 404 `resource_not_found`: e.g. this workspace tracks no app with that slug. */
export class NotFoundError extends APIError {}
/** 409 (e.g. `idempotency_in_progress`). Not expected on the read-only v1 surface. */
export class ConflictError extends APIError {}
/**
 * 429 `rate_limited`: the API key is over its per-minute burst limit. Retried
 * automatically after `Retry-After`; you see it only once retries are spent.
 */
export class RateLimitError extends APIError {}
/**
 * 429 `quota_exhausted`: the workspace used its daily request quota (resets at
 * 00:00 UTC). NEVER retried automatically: `retryAfterSeconds` can be hours.
 * `GET /v1/usage` still answers while the quota is spent.
 */
export class QuotaExhaustedError extends APIError {}
/** 5xx (`internal_error`, or a proxy failure). Retried automatically for 500/502/503/504. */
export class APIServerError extends APIError {}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

type APIErrorClass = new (init: APIErrorInit) => APIError

/** Code -> subclass (the primary mapping; every code the v1 spec registers). */
const CODE_TO_CLASS: Record<string, APIErrorClass> = {
    missing_credentials: AuthenticationError,
    invalid_api_key: AuthenticationError,
    unsupported_credential_type: PermissionDeniedError,
    insufficient_scope: PermissionDeniedError,
    workspace_required: PermissionDeniedError,
    feature_not_enabled: PermissionDeniedError,
    resource_not_found: NotFoundError,
    invalid_request: InvalidRequestError,
    idempotency_in_progress: ConflictError,
    idempotency_key_reused: InvalidRequestError,
    rate_limited: RateLimitError,
    quota_exhausted: QuotaExhaustedError,
    internal_error: APIServerError,
}

/** Status class -> subclass (fallback when the code is missing or unknown). */
function classByStatus(status: number): APIErrorClass {
    switch (status) {
        case 400:
        case 422:
            return InvalidRequestError
        case 401:
            return AuthenticationError
        case 403:
            return PermissionDeniedError
        case 404:
            return NotFoundError
        case 409:
            return ConflictError
        case 429:
            // Unknown/absent code at 429 -> a plain rate limit (retryable).
            // quota_exhausted only ever comes from the code map.
            return RateLimitError
        default:
            if (status >= 500) return APIServerError
            return APIError
    }
}

/**
 * Build the right APIError subclass from a parsed problem body (or a raw
 * non-JSON snippet). By `code` first; by status class when the code is absent
 * or unknown. Never throws.
 */
export function createApiError(input: {
    status: number
    problem: Problem | undefined
    rawText: string | undefined
    headers: Record<string, string>
}): APIError {
    const { status, problem, rawText, headers } = input

    const code = problem?.code
    const Ctor =
        (code !== undefined && Object.hasOwn(CODE_TO_CLASS, code)
            ? CODE_TO_CLASS[code]
            : undefined) ?? classByStatus(status)

    // Non-JSON body (proxy 502 HTML, Cloudflare): fold a bounded, redacted
    // snippet into `detail` so the failure is still legible.
    const snippet =
        problem === undefined && rawText !== undefined && rawText.trim() !== ''
            ? redact(rawText.slice(0, 500))
            : undefined

    return new Ctor({
        status,
        code,
        type: problem?.type,
        title: problem?.title ?? `HTTP ${status}`,
        detail: problem?.detail ?? snippet,
        requestId: problem?.request_id ?? headers['request-id'],
        errors: problem?.errors,
        headers,
    })
}
