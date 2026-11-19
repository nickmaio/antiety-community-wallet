import {copyFile, lstat, mkdir, readdir, realpath} from 'node:fs/promises'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const [target] = process.argv.slice(2)
if (!target || process.argv.length !== 3) throw Error('Pass one new destination directory')
const wallet = await realpath(fileURLToPath(new URL('../', import.meta.url)))
const workspace = dirname(wallet)
const destination = resolve(target)
const relativeDestination = relative(wallet, destination)
if (!relativeDestination || !isAbsolute(relativeDestination) &&
    relativeDestination !== '..' && !relativeDestination.startsWith('..' + sep)) {
  throw Error('Export to a directory outside the wallet project')
}

const files = new Map()
function include(source, output = source) {
  files.set(output, join(workspace, source))
}

const root = 'antiety-community-wallet/'
for (const name of ['.gitignore', 'index.html', 'README.md', 'package.json', 'package-lock.json', 'vite.config.mjs',
  'public/favicon.ico', 'public/assets/antiety-logo.png', 'desktop/icon.png', 'desktop/README.md',
  'desktop/package.json', 'desktop/package-lock.json', 'desktop/electron-builder.yml', 'desktop/git-attributes',
  'desktop/app/main.cjs', 'desktop/app/package.json', 'desktop/stage.mjs', 'desktop/smoke.cjs']) {
  include(root + name)
}
for (const [folder, pattern] of [
  ['src', /^[A-Za-z0-9_-]+\.(?:js|jsx|css)$/],
  ['hosting', /^[A-Za-z0-9_-]+\.js$/],
  ['scripts', /^[A-Za-z0-9_-]+\.(?:mjs|ps1)$/],
  ['scripts/lib', /^[A-Za-z0-9_-]+\.mjs$/],
  ['tests', /^[A-Za-z0-9_-]+\.test\.mjs$/],
]) {
  for (const name of await readdir(join(wallet, folder))) {
    if (pattern.test(name)) include(root + folder + '/' + name)
  }
}
for (const name of [
  'shared/package.json',
  ...['amounts.js', 'assets.js', 'browserOrigins.js', 'originProofHostingPolicy.js', 'mainnetGenerationPins.js',
    'recoveryExecution.js', 'recoveryRecord.js', 'recoveryRpc.js', 'recoverySubmission.js',
    'safeProxyCreationCode.js', 'webAuthnProof.js', 'generated/walletGenerationCrypto.js',
    'generated/walletGenerationCrypto.build.json', 'generation/profile.js', 'generation/recovery.js',
    'generation/generated/mainnetInventorySimulation.js'].map(name => 'shared/wallet/' + name),
]) {
  include(name)
}
include(root + 'desktop/README.md', 'README.md')
include(root + 'desktop/git-attributes', '.gitattributes')
const workflow = '.github/workflows/desktop.yml'
const localWorkflow = join(wallet, workflow)
files.set(workflow, await lstat(localWorkflow).then(() => localWorkflow, error => {
  if (error.code !== 'ENOENT') throw error
  return join(workspace, workflow)
}))

for (const source of files.values()) {
  const info = await lstat(source)
  if (!info.isFile() || info.isSymbolicLink() || await realpath(source) !== source) {
    throw Error('Expected a regular source file within the project: ' + relative(workspace, source))
  }
}
await mkdir(destination)
for (const [name, source] of files) {
  const targetFile = join(destination, name)
  await mkdir(dirname(targetFile), {recursive: true})
  await copyFile(source, targetFile)
}
console.log(`Exported ${files.size} source and workflow files to ${destination}`)
