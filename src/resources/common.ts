// Shared option shape for every resource method's trailing `opts?` argument.

export interface RequestOptions {
    /** Abort the request (and any pending retries) via an AbortSignal. */
    signal?: AbortSignal
    /** Override the client's per-attempt timeout for this call, in ms. */
    timeoutMs?: number
    /** Extra headers merged onto this request (they can never replace the API key header). */
    headers?: Record<string, string>
}
