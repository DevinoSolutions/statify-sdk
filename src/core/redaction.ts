// Secret redaction for anything the SDK might emit (debug logs, error text
// snippets). The API key must NEVER reach a log sink or a thrown error
// verbatim. Applied at every emit point, not just once.

const API_KEY_PATTERN = /sta_(live|test)_[A-Za-z0-9_-]+/g
// Bearer <token> in any header dump: mask the token, keep the scheme.
const BEARER_PATTERN = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi

/**
 * Mask every known secret shape in a string. Idempotent and safe to call on any
 * user- or server-provided text before it is logged or attached to an error.
 */
export function redact(input: string): string {
    return input
        .replace(API_KEY_PATTERN, (_m, env: string) => `sta_${env}_***`)
        .replace(BEARER_PATTERN, '$1***')
}

/**
 * Mask one specific secret wherever it appears, even when it does not match the
 * `sta_live_` shape (a key from a future format, a test key).
 */
export function redactExact(input: string, secret: string): string {
    if (secret.length < 8) return redact(input)
    return redact(input.split(secret).join('***'))
}
