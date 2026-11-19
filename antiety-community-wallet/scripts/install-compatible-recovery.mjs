import {readFile,writeFile,mkdir,lstat,realpath,rename} from 'node:fs/promises'
import {resolve,join,dirname,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

if(process.argv.length!==4||process.argv[3]!=='--apply')throw Error('Pass verified candidate directory and --apply after cutover approval')
const candidate=await realpath(resolve(process.argv[2])),project=fileURLToPath(new URL('../',import.meta.url))
const check=spawnSync(process.execPath,[join(project,'scripts/verify-compatible-recovery.mjs'),candidate,'--public-baseline'],{encoding:'utf8',timeout:120000})
if(check.status!==0)throw Error('Candidate or live baseline changed; installation stopped')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const manifest=JSON.parse(await readFile(join(candidate,'STAGING.json'),'utf8'))
const source=await realpath(manifest.sourceWorker),configPath=join(source,'wrangler.jsonc'),before=await readFile(configPath)
if(hash(before)!==manifest.sourceConfigSha256)throw Error('Active Worker configuration changed')
const config=JSON.parse(before)
if(config.name!=='antiety')throw Error('Unexpected Worker')
const revision=hash(JSON.stringify({files:manifest.files,worker:manifest.workerSha256})).slice(0,16)
const publicDir='recovery-public-'+revision,codeDir='src/recovery-'+revision
// Immutable revision directories preserve every prior public/code artifact.
async function copy(from,name,relative,expected){
  if(!/^[A-Za-z0-9_./-]+$/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid artifact path')
  const target=resolve(source,relative,name)
  if(!target.startsWith(source+sep))throw Error('Install escaped Worker')
  const bytes=await readFile(join(from,name));if(hash(bytes)!==expected)throw Error('Candidate changed during installation')
  await mkdir(dirname(target),{recursive:true})
  if(!(await realpath(dirname(target))).startsWith(source+sep))throw Error('Installation directory escaped Worker')
  const previous=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error})
  if(previous){if(!previous.isFile()||previous.isSymbolicLink()||hash(await readFile(target))!==expected)throw Error('Conflicting installed artifact')}
  else await writeFile(target,bytes,{flag:'wx'})
}
for(const [name,expected]of Object.entries(manifest.files))await copy(join(candidate,'public'),name,publicDir,expected)
await copy(join(candidate,'src'),'worker.mjs',codeDir,manifest.workerSha256)
const next={...config,main:codeDir+'/worker.mjs',assets:{directory:'./'+publicDir,binding:'ASSETS',run_worker_first:true,not_found_handling:'none'}}
const bytes=Buffer.from(JSON.stringify(next,null,2)+'\n')
await writeFile(join(candidate,'previous-wrangler.jsonc'),before,{flag:'wx'})
await writeFile(join(candidate,'INSTALLATION.json'),JSON.stringify({stage:'compatible-recovery-installation',revision,sourceWorker:source,
  previousConfigSha256:hash(before),nextConfigSha256:hash(bytes),previousConfig:'previous-wrangler.jsonc',oldFilesRetained:true,
  configSwitchCompleted:false,deployed:false},null,2)+'\n',{flag:'wx'})
if(hash(await readFile(configPath))!==hash(before))throw Error('Active configuration changed before switch')
const temporary=join(source,'.recovery-'+revision+'.tmp')
await writeFile(temporary,bytes,{flag:'wx'});await rename(temporary,configPath)
const installed=JSON.parse(await readFile(join(candidate,'INSTALLATION.json'),'utf8'))
await writeFile(join(candidate,'INSTALLATION.json'),JSON.stringify({...installed,configSwitchCompleted:true},null,2)+'\n')
console.log(JSON.stringify({installed:true,revision,oldFilesRetained:true,deployed:false}))
