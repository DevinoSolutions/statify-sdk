// Cursor pagination. A `Page<T>` is one server page PLUS a bound fetcher for the
// next one, so iterating reuses the ORIGINAL query params and only advances the
// opaque `after` cursor (server-side a cursor only works with the exact query
// that produced it, so the other params are never mutated).

import type { ListEnvelope } from '../types'

/** Fetch one page given a cursor (undefined = first page). */
export type PageFetcher<P> = (cursor: string | undefined) => Promise<P>

/**
 * One page of a cursor-paginated collection. Async-iterable: `for await (const
 * item of page)` walks EVERY item across all following pages; `.nextPage()`
 * fetches the next page manually (or `null` at the end).
 */
export class Page<T> implements AsyncIterable<T> {
    /** The rows on this page. */
    readonly data: T[]
    /** Whether another page exists after this one. */
    readonly hasMore: boolean
    /** Opaque cursor for the next page (send it as `after`), or null on the last page. */
    readonly nextCursor: string | null

    protected readonly fetchNext: PageFetcher<Page<T>>

    constructor(envelope: ListEnvelope<T>, fetchNext: PageFetcher<Page<T>>) {
        this.data = envelope.data
        this.hasMore = envelope.has_more
        this.nextCursor = envelope.next_cursor
        this.fetchNext = fetchNext
    }

    /** Fetch the next page, or `null` if this is the last one. */
    async nextPage(): Promise<Page<T> | null> {
        if (!this.hasMore || this.nextCursor === null) return null
        return this.fetchNext(this.nextCursor)
    }

    async *[Symbol.asyncIterator](): AsyncIterator<T> {
        let page: Page<T> | null = this
        while (page !== null) {
            for (const item of page.data) yield item
            page = await page.nextPage()
        }
    }
}
