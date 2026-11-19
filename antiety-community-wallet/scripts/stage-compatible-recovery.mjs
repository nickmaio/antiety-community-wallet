import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises'
import {resolve,join,dirname,sep} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {recoveryBrandContentType} from '../hosting/policy.js'

const project=fileURLToPath(new URL('../',import.meta.url))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const safe=name=>typeof name==='string'&&/^[A-Za-z0-9_./-]+$/.test(name)&&!name.startsWith('/')&&!name.split('/').some(part=>!part||part==='.'||part==='..')
async function bytesUnder(root,name){
  if(!safe(name))throw Error('Invalid artifact path')
  const target=join(root,name),actual=await realpath(target)
  if(!actual.startsWith(root+sep)||(await lstat(target)).isSymbolicLink()||!(await lstat(target)).isFile())throw Error('Artifact escaped its root or is not a regular file')
  return readFile(target)
}
export async function stageCompatibleRecovery({source,proof,qualification,out}){
  if(!proof)throw Error('The audited production-origin proof is required to preserve live routes')
  source=await realpath(resolve(source));proof=await realpath(resolve(proof));out=resolve(out)
  if(await lstat(out).catch(error=>{if(error.code==='ENOENT')return null;throw error}))throw Error('Output already exists; retain it and choose a new directory')
  const record=JSON.parse(await readFile(qualification,'utf8'))
  if(record.distribution?.packageVerification?.status!=='PASSED'||record.distribution?.packageVerification?.allPackageFilesVerified!==true)throw Error('Qualified distribution required')
  const evidence=await realpath(record.evidenceRoot),recovery=await realpath(join(evidence,record.distribution.directory))
  if(!recovery.startsWith(evidence+sep))throw Error('Recovery escaped evidence directory')
  const publicFiles={},baseline={}
  const add=(name,bytes)=>{if(!safe(name)||publicFiles[name])throw Error('Invalid or colliding public file');publicFiles[name]=bytes}
  const sums=await bytesUnder(recovery,'SHA256SUMS.json')
  if(hash(sums)!==record.evidenceSha256[record.distribution.directory+'/SHA256SUMS.json'])throw Error('Qualified manifest changed')
  const packageManifest=JSON.parse(sums)
  for(const [name,expected]of Object.entries(packageManifest.files)){
    const bytes=await bytesUnder(recovery,name)
    if(hash(bytes)!==expected)throw Error('Qualified package changed')
    if(['index.html','README.md','RECOVERY-BUILD.json'].includes(name)||/^assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(name)||recoveryBrandContentType('/'+name))add(name,bytes)
  }
  const metadata=JSON.parse(publicFiles['RECOVERY-BUILD.json'])
  if(metadata.sourceCryptoSha256!==hash(await readFile(join(project,'../shared/wallet/generated/walletGenerationCrypto.js')))||metadata.slotCount!==65536||metadata.antietyBackendRequired!==false)throw Error('Recovery qualification is stale')
  if(metadata.network!=='Ethereum mainnet'||packageManifest.network!==metadata.network||
    JSON.stringify(metadata.chainIds)!=='[1]'||JSON.stringify(packageManifest.chainIds)!=='[1]')throw Error('Unexpected recovery network')
  const configBytes=await bytesUnder(source,'wrangler.jsonc'),config=JSON.parse(configBytes)
  if(config.name!=='antiety'||config.assets?.binding!=='ASSETS'||Object.keys(config).some(key=>!['name','main','assets','compatibility_date'].includes(key)))throw Error('Unexpected source Worker configuration')
  const oldPublic=await realpath(resolve(source,config.assets.directory))
  if(!oldPublic.startsWith(source+sep))throw Error('Existing assets escaped Worker')
  add('SHA256SUMS.json',sums)
  const zip=await bytesUnder(evidence,record.distribution.archive)
  if(hash(zip)!==record.distribution.archiveSha256)throw Error('Qualified ZIP changed')
  const archiveName='wallet-recovery-ethereum.zip'
  add(archiveName,zip);add(archiveName+'.sha256',Buffer.from(hash(zip)+'  '+archiveName+'\n'))
  const proofManifest=JSON.parse(await bytesUnder(proof,'PRODUCTION-ORIGIN-PROOF.json'))
  if(proofManifest.kind!=='synthetic-production-origin-vault-check'||proofManifest.sourceOrigin!=='https://wallet.antiety.com'||proofManifest.targetOrigin!=='https://antiety.com'||
    proofManifest.rpId!=='wallet.antiety.com'||proofManifest.realWalletOrExportRead!==false||proofManifest.backendCalls!==false)
    throw Error('Unexpected production-origin proof')
  const proofNames=Object.keys(proofManifest.files||{})
  if(proofNames.length!==3||!proofNames.some(name=>/^assets\/production-origin-check-[A-Za-z0-9_-]+\.js$/.test(name))||
    !proofNames.some(name=>/^assets\/production-origin-check-[A-Za-z0-9_-]+\.css$/.test(name)))throw Error('Incomplete production-origin proof')
  for(const [name,expected]of Object.entries(proofManifest.files)){
    if(name!=='production-wallet-origin-check.html'&&!/^assets\/production-origin-check-[A-Za-z0-9_-]+\.(?:js|css)$/.test(name))throw Error('Unexpected proof file')
    const bytes=await bytesUnder(proof,name);if(hash(bytes)!==expected)throw Error('Production-origin proof changed after audit');add(name,bytes)
    baseline[name==='production-wallet-origin-check.html'?'/production-wallet-origin-check':'/'+name]=expected
  }
  if(!publicFiles['production-wallet-origin-check.html'])throw Error('Missing production-origin proof')
  if(!publicFiles['index.html'])throw Error('Missing entry')
  baseline['/']=hash(await bytesUnder(oldPublic,'index.html'))
  for(const name of ['assetlinks.json','assetlinks.antiety-development.json','apple-app-site-association']){
    const file='.well-known/'+name,bytes=await bytesUnder(oldPublic,file);JSON.parse(bytes.toString());add(file,bytes);baseline['/'+file]=hash(bytes)
  }
  const {relatedOriginsDocument}=await import('../hosting/compatible-worker.js')
  baseline['/.well-known/webauthn']=hash(relatedOriginsDocument)
  await mkdir(join(out,'src'),{recursive:true});await mkdir(join(out,'public'),{recursive:true})
  for(const [name,bytes]of Object.entries(publicFiles)){
    await mkdir(dirname(join(out,'public',name)),{recursive:true});await writeFile(join(out,'public',name),bytes,{flag:'wx'})
  }
  const bundled=await build({stdin:{contents:"import {createCompatibleRecoveryWorker} from './hosting/compatible-worker.js';export default createCompatibleRecoveryWorker("+JSON.stringify(Object.keys(publicFiles))+");",resolveDir:project,sourcefile:'compatible-recovery-entry.js'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'})
  const worker=bundled.outputFiles[0].contents
  await writeFile(join(out,'src/worker.mjs'),worker,{flag:'wx'})
  const next={name:'antiety',compatibility_date:config.compatibility_date,main:'src/worker.mjs',assets:{directory:'./public',binding:'ASSETS',run_worker_first:true,not_found_handling:'none'}}
  await writeFile(join(out,'wrangler.jsonc'),JSON.stringify(next,null,2)+'\n',{flag:'wx'})
  const manifest={stage:'origin-compatible-recovery-hosting',sourceWorker:source,sourceConfigSha256:hash(configBytes),
    baseline,files:Object.fromEntries(Object.entries(publicFiles).map(([name,bytes])=>[name,hash(bytes)])),workerSha256:hash(worker),configSha256:hash(await readFile(join(out,'wrangler.jsonc'))),
    recoveryArchiveName:archiveName,recoveryArchiveSha256:hash(zip),sourceCryptoSha256:metadata.sourceCryptoSha256,
    rpId:'wallet.antiety.com',relatedOrigins:['https://preview.antiety.com','https://antiety.com'],associationFilesPreserved:3,
    rootRequiresBackend:false,coreAppIncluded:false,sourceWorkerModified:false,deployed:false}
  await writeFile(join(out,'STAGING.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'})
  return {staged:true,files:Object.keys(publicFiles).length,associationFilesPreserved:3,deployed:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={}
  if(args.length!==8)throw Error('Pass --source, --proof, --qualification and --out-dir')
  for(let i=0;i<args.length;i+=2){const key={'--source':'source','--proof':'proof','--qualification':'qualification','--out-dir':'out'}[args[i]];if(!key||options[key]||!args[i+1]||args[i+1].startsWith('--'))throw Error('Invalid staging arguments');options[key]=args[i+1]}
  console.log(JSON.stringify(await stageCompatibleRecovery(options)))
}
