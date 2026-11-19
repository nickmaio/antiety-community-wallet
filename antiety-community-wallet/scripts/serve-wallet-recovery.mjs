import { createServer } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const recoveryHeaders = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src https:; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'cache-control': 'no-store', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'x-frame-options': 'DENY', 'cross-origin-opener-policy': 'same-origin', 'x-robots-tag': 'noindex, nofollow',
}

/** Local static files only: no upload, RPC proxy, signing service or remote binding. */
export async function createRecoveryStaticServer(directory, { port = 18747 } = {}) {
  const root = await realpath(resolve(directory))
  await readFile(resolve(root, 'index.html'))
  const server = createServer(async (request, response) => {
    for (const [name, value] of Object.entries(recoveryHeaders)) response.setHeader(name, value)
    const hosts = new Set([`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`])
    if (!hosts.has(request.headers.host)) { response.writeHead(403); response.end('Forbidden host'); return }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { allow: 'GET, HEAD' }); response.end('Static files only'); return
    }
    let path
    try { path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname) }
    catch { response.writeHead(400); response.end('Invalid path'); return }
    if (path === '/') path = '/index.html'
    const contentType = path === '/index.html' ? 'text/html; charset=utf-8'
      : path === '/favicon.ico' ? 'image/x-icon'
      : path === '/assets/antiety-logo.png' ? 'image/png'
      : /^\/assets\/[a-zA-Z0-9_-]+\.js$/.test(path) ? 'text/javascript; charset=utf-8'
      : /^\/assets\/[a-zA-Z0-9_-]+\.css$/.test(path) ? 'text/css; charset=utf-8'
      : null
    if (!contentType) {
      response.writeHead(404); response.end('Not found'); return
    }
    try {
      const target = await realpath(resolve(root, `.${path}`))
      if (!target.startsWith(root + sep)) throw new Error('Outside static root')
      const bytes = await readFile(target)
      response.setHeader('content-type', contentType)
      response.writeHead(200); response.end(request.method === 'HEAD' ? undefined : bytes)
    } catch { response.writeHead(404); response.end('Not found') }
  })
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes) })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = process.argv[2] || fileURLToPath(new URL('../dist-wallet-recovery/', import.meta.url))
    const server = await createRecoveryStaticServer(root)
    console.log(`Wallet recovery: http://127.0.0.1:${server.address().port}`)
    console.log('Ethereum mainnet. Keep this window open; Ctrl+C stops the local server.')
  } catch {
    console.error('Could not start recovery. Build it first and check that port 18747 is free.')
    process.exitCode = 1
  }
}
