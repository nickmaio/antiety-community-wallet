'use strict'

const assert = require('node:assert/strict')
const {mkdtempSync} = require('node:fs')
const {tmpdir} = require('node:os')
const {join} = require('node:path')
const {app} = require('electron')
const {prepareSession, openWalletWindow} = require('./app/main.cjs')

// Avoid opening or changing the installed app's browser profile when testing.
app.setPath('userData', mkdtempSync(join(tmpdir(), 'antiety-desktop-smoke-')))
const timeout = setTimeout(() => app.exit(1), 20000)
app.whenReady().then(async () => {
  await prepareSession()
  const window = await openWalletWindow({show: false})
  const result = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 40 && !document.querySelector('#generation-file'); i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const storage = await new Promise(resolve => {
      const request = indexedDB.open('desktop-smoke')
      request.onerror = () => resolve(false)
      request.onsuccess = () => { request.result.close(); resolve(true) }
    })
    const lock = await navigator.locks.request('desktop-smoke', {ifAvailable: true}, value => !!value)
    return {
      origin: location.origin, secure: isSecureContext,
      crypto: !!(await crypto.subtle.digest('SHA-256', new Uint8Array([1]))),
      storage, lock, hasNode: typeof require !== 'undefined' || typeof process !== 'undefined',
      hasHeading: !!document.querySelector('#recovery-heading')?.textContent,
      canReadBackup: !!document.querySelector('input[type=file]'),
      hasStyle: getComputedStyle(document.querySelector('.wallet-layout')).display === 'grid',
    }
  })()`)
  assert.deepEqual(result, {
    origin: 'antiety-wallet://community', secure: true, crypto: true, storage: true, lock: true, hasNode: false,
    hasHeading: true, canReadBackup: true, hasStyle: true,
  })
  console.log('Desktop wallet smoke test passed')
  window.destroy()
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) }).finally(() => clearTimeout(timeout))
