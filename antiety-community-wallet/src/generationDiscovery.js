import {AbiCoder,Interface,concat,keccak256,toUtf8Bytes} from 'ethers'
import {MAINNET_GENERATION_PINS} from '../../shared/wallet/mainnetGenerationPins.js'
import {mainnetInventorySimulation} from '../../shared/wallet/generation/generated/mainnetInventorySimulation.js'
import {validateRecoveryRpcUrls} from './rpc.js'
import {generationProfile as profile} from './generationExecution.js'
import {normalizeRecoveryCooldown} from './connectionSettings.js'

const fail=code=>{throw new Error('GENERATION_RECOVERY_'+code)}
const hash=/^0x[0-9a-f]{64}$/i,word=/^0x[0-9a-f]{64}$/i
const quantity=value=>{if(typeof value!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value))fail('RPC_INVALID');return BigInt(value)}
const bytecode=value=>{if(typeof value!=='string'||value.length>65538||!/^0x(?:[0-9a-f]{2})*$/i.test(value))fail('RPC_INVALID');return value.toLowerCase()}
const tag=snapshot=>'0x'+snapshot.blockNumber.toString(16)
const sentinel='0x0000000000000000000000000000000000000001'
const proxyHash='0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c'
const safe=new Interface(['function getOwners() view returns(address[])','function getThreshold() view returns(uint256)',
  'function getModulesPaginated(address,uint256) view returns(address[],address)'])
const pinEntries=pins=>[[pins.contracts.safeSingletonAddress,pins.contractCodeHashes.safeSingletonAddress],
  [pins.contracts.safeProxyFactoryAddress,pins.contractCodeHashes.safeProxyFactoryAddress],
  [pins.entryPoint.address,pins.entryPoint.codeHash],[pins.module.address,pins.module.codeHash],[pins.moduleSetup.address,pins.moduleSetup.codeHash],
  [pins.usdt.address,pins.usdt.codeHash]]

