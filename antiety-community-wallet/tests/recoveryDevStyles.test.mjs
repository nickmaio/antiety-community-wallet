import test from 'node:test'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'

test('Vite serves the wallet stylesheet as CSS under the same-origin style policy', async t => {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.mjs', import.meta.url)),
    logLevel: 'silent',
    server: {host: '127.0.0.1', port: 0},
  })
  t.after(() => server.close())
  await server.listen()
  const origin = new URL('http://127.0.0.1:' + server.httpServer.address().port)
  const page = await fetch(origin)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /style-src 'self';/)
  assert.doesNotMatch(html, /unsafe-inline/)
  const stylesheet = html.match(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/)?.[1]
  assert.ok(stylesheet, 'The wallet loads its stylesheet through a link')
  const url = new URL(stylesheet, origin)
  assert.equal(url.origin, origin.origin)

  const response = await fetch(url, {headers: {Accept: 'text/css,*/*;q=0.1'}})
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^text\/css\b/)
  assert.match(await response.text(), /\.wallet-shell\s*\{/)
})
