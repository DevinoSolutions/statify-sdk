import type { HttpClient } from '../core/http'
import type { Usage } from '../types'
import type { RequestOptions } from './common'

/** `statify.usage`: the workspace's API usage against its daily quota. */
export class UsageResource {
    constructor(private readonly http: HttpClient) {}

    /**
     * `GET /v1/usage`: requests made in the current quota period (the UTC day),
     * the daily limit and what is left. Never counted against the quota, and it
     * still answers when the quota is spent.
     */
    async get(opts?: RequestOptions): Promise<Usage> {
        const { data } = await this.http.request<Usage>({
            method: 'GET',
            path: '/v1/usage',
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }
}