/** Read-only, bounded two-source batches. This module has no signing or send RPC method. */
export function createGenerationRecoveryReader(urls,{fetchImpl=globalThis.fetch,timeoutMs=8000,inventoryMode=true,minimumIntervalMs=1000,
  network='ethereum-mainnet',maximumBatchCalls=1,retryDelayMs=1000,rateLimitedIntervalMs=1000,requestCooldownMs=null,now=Date.now}={}){
  if(network!=='ethereum-mainnet'||!inventoryMode)fail('RPC_INVALID')
  const pins=MAINNET_GENERATION_PINS,pinsToRead=pinEntries(pins),bytecodeForPage=mainnetInventorySimulation.bytecode
  urls=[...validateRecoveryRpcUrls(urls)]
  if(requestCooldownMs!==null)normalizeRecoveryCooldown(requestCooldownMs)
  if(!Number.isInteger(maximumBatchCalls)||maximumBatchCalls<1||maximumBatchCalls>48)fail('RPC_INVALID')
  const initialSpacing=requestCooldownMs??minimumIntervalMs
  const lanes=[Promise.resolve(),Promise.resolve()],next=[0,0],pageNext=[0,0],spacing=[initialSpacing,initialSpacing]
  const abi=AbiCoder.defaultAbiCoder(),types=['uint256[]','uint256[]','bytes32[]','uint256[]']
  if(keccak256(bytecodeForPage)!==mainnetInventorySimulation.bytecodeHash)fail('RPC_INVALID')
  let nextId=0
  const pause=(duration,signal)=>new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new Error('GENERATION_RECOVERY_CANCELLED'));return}
    const done=()=>{signal?.removeEventListener('abort',cancel);resolve()}
    const timer=setTimeout(done,duration)
    const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(new Error('GENERATION_RECOVERY_CANCELLED'))}
    signal?.addEventListener('abort',cancel,{once:true})
  })
  async function batch(source,calls,{signal}={}){
    if(![0,1].includes(source)||!Array.isArray(calls)||calls.length<1||calls.length>48||
      calls.some(call=>!['eth_chainId','eth_getBlockByNumber','eth_getBalance','eth_getCode','eth_call','eth_getStorageAt'].includes(call.method)))fail('RPC_METHOD_DENIED')
    const task=lanes[source].then(async()=>{
      const result=[]
      for(let from=0;from<calls.length;from+=maximumBatchCalls){
        for(let attempt=0;;attempt++){
          try{result.push(...await request(source,calls.slice(from,from+maximumBatchCalls),signal));break}
          catch(error){
            if(error.message==='GENERATION_RECOVERY_RPC_RATE_LIMITED'){
              spacing[source]=Math.max(spacing[source],rateLimitedIntervalMs)
              next[source]=Math.max(next[source],now()+spacing[source])
            }
            if(!error.retryable||attempt>=2||signal?.aborted)throw error
            await pause(retryDelayMs*2**attempt,signal)
          }
        }
      }
      return result
    })
    lanes[source]=task.catch(()=>{});return task
  }
  async function request(source,calls,signal){
      if(signal?.aborted)fail('CANCELLED')
      const pageCall=inventoryMode&&calls.length===1&&calls[0].method==='eth_call'&&!calls[0].params[0]?.to
      const schedule=pageCall&&requestCooldownMs===null?pageNext:next
      const wait=Math.max(0,schedule[source]-now());if(wait)await pause(wait,signal)
      if(signal?.aborted)fail('CANCELLED')
      schedule[source]=now()+(inventoryMode&&!pageCall&&requestCooldownMs===null?Math.min(50,spacing[source]):spacing[source])
      const controller=new AbortController(),abort=()=>controller.abort(),ids=calls.map(()=>++nextId)
      signal?.addEventListener('abort',abort,{once:true})
      let timer,reader,httpStatus=null,rpcCode=null
      try{
        return await Promise.race([(async()=>{
          const response=await fetchImpl(urls[source],{method:'POST',headers:{'content-type':'application/json'},redirect:'error',
            body:JSON.stringify(inventoryMode&&calls.length===1?{jsonrpc:'2.0',id:ids[0],...calls[0]}:
              calls.map((call,i)=>({jsonrpc:'2.0',id:ids[i],...call}))),signal:controller.signal})
          httpStatus=response.status
          if(!response.ok){
            const error=new Error(response.status===429?'GENERATION_RECOVERY_RPC_RATE_LIMITED':
              [401,403].includes(response.status)?'GENERATION_RECOVERY_RPC_ACCESS_DENIED':'GENERATION_RECOVERY_RPC_UNAVAILABLE')
            error.retryable=[429,502,503,504].includes(response.status);throw error
          }
          reader=response.body.getReader();let size=0;const parts=[]
          for(let part=await reader.read();!part.done;part=await reader.read()){
            const value=part.value;size+=value.byteLength;if(size>1048576)fail('RPC_INVALID');parts.push(value)
          }
          const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}
          const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
          const values=inventoryMode&&calls.length===1&&!Array.isArray(parsed)?[parsed]:parsed
          // A batch-wide rejection may be an error object. Never accept a singleton success
          // object in place of the required array, or trust mismatched response IDs.
          const rejection=Array.isArray(parsed)?parsed.find(value=>ids.includes(value?.id)&&value?.error):
            parsed?.jsonrpc==='2.0'&&(parsed.id===null||parsed.id===undefined||ids.includes(parsed.id))&&parsed.error?parsed:null
          if(rejection){
            rpcCode=Number.isInteger(rejection.error?.code)?rejection.error.code:null
            const limited=[429,-32005,-32016].includes(rpcCode)
            const error=new Error(limited?'GENERATION_RECOVERY_RPC_RATE_LIMITED':'GENERATION_RECOVERY_RPC_REJECTED')
            error.retryable=limited;throw error
          }
          if(!Array.isArray(values)||values.length!==calls.length)fail('RPC_INVALID')
          const byId=new Map()
          for(const value of values){
            if(value?.jsonrpc!=='2.0'||!ids.includes(value.id)||byId.has(value.id)||value.error||!Object.hasOwn(value,'result'))fail('RPC_INVALID')
            byId.set(value.id,value.result)
          }
          return ids.map(id=>byId.get(id))
        })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('GENERATION_RECOVERY_RPC_TIMEOUT'))},timeoutMs)})])
      }catch(error){
        if(signal?.aborted)fail('CANCELLED')
        const safe=/^GENERATION_RECOVERY_/.test(error?.message||'')?error:new Error('GENERATION_RECOVERY_RPC_UNAVAILABLE')
        safe.source=source===0?'primary':'secondary'
        safe.httpStatus=httpStatus;safe.rpcCode=rpcCode;throw safe
      }
      finally{clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',abort);void reader?.cancel().catch(()=>{})}
  }
  const both=(calls,options)=>Promise.all([0,1].map(i=>batch(i,calls,options)))
  const call=(method,params)=>({method,params})
  const header=row=>{
    if(!row||!hash.test(row.hash||''))fail('RPC_INVALID')
    const number=Number(quantity(row.number)),timestamp=Number(quantity(row.timestamp))
    if(!Number.isSafeInteger(number)||!Number.isSafeInteger(timestamp))fail('RPC_INVALID')
    return {number,hash:row.hash.toLowerCase(),timestamp}
  }
  async function getSnapshot(options){
    const heads=await both([call('eth_chainId',[]),call('eth_getBlockByNumber',[inventoryMode?'finalized':'latest',false])],options)
    if(heads.some(row=>quantity(row[0])!==BigInt(pins.chainId)))fail('WRONG_NETWORK')
    const [a,b]=heads.map(row=>header(row[1]))
    if([a,b].some(h=>h.timestamp<Math.floor(now()/1000)-(inventoryMode?3600:120)||h.timestamp>Math.floor(now()/1000)+30)||Math.abs(a.number-b.number)>64)fail('RPC_STALE')
    const number=Math.min(a.number,b.number),rows=await both([call('eth_getBlockByNumber',['0x'+number.toString(16),false])],options)
    const [left,right]=rows.map(row=>header(row[0]))
    if(left.number!==number||JSON.stringify(left)!==JSON.stringify(right))fail('RPC_DISAGREEMENT')
    return {chainId:pins.chainId,blockNumber:number,blockHash:left.hash}
  }
  async function verifySnapshot(snapshot,options){
    const rows=await both([call('eth_chainId',[]),call('eth_getBlockByNumber',[tag(snapshot),false]),
      ...pinsToRead.map(([address])=>call('eth_getCode',[address,tag(snapshot)]))],options)
    return snapshot.chainId===pins.chainId&&rows.every(row=>quantity(row[0])===BigInt(pins.chainId)&&header(row[1]).number===snapshot.blockNumber&&
      header(row[1]).hash===snapshot.blockHash&&pinsToRead.every(([,expected],i)=>keccak256(bytecode(row[i+2]))===expected))
  }
  async function verifyBlock(snapshot,options){
    const rows=await both([call('eth_getBlockByNumber',[tag(snapshot),false])],options)
    return rows.every(row=>header(row[0]).number===snapshot.blockNumber&&header(row[0]).hash===snapshot.blockHash)
  }
  async function readPage(accounts,snapshot,options){
    if(inventoryMode){
      if(!Array.isArray(accounts)||accounts.length<1||accounts.length>48||
        new Set(accounts.map(account=>account.safeAddress.toLowerCase())).size!==accounts.length)fail('RPC_INVALID')
      const addresses=accounts.map(row=>row.safeAddress)
      const data=concat([bytecodeForPage,abi.encode(['address[]'],[addresses])])
      const result=await both([call('eth_call',[{from:'0x'+'0'.repeat(40),value:'0x0',gas:'0x7a1200',data},tag(snapshot)])],options)
      return result.map(([output])=>{
        if(typeof output!=='string'||output.length>20000||!/^0x(?:[0-9a-f]{2})+$/i.test(output))fail('RPC_INVALID')
        let values;try{values=abi.decode(types,output)}catch{fail('RPC_INVALID')}
        if(values.some(row=>row.length!==accounts.length)||abi.encode(types,values).toLowerCase()!==output.toLowerCase())fail('RPC_INVALID')
        return accounts.map((_,index)=>({nativeAtomic:values[0][index].toString(),entryPointDepositAtomic:values[1][index].toString(),
          codeHash:values[2][index].toLowerCase(),tokenAtomic:values[3][index].toString()}))
      })
    }
  }
  async function verifyDeployed(account,snapshot,options){
    const calls=[call('eth_getCode',[account.safeAddress,tag(snapshot)]),
      ...[['getOwners',[]],['getThreshold',[]],['getModulesPaginated',[sentinel,10]]].map(([name,args])=>
        call('eth_call',[{to:account.safeAddress,data:safe.encodeFunctionData(name,args)},tag(snapshot)])),
      ...['0x0',keccak256(toUtf8Bytes('fallback_manager.handler.address')),keccak256(toUtf8Bytes('guard_manager.guard.address')),
        keccak256(toUtf8Bytes('module_manager.module_guard.address'))].map(slot=>call('eth_getStorageAt',[account.safeAddress,slot,tag(snapshot)]))]
    const rows=await both(calls,options)
    if(JSON.stringify(rows[0])!==JSON.stringify(rows[1]))fail('RPC_DISAGREEMENT')
    const [code,owners,threshold,modules,singleton,fallback,guard,moduleGuard]=rows[0]
    if([singleton,fallback,guard,moduleGuard].some(value=>!word.test(value||'')))fail('RPC_INVALID')
    const ownerList=safe.decodeFunctionResult('getOwners',owners)[0],moduleList=safe.decodeFunctionResult('getModulesPaginated',modules)
    return keccak256(bytecode(code))===proxyHash&&ownerList.length===1&&ownerList[0]===account.owner&&
      safe.decodeFunctionResult('getThreshold',threshold)[0]===1n&&moduleList[0].length===1&&
      moduleList[0][0]===pins.module.address&&moduleList[1]===sentinel&&
      BigInt(singleton)===BigInt(pins.contracts.safeSingletonAddress)&&BigInt(fallback)===BigInt(pins.module.address)&&
      BigInt(guard)===0n&&BigInt(moduleGuard)===0n
  }
  return {getSnapshot,verifySnapshot,verifyBlock,readPage,verifyDeployed,
    ...(inventoryMode?{pageSize:48,sourceHash:keccak256(toUtf8Bytes(JSON.stringify(urls)))}:{})}
}

