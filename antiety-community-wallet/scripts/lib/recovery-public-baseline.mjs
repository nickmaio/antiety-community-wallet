import {createHash} from 'node:crypto'

const safeCauses=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET'])
const maximumBytes=10*1024*1024
async function bodyHash(response){
  if(!response.body)throw Error('BODY_UNAVAILABLE')
  const reader=response.body.getReader(),hash=createHash('sha256');let total=0
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength
    if(total>maximumBytes){await reader.cancel();throw Error('BODY_TOO_LARGE')}hash.update(value)}}finally{reader.releaseLock()}
  return hash.digest('hex')
}
/** Exact public-file checks; retries transport failures only, never mismatches. */
export async function verifyRecoveryPublicBaseline(baseline,{fetchImpl=globalThis.fetch,timeoutMs=20000}={}){
  const checks=[]
  for(const [path,expected]of Object.entries(baseline)){
    if(!/^\/[A-Za-z0-9_./-]*$/.test(path)||path.includes('..')||!/^([0-9a-f]{64})$/.test(expected))
      return {status:'FAILED',checks,failure:{path:null,category:'invalid-baseline'}}
    let lastError
    for(let attempt=1;attempt<=2;attempt++){
      try{
        const response=await fetchImpl('https://wallet.antiety.com'+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(timeoutMs)})
        if(response.status!==200)return {status:'FAILED',checks,failure:{path,category:'http-status',httpStatus:response.status}}
        const actual=await bodyHash(response)
        if(actual!==expected)return {status:'FAILED',checks,failure:{path,category:'hash-mismatch'}}
        checks.push({path,status:200,sha256:expected});lastError=null;break
      }catch(error){
        const name=['AbortError','TimeoutError','TypeError'].includes(error?.name)?error.name:'OTHER'
        const cause=safeCauses.has(error?.cause?.code)?error.cause.code:null
        lastError={path,category:error?.message==='BODY_TOO_LARGE'?'body-too-large':'transport-error',errorName:name,causeCode:cause}
        if(lastError.category==='body-too-large')break
      }
    }
    if(lastError)return {status:'FAILED',checks,failure:lastError}
  }
  return {status:'PASSED',checks}
}
