import {copyFile, lstat, mkdir, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import {dirname, join, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {verifyWalletRecoveryPackage} from '../scripts/verify-wallet-recovery-package.mjs'
import {recoveryHostingHeaders} from '../hosting/policy.js'

const build = fileURLToPath(new URL('../dist-wallet-recovery/', import.meta.url))
await verifyWalletRecoveryPackage(build)
const manifest = JSON.parse(await readFile(join(build, 'SHA256SUMS.json'), 'utf8'))
const assets = Object.keys(manifest.files).filter(name =>
  ['index.html', 'favicon.ico', 'assets/antiety-logo.png'].includes(name) ||
  /^assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(name))

const desktop = await realpath(fileURLToPath(new URL('./', import.meta.url)))
const app = await realpath(join(desktop, 'app'))
if (app !== join(desktop, 'app')) throw Error('Desktop app directory must be local to this project')
const destination = join(app, 'wallet')
const previous = await lstat(destination).catch(error => {
  if (error.code !== 'ENOENT') throw error
})
if (previous) {
  if (!previous.isDirectory() || previous.isSymbolicLink() || await realpath(destination) !== destination ||
      !destination.startsWith(app + sep)) throw Error('Unsafe desktop staging directory')
  await rm(destination, {recursive: true})
}
await mkdir(join(destination, 'assets'), {recursive: true})
for (const name of assets) {
  await copyFile(join(build, name), join(destination, name))
}
await writeFile(join(destination, 'headers.json'), JSON.stringify(recoveryHostingHeaders))
console.log(`Staged ${assets.length} verified static wallet files for desktop packaging`)
