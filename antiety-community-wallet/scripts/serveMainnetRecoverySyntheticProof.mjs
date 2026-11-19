import {pathToFileURL} from 'node:url'
import {join,resolve} from 'node:path'

if(!process.argv[2])throw Error('VERIFIED_RECOVERY_DIRECTORY_REQUIRED')
const directory=resolve(process.argv[2]),{createRecoveryStaticServer}=await import(pathToFileURL(join(directory,'launcher/server.mjs')).href)
const server=await createRecoveryStaticServer(directory,{port:18751})
console.log(JSON.stringify({stage:'mainnet-recovery-synthetic-server',status:'READY',url:'http://127.0.0.1:'+server.address().port,
  syntheticStorageOrigin:true,transactionSubmitted:false}))