/** A gap is an advisory pause, never proof that all receiving accounts were found.
 * Current asset scope: ETH and USDT and EntryPoint deposits. Deployed accounts reset
 * the gap even at zero balance. Failed/unknown reads never advance the checkpoint.
 */
export async function discoverGenerationAccounts({root,descriptor,reader,onProgress=()=>{},assertStillActive=()=>{},signal,
  timeoutMs=300000,now=Date.now,search={},journal=null,pauseRequested=()=>false,profile:activeProfile=profile,onPrepared=()=>{},onSavedProgress=()=>{}}){
  descriptor=activeProfile.normalizeDescriptor(descriptor)
  const token=descriptor.chainId===1,amountFields=['nativeAtomic','entryPointDepositAtomic',...(token?['tokenAtomic']:[])]
  const totalSlots=65536,pageSize=reader.pageSize??16
  if(totalSlots!==65536||![16,48].includes(pageSize))fail('SCAN_INVALID')
  const estimate=search.estimate===undefined||search.estimate===''?0:Number(search.estimate)
  if(!Number.isSafeInteger(estimate)||estimate<0||estimate>totalSlots-1)fail('ESTIMATE_INVALID')
  const started=now(),controller=new AbortController(),abort=()=>controller.abort()
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
  const timer=setTimeout(abort,timeoutMs)
  const check=()=>{assertStillActive();if(controller.signal.aborted)fail('SCAN_INTERRUPTED');if(now()<started||now()-started>=timeoutMs)fail('SCAN_TIMEOUT')}
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0))
  const summarize=(state,resumedAt,reason)=>Object.freeze({...state,snapshot:Object.freeze({...state.snapshot}),
    accounts:Object.freeze(state.accounts.map(account=>Object.freeze({...account}))),
    holdingsAtomic:(BigInt(state.nativeAtomic)+BigInt(state.entryPointDepositAtomic)).toString(),
    coverage:state.scannedSlots===totalSlots?'COMPLETE_AT_SNAPSHOT':'PARTIAL',pauseReason:reason,
    resumedAt,derivedSlots:state.scannedSlots-resumedAt})
  let material,session
  try{
    check();session=journal?await journal.open(root,activeProfile.descriptorHash(descriptor),{totalSlots,generationId:descriptor.generationId,
      sourceHash:reader.sourceHash,...(token?{chainId:1}:{})}):null;check()
    const prior=session?await session.read({restart:search.restart===true}):null;check()
    let state=search.restart?null:prior
    if(state){
      if(state.version!==1||state.generationId!==descriptor.generationId||state.totalSlots!==totalSlots||
        !Number.isInteger(state.scannedSlots)||state.scannedSlots<0||state.scannedSlots>totalSlots||
        !Number.isInteger(state.emptyRun)||state.emptyRun<0||state.emptyRun>state.scannedSlots||!Array.isArray(state.accounts)||
        !amountFields.every(field=>typeof state[field]==='string'&&/^(0|[1-9][0-9]{0,81})$/.test(state[field])))fail('SCAN_INVALID')
      let native=0n,reserve=0n,tokens=0n,previous=-1
      for(const account of state.accounts){
        if(!Number.isInteger(account.slot)||account.slot<=previous||account.slot>=state.scannedSlots||typeof account.deployed!=='boolean'||
          !amountFields.every(field=>typeof account[field]==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(account[field])))fail('SCAN_INVALID')
        previous=account.slot;native+=BigInt(account.nativeAtomic);reserve+=BigInt(account.entryPointDepositAtomic)
        if(token)tokens+=BigInt(account.tokenAtomic)
      }
      if(native!==BigInt(state.nativeAtomic)||reserve!==BigInt(state.entryPointDepositAtomic)||token&&tokens!==BigInt(state.tokenAtomic))fail('SCAN_INVALID')
      onSavedProgress(Object.freeze({...summarize(state,state.scannedSlots,'CONNECTION'),coverage:'PARTIAL',lastKnown:true}));check()
    }
    const snapshot=state?.snapshot||await reader.getSnapshot({signal:controller.signal});check()
    if(snapshot.chainId!==descriptor.chainId||!Number.isSafeInteger(snapshot.blockNumber)||snapshot.blockNumber<0||!hash.test(snapshot.blockHash||''))fail('RPC_INVALID')
    if(await reader.verifySnapshot(snapshot,{signal:controller.signal})!==true)fail('STACK_OR_SNAPSHOT_CHANGED')
    state=state||{version:1,generationId:descriptor.generationId,totalSlots,scannedSlots:0,emptyRun:0,snapshot,
      accounts:[],nativeAtomic:'0',entryPointDepositAtomic:'0',...(token?{tokenAtomic:'0'}:{})}
    if(session&&(!prior||search.restart)){await session.save(state);check()}
    const resumedAt=state.scannedSlots
    // An estimate counts senders, whereas slot zero is the default receiving account.
    // Continue always checks at least 100 further slots before another gap suggestion.
    const minimumChecked=Math.min(totalSlots,Math.max(estimate+101,resumedAt+100))
    const summary=reason=>summarize(state,resumedAt,reason)
    onProgress({...summary(null),totalSlots});check()
    if(state.scannedSlots<totalSlots){
      material=await activeProfile.prepare(root,descriptor,{checkpoint:pause,assertStillActive:check});check()
    }
    onPrepared();check()
    let lastYield=now(),reason=null
    for(let from=state.scannedSlots;from<totalSlots;from+=pageSize){
      if(pauseRequested()){reason='USER';break}
      if(now()-started>=Math.max(timeoutMs*0.9,timeoutMs-60000)){reason='TIME_BUDGET';break}
      check();const page=[]
      for(let slot=from;slot<Math.min(from+pageSize,totalSlots);slot++){
        check();page.push(activeProfile.account(material,slot));if(now()-lastYield>=16){await pause();lastYield=now()}
      }
      const rows=await reader.readPage(page,snapshot,{signal:controller.signal});check()
      if(!Array.isArray(rows)||rows.length!==2||rows.some(row=>!Array.isArray(row)||row.length!==page.length)||JSON.stringify(rows[0])!==JSON.stringify(rows[1]))fail('RPC_DISAGREEMENT')
      // Work on a new page state: a failed configuration check cannot leak a partial page.
      const next={...state,accounts:[...state.accounts]};let native=BigInt(state.nativeAtomic),reserve=BigInt(state.entryPointDepositAtomic),tokens=token?BigInt(state.tokenAtomic):0n
      for(let i=0;i<page.length;i++){
        const row=rows[0][i],account=page[i]
        for(const field of amountFields)if(typeof row[field]!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(row[field])||BigInt(row[field])>=1n<<256n)fail('RPC_INVALID')
        if(row.codeHash!==undefined&&!hash.test(row.codeHash))fail('RPC_INVALID')
        const deployed=row.codeHash!==undefined?![keccak256('0x'),'0x'+'0'.repeat(64)].includes(row.codeHash):bytecode(row.code)!=='0x'
        if(deployed&&await reader.verifyDeployed(account,snapshot,{signal:controller.signal})!==true)fail('ACCOUNT_CONFIGURATION_CHANGED')
        check();native+=BigInt(row.nativeAtomic);reserve+=BigInt(row.entryPointDepositAtomic)
        if(token)tokens+=BigInt(row.tokenAtomic)
        const evidence=deployed||BigInt(row.nativeAtomic)+BigInt(row.entryPointDepositAtomic)>0n||token&&BigInt(row.tokenAtomic)>0n
        next.emptyRun=evidence?0:next.emptyRun+1
        if(evidence||account.slot===0)next.accounts.push({...account,nativeAtomic:row.nativeAtomic,entryPointDepositAtomic:row.entryPointDepositAtomic,deployed,
          ...(token?{tokenAtomic:row.tokenAtomic}:{})})
      }
      next.scannedSlots=from+page.length;next.nativeAtomic=native.toString();next.entryPointDepositAtomic=reserve.toString()
      if(token)next.tokenAtomic=tokens.toString()
      // Authenticate the original block again before publishing or saving this page.
      if(await (reader.verifyBlock||reader.verifySnapshot)(snapshot,{signal:controller.signal})!==true)fail('SCAN_REORGED')
      check();if(session)await session.save(next);check();state=next
      onProgress({...summary(null),totalSlots});check()
      if(pauseRequested()){reason='USER';break}
      if(search.guided&&state.scannedSlots>=minimumChecked&&state.emptyRun>=100){reason='EMPTY_GAP';break}
      await pause()
    }
    if(await reader.verifySnapshot(snapshot,{signal:controller.signal})!==true)fail('SCAN_REORGED')
    check();return summary(state.scannedSlots===totalSlots?null:reason)
  }finally{clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',abort);if(material)activeProfile.dispose(material);session?.close()}
}
