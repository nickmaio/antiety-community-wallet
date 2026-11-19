import {readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises'
import {resolve,join,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {recoveryBrandContentType} from '../hosting/policy.js'

const project=fileURLToPath(new URL('../',import.meta.url)),source=resolve(process.argv[2]||'')
if(!process.argv[2])throw Error('Pass the existing wallet Worker project directory')
const out=join(project,'dist-wallet-recovery-worker'),build=join(project,'dist-wallet-recovery')
if(await lstat(out).catch(error=>{if(error.code==='ENOENT')return null;throw error}))throw Error('Recovery Worker staging already exists; retain it before restaging')
const config=JSON.parse(await readFile(join(source,'wrangler.jsonc'),'utf8'))
if(config.name!=='antiety'||config.assets?.binding!=='ASSETS')throw Error('Unexpected wallet Worker project')
const existingAssets=resolve(source,config.assets.directory)
if(!existingAssets.startsWith(source+sep))throw Error('Association source escaped the named Worker directory')
const checksum=bytes=>createHash('sha256').update(bytes).digest('hex'),files={},associations={}
async function save(name,bytes){
  const target=resolve(out,'public',name)
  if(!target.startsWith(join(out,'public')+sep))throw Error('Invalid staged path')
  await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,bytes,{flag:'wx'});files[name]=checksum(bytes)
}
const manifest=JSON.parse(await readFile(join(build,'SHA256SUMS.json'),'utf8'))
// Distribute only the audited recovery entry/assets and public package metadata.
for(const [name,expected]of Object.entries(manifest.files)){
  if(!['index.html','README.md','RECOVERY-BUILD.json'].includes(name)&&!/^assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(name)&&!recoveryBrandContentType('/'+name))continue
  if(!(await lstat(join(build,name))).isFile())throw Error('Recovery asset must be a regular file')
  const bytes=await readFile(join(build,name));if(checksum(bytes)!==expected)throw Error('Recovery build changed after checksum generation')
  await save(name,bytes)
}
if(!files['index.html']||!files['RECOVERY-BUILD.json'])throw Error('Incomplete recovery build')
await save('SHA256SUMS.json',await readFile(join(build,'SHA256SUMS.json')))
const archive=await readFile(join(project,'wallet-recovery-ethereum.zip'))
await save('wallet-recovery-ethereum.zip',archive)
await save('wallet-recovery-ethereum.zip.sha256',Buffer.from(checksum(archive)+'  wallet-recovery-ethereum.zip\n'))
for(const name of ['assetlinks.json','assetlinks.antiety-development.json','apple-app-site-association']){
  const bytes=await readFile(join(existingAssets,'.well-known',name));JSON.parse(bytes.toString())
  await save('.well-known/'+name,bytes);associations[name]=checksum(bytes)
}
await mkdir(join(out,'src'),{recursive:true})
for(const name of ['worker.js','policy.js'])await copyFile(join(project,'hosting',name),join(out,'src',name))
await writeFile(join(out,'package.json'),JSON.stringify({name:'antiety-independent-recovery-worker',private:true,type:'module'},null,2)+'\n')
await writeFile(join(out,'wrangler.jsonc'),JSON.stringify({...config,main:'src/worker.js',assets:{directory:'./public',binding:'ASSETS',run_worker_first:true,not_found_handling:'none'}},null,2)+'\n')
await writeFile(join(out,'recovery-hosting-manifest.json'),JSON.stringify({stage:'independent-recovery-hosting',sourceWorker:source,files,associations,apiProxy:false,loginRequired:false,rpIdChanged:false,deployed:false},null,2)+'\n')
console.log(JSON.stringify({staged:true,files:Object.keys(files).length,associationFilesPreserved:3,deployed:false}))
