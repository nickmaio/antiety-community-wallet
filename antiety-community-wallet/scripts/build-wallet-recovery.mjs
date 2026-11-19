import { build } from 'vite'
import { readFile, writeFile, mkdir, readdir, copyFile, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import recoveryConfig from '../vite.config.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args=process.argv.slice(2)
if(args.length && (args.length!==2 || args[0]!=='--out-dir' || !args[1] || args[1].startsWith('--'))) {
  throw Error('Pass --out-dir with a new, isolated output directory')
}
const out = args.length ? resolve(args[1]) : join(root, 'dist-wallet-recovery')
if(args.length && await lstat(out).catch(error=>{if(error.code==='ENOENT')return null;throw error})) {
  throw Error('Explicit recovery output already exists; retain it and choose a new directory')
}
const workspace=fileURLToPath(new URL('../../',import.meta.url)),rendered=new Set()
const cryptoPath=join(workspace,'shared/wallet/generated/walletGenerationCrypto.js')
const cryptoMetadata=JSON.parse(await readFile(join(workspace,'shared/wallet/generated/walletGenerationCrypto.build.json'),'utf8'))
const cryptoSha256=createHash('sha256').update(await readFile(cryptoPath)).digest('hex')
if(cryptoSha256!==cryptoMetadata.sha256)throw Error('RECOVERY_CRYPTO_RUNTIME_CHANGED')
await build({ ...recoveryConfig, configFile:false,cacheDir:join(dirname(out),'recovery-vite-cache'),
  build:{...recoveryConfig.build,outDir:out,emptyOutDir:!args.length},plugins:[...recoveryConfig.plugins,{
  name:'audit-independent-recovery',generateBundle(_options,bundle){
    for(const chunk of Object.values(bundle))if(chunk.type==='chunk')for(const [id,module]of Object.entries(chunk.modules))
      if(module.renderedLength>0)rendered.add(relative(workspace,id.split('?')[0]).replaceAll('\\','/'))
  }
}] })
const forbidden=[...rendered].filter(path=>/^web_client\//.test(path)||/^server\//.test(path)||
  /(?:^|\/)nonCustodialWalletApi\.js$/.test(path)||/node_modules\/(?:axios|socket\.io-client|react-redux|@safe-global\/protocol-kit|@safe-global\/relay-kit|@antiety\/safe-relay-kit-4337)\//.test(path))
if(forbidden.length)throw Error('RECOVERY_BACKEND_OR_APP_DEPENDENCY: '+forbidden.join(', '))
const port=18747
await mkdir(join(out, 'launcher'), { recursive: true })
await copyFile(join(root, 'scripts/serve-wallet-recovery.mjs'), join(out, 'launcher/server.mjs'))
await writeFile(join(out, 'start.mjs'), `import { createRecoveryStaticServer } from './launcher/server.mjs'
import { fileURLToPath } from 'node:url'
try {
  const server = await createRecoveryStaticServer(fileURLToPath(new URL('./', import.meta.url)), {port:${port}})
  console.log('Wallet recovery: http://127.0.0.1:' + server.address().port)
  console.log('Ethereum mainnet. Keep this window open; Ctrl+C stops the local server.')
} catch {
  console.error('Could not start recovery. Check that port ${port} is free and use a current Node.js version.')
  process.exitCode = 1
}
`)
await writeFile(join(out, 'start.ps1'), "$ErrorActionPreference = 'Stop'\n& node (Join-Path $PSScriptRoot 'start.mjs')\n")
await writeFile(join(out, 'start.cmd'), '@echo off\r\nnode "%~dp0start.mjs"\r\npause\r\n')
await copyFile(join(root, 'README.md'), join(out, 'README.md'))
await writeFile(join(out,'RECOVERY-BUILD.json'),JSON.stringify({network:'Ethereum mainnet',chainIds:[1],slotCount:65536,originalExportsSupported:true,
  antietyBackendRequired:false,antietyLoginIncluded:false,sourceCryptoSha256:cryptoSha256,
  sourceCryptoMetadataSha256:createHash('sha256').update(await readFile(join(workspace,'shared/wallet/generated/walletGenerationCrypto.build.json'))).digest('hex'),
  cryptoProvenanceSchema:cryptoMetadata.provenance?.schema,renderedModules:[...rendered].sort()},null,2)+'\n')
await writeFile(join(out, '_headers'), `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src https:; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Cache-Control: no-store
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
`)
const hashes = {}
async function scan(directory, prefix = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${item.name}`
    if(item.isSymbolicLink())throw Error('RECOVERY_PACKAGE_LINK')
    if (item.isDirectory()) await scan(join(directory, item.name), `${relative}/`)
    else hashes[relative] = createHash('sha256').update(await readFile(join(directory, item.name))).digest('hex')
  }
}
await scan(out)
await writeFile(join(out, 'SHA256SUMS.json'), JSON.stringify({ version: 1, network: 'Ethereum mainnet',chainIds:[1], files: hashes }, null, 2) + '\n')
console.log('Standalone recovery package built; no runtime configuration, backup or credentials included.')
