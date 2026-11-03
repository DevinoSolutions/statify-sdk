// Rate-limit headers, parsed. Statify sends BOTH the IETF draft-11 pair and the
// classic X-RateLimit-* trio on every counted response:
//
//   RateLimit-Policy: "per-key-minute";q=60;w=60, "per-workspace-day";q=10000;w=86400
//   RateLimit:        "per-key-minute";r=42;t=60
//   X-RateLimit-Limit / -Remaining / -Reset (Unix epoch seconds)
//
// The policy list is the API key's burst allowance, then the workspace's daily
// quota (absent for an exempt workspace). `RateLimit` is the state of the FIRST
// policy, except on a `quota_exhausted` 429 where it is the daily quota.

/** One entry of `RateLimit-Policy`. */
export interface RateLimitPolicy {
    /** Policy name, e.g. `per-key-minute` or `per-workspace-day`. */
    name: string
    /** Requests allowed per window (`q`). */
    quota: number | undefined
    /** Window length in seconds (`w`). */
    windowSeconds: number | undefined
}

/** The `RateLimit` header: the state of one policy right now. */
export interface RateLimitState {
    /** The policy this state is about. */
    policy: string
    /** Requests left in the window (`r`). */
    remaining: number | undefined
    /** Seconds until the window frees up (`t`). */
    resetSeconds: number | undefined
}

/** Everything the rate-limit headers of one response say. Absent headers are undefined. */
export interface RateLimitInfo {
    /** The policies in force (`RateLimit-Policy`), burst first, daily quota second. */
    policies: RateLimitPolicy[]
    /** The current state (`RateLimit`). */
    current: RateLimitState | undefined
    /** `X-RateLimit-Limit`: requests allowed in the window. */
    limit: number | undefined
    /** `X-RateLimit-Remaining`: requests left in the window. */
    remaining: number | undefined
    /** `X-RateLimit-Reset`: Unix epoch seconds at which the window frees up. */
    resetAt: number | undefined
}

/** Parse the rate-limit headers out of a lower-cased header record. Never throws. */
export function parseRateLimit(headers: Record<string, string>): RateLimitInfo {
    const policies = splitList(headers['ratelimit-policy']).map(item => {
        const { name, params } = parseItem(item)
        return {
            name,
            quota: toNumber(params.q),
            windowSeconds: toNumber(params.w),
        }
    })
    const currentItem = splitList(headers.ratelimit)[0]
    let current: RateLimitState | undefined
    if (currentItem !== undefined) {
        const { name, params } = parseItem(currentItem)
        current = {
            policy: name,
            remaining: toNumber(params.r),
            resetSeconds: toNumber(params.t),
        }
    }
    return {
        policies,
        current,
        limit: toNumber(headers['x-ratelimit-limit']),
        remaining: toNumber(headers['x-ratelimit-remaining']),
        resetAt: toNumber(headers['x-ratelimit-reset']),
    }
}

// A structured-field list: items separated by commas (no commas inside our
// quoted names, so a plain split is exact for what Statify sends).
function splitList(value: string | undefined): string[] {
    if (value === undefined) return []
    return value
        .split(',')
        .map(s => s.trim())
        .filter(s => s !== '')
}

function parseItem(item: string): {
    name: string
    params: Record<string, string>
} {
    const [rawName = '', ...rawParams] = item.split(';').map(s => s.trim())
    const name = rawName.replace(/^"(.*)"$/, '$1')
    const params: Record<string, string> = {}
    for (const p of rawParams) {
        const eq = p.indexOf('=')
        if (eq === -1) continue
        params[p.slice(0, eq).trim()] = p.slice(eq + 1).trim()
    }
    return { name, params }
}

function toNumber(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === '') return undefined
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
}
