// Smoke-test the BUILT package (dist/) on the running Node: the ESM entry and
// the CJS entry both load, construct a client and decode one response from a
// MOCK fetch. CI runs it on Node 20 (the engines floor), where vitest cannot run.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const MOCK_USAGE = {
    period: { start: '2026-11-03T00:00:00.000Z', end: '2026-11-04T00:00:00.000Z' },
    used: 1,
    limit: 10000,
    remaining: 9999,
    exempt: false,
}
const MOCK_fetch = async (url, init) => {
    assert.equal(new URL(String(url)).pathname, '/v1/usage')
    assert.match(new Headers(init.headers).get('authorization'), /^Bearer sta_live_/)
    return new Response(JSON.stringify(MOCK_USAGE), {
        status: 200,
        headers: { 'content-type': 'application/json', 'request-id': 'smoke' },
    })
}

const esm = await import('../dist/index.js')
const cjs = createRequire(import.meta.url)('../dist/index.cjs')

for (const [name, mod] of [['esm', esm], ['cjs', cjs]]) {
    const statify = new mod.Statify({ apiKey: 'sta_live_SMOKE000000', fetch: MOCK_fetch })
    assert.deepEqual(await statify.usage.get(), MOCK_USAGE)
    assert.equal(typeof mod.QuotaExhaustedError, 'function')
    console.log(`${name}: ok on node ${process.version}`)
}
