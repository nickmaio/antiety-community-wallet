import {build} from 'esbuild'
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {join,resolve} from 'node:path'

const [sourceArg,outArg]=process.argv.slice(2)
if(!sourceArg||!outArg)throw Error('CANDIDATE_AND_NEW_OUTPUT_REQUIRED')
const source=resolve(sourceArg),out=resolve(outArg),project=fileURLToPath(new URL('../',import.meta.url))
const manifest=JSON.parse(await readFile(join(source,'STAGING.json')))
if(manifest.stage!=='origin-compatible-recovery-hosting'||manifest.deployed!==false)throw Error('STAGED_CANDIDATE_REQUIRED')
await mkdir(out) // Never replace an existing directory.
await cp(source,join(out,'candidate'),{recursive:true,errorOnExist:true,force:false})
await build({entryPoints:[join(project,'scripts/verify-compatible-recovery.mjs')],outfile:join(out,'verify-baseline.mjs'),
  bundle:true,platform:'node',format:'esm',target:'node20',logLevel:'silent'})
await writeFile(join(out,'run-baseline.ps1'),`$ErrorActionPreference = 'Stop'\n& node (Join-Path $PSScriptRoot 'verify-baseline.mjs') (Join-Path $PSScriptRoot 'candidate') --public-baseline\nif ($LASTEXITCODE -ne 0) { Write-Host 'Baseline check failed; share only the error and do not deploy.' }\n`)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
await writeFile(join(out,'BASELINE-CHECK.json'),JSON.stringify({stage:'standalone-recovery-baseline-check',
  verifierSha256:hash(await readFile(join(out,'verify-baseline.mjs'))),candidateManifestSha256:hash(await readFile(join(out,'candidate/STAGING.json'))),
  candidateFiles:Object.keys(manifest.files).length,networkUsedByBuild:false,deployed:false},null,2)+'\n')
console.log(JSON.stringify({stage:'standalone-recovery-baseline-check',status:'BUILT',candidateFiles:Object.keys(manifest.files).length,deployed:false}))
