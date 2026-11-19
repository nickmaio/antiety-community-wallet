'use strict'

const {app, BrowserWindow, protocol, session, Menu} = require('electron')
const {join} = require('node:path')
const {readFile} = require('node:fs/promises')

const home = 'antiety-wallet://community/index.html'
const partition = 'persist:antiety-community-wallet'
const wallet = join(__dirname, 'wallet')

protocol.registerSchemesAsPrivileged([{
  scheme: 'antiety-wallet',
  privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true},
}])

function contentType(path) {
  if (path === '/index.html') return 'text/html; charset=utf-8'
  if (path === '/favicon.ico') return 'image/x-icon'
  if (path === '/assets/antiety-logo.png') return 'image/png'
  if (/^\/assets\/[A-Za-z0-9_-]+\.js$/.test(path)) return 'text/javascript; charset=utf-8'
  if (/^\/assets\/[A-Za-z0-9_-]+\.css$/.test(path)) return 'text/css; charset=utf-8'
  return null
}

async function prepareSession() {
  const storage = session.fromPartition(partition)
  const headers = JSON.parse(await readFile(join(wallet, 'headers.json'), 'utf8'))
  function canUsePermission(permission, requestingUrl) {
    if (permission !== 'clipboard-sanitized-write') return false
    try {
      const url = new URL(requestingUrl)
      return url.protocol === 'antiety-wallet:' && url.host === 'community'
    } catch {
      return false
    }
  }
  storage.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    canUsePermission(permission, requestingOrigin))
  storage.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(canUsePermission(permission, details.requestingUrl)))
  storage.protocol.handle('antiety-wallet', async request => {
    const url = new URL(request.url)
    const path = url.pathname
    const type = contentType(path)
    if (url.host !== 'community' || url.username || url.password || !type) {
      return new Response(null, {status: 404, headers})
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, {status: 405, headers: {...headers, Allow: 'GET, HEAD'}})
    }
    try {
      const body = await readFile(join(wallet, path.slice(1)))
      return new Response(request.method === 'HEAD' ? null : body, {headers: {...headers, 'Content-Type': type}})
    } catch {
      return new Response(null, {status: 404, headers})
    }
  })
}

function createWalletWindow({show = true} = {}) {
  const window = new BrowserWindow({
    title: 'Antiety Community Wallet',
    width: 1120,
    height: 820,
    minWidth: 360,
    minHeight: 500,
    show: false,
    backgroundColor: '#131517',
    icon: join(wallet, 'assets', 'antiety-logo.png'),
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-redirect', event => event.preventDefault())
  if (show) window.once('ready-to-show', () => window.show())
  return window
}

async function openWalletWindow(options) {
  const window = createWalletWindow(options)
  await window.loadURL(home)
  return window
}

if (require.main === module) {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    let mainWindow
    const open = async () => { mainWindow = await openWalletWindow() }
    const onError = error => { console.error('Community Wallet could not start:', error.message); app.exit(1) }
    app.whenReady().then(async () => {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        {role: 'appMenu'}, {role: 'editMenu'}, {role: 'viewMenu', submenu: [{role: 'reload'}, {role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'}]},
      ]))
      await prepareSession()
      await open()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) open().catch(onError)
      })
    }).catch(onError)
    app.on('second-instance', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    })
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  }
}

module.exports = {prepareSession, openWalletWindow}
