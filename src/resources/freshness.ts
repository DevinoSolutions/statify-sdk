import type { HttpClient } from '../core/http'
import type { Freshness } from '../types'
import type { RequestOptions } from './common'

/** `statify.freshness`: how current the workspace's data is. */
export class FreshnessResource {
    constructor(private readonly http: HttpClient) {}

    /**
     * `GET /v1/freshness`: how far each source's data reaches (per store and per
     * app x store), the last sync per adapter, and the warnings to read before
     * trusting a number.
     */
    async get(opts?: RequestOptions): Promise<Freshness> {
        const { data } = await this.http.request<Freshness>({
            method: 'GET',
            path: '/v1/freshness',
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }
}
