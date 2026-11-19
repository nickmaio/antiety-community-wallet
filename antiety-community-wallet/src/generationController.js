import {Interface,hexlify,getAddress,keccak256} from 'ethers'
import {createGenerationRecoveryCodec} from '../../shared/wallet/generation/recovery.js'
import {createGenerationRecoveryExecution} from './generationExecution.js'
import {createGenerationRecoveryReader,discoverGenerationAccounts} from './generationDiscovery.js'
import {createGenerationPagedScanJournal} from './generationPagedScanJournal.js'
import {createRecoveryController} from './controller.js'
import {createRecoveryJournal} from './journal.js'
import {validateRecoveryRpcUrls} from './rpc.js'
import {normalizeRecoveryCooldown,DEFAULT_RECOVERY_COOLDOWN_MS} from './connectionSettings.js'
import {createRecoveryRpcTransport} from '../../shared/wallet/recoveryRpc.js'

const fail=code=>{throw new Error('GENERATION_RECOVERY_'+code)}
const entry=new Interface(['function balanceOf(address) view returns(uint256)'])
const defaultJournal=codec=>createRecoveryJournal({databaseName:'antiety-independent-generation-mainnet-recovery-v1',
  chainId:1,assertRecord:codec.assertRecoveryRecord})

/** Root stays in this closure. React/journals receive only public inventory and signed status.
 * Per-account signing, durable attempts, replacement lineage and receipts reuse the v3 engine.
 */
export function createGenerationRecoveryController({journal=null,codec=null,network='ethereum-mainnet',
  readerFactory=null,rpcFactory=null,now=Date.now,scanJournal=null}={}){
  const adapter=createGenerationRecoveryExecution({network})
  const {generationExecution:execution,generationAccountDescriptor,generationRecordCodec}=adapter
  let profile=adapter.profileFor()
  codec ||=createGenerationRecoveryCodec({profile})
  rpcFactory ||=createRecoveryRpcTransport({getAddress,keccak256,Interface,
    safeInterface:execution.safeInterface,network}).createRecoveryRpc
  journal ||= defaultJournal(generationRecordCodec)
  scanJournal ||= createGenerationPagedScanJournal({chainId:profile.chainId})
  readerFactory ||= (urls,options={})=>createGenerationRecoveryReader(urls,{network,inventoryMode:true,...options})
  let scanCooldownMs=DEFAULT_RECOVERY_COOLDOWN_MS
  let root=null,descriptor=null,inventory=null,selected=null,urls=null,epoch=0,started=0,timer=null,scanning=null
  const rootActive=()=>!!root&&now()>=started&&now()-started<300000
  function expireRoot(){clearTimeout(timer);timer=null;if(root)root.fill(0);root=null;selected?.lock()}
  function lock(){epoch++;clearTimeout(timer);timer=null;scanning?.abort();if(root)root.fill(0);root=null;selected?.lock()}
  function setRpc(value){urls=[...validateRecoveryRpcUrls(value)];selected?.setRpc(urls)}
  function setScanCooldown(value){scanCooldownMs=normalizeRecoveryCooldown(value)}
  const sources=()=>{if(!urls)fail('SOURCES_REQUIRED');return urls}
  async function unlock(serialized,passphrase){
    const priorInventory=inventory
    lock();selected=null;const token=epoch
    let restored
    try{
      restored=await codec.importBackup({serialized,passphrase})
      if(token!==epoch)fail('SESSION_LOCKED')
      descriptor=profile.normalizeDescriptor(restored.descriptor)
      profile=adapter.profileFor(descriptor)
      inventory=priorInventory?.generationId===descriptor.generationId?priorInventory:null
      root=restored.root;restored.root=null;started=now();timer=setTimeout(expireRoot,300000);timer.unref?.()
      return descriptor
    }finally{restored?.root?.fill(0)}
  }
  let pauseSearch=false
  async function discover(onProgress=()=>{},search={}){
    if(!rootActive())fail('SESSION_LOCKED')
    if(scanning)fail('BUSY')
    const token=epoch,abort=new AbortController();scanning=abort;pauseSearch=false;let readOnly=false,lastVerified=null,lastSaved=null
    const check=()=>{
      if(root&&!rootActive())expireRoot()
      if(token!==epoch||(!readOnly&&!rootActive()))fail('SESSION_LOCKED')
    }
    try{
      const result=await discoverGenerationAccounts({root,descriptor,reader:readerFactory(sources(),{requestCooldownMs:scanCooldownMs}),now,
        onProgress:value=>{check();lastVerified=value;onProgress(value)},onSavedProgress:value=>{check();lastSaved=value},
        signal:abort.signal,assertStillActive:check,search,journal:scanJournal,pauseRequested:()=>pauseSearch,profile,
        timeoutMs:1800000,onPrepared:()=>{readOnly=true}})
      check();inventory=result;return result
    }catch(error){
      if(token===epoch){
        const prior=inventory?.generationId===descriptor?.generationId?inventory:null
        const latest=lastVerified?.scannedSlots?lastVerified:lastSaved?.scannedSlots?lastSaved:prior||lastVerified||lastSaved
        if(latest){
          const code=error?.code||error?.message||''
          const verification=['GENERATION_RECOVERY_SCAN_REORGED','GENERATION_RECOVERY_STACK_OR_SNAPSHOT_CHANGED',
            'GENERATION_RECOVERY_RPC_DISAGREEMENT','GENERATION_RECOVERY_ACCOUNT_CONFIGURATION_CHANGED'].includes(code)
          inventory=Object.freeze({...latest,coverage:'PARTIAL',lastKnown:true,
            pauseReason:verification?'VERIFICATION':code.startsWith('GENERATION_RECOVERY_SCAN_STORAGE')||
              ['GENERATION_RECOVERY_SCAN_CONFLICT','GENERATION_RECOVERY_SCAN_INVALID'].includes(code)?'STORAGE':'CONNECTION',
            requiresFreshSearch:verification})
        }
      }
      throw error
    }finally{if(scanning===abort)scanning=null}
  }
  function accountRpc(value){
    const base=rpcFactory(value),reader=readerFactory(value)
    return {...base,state:async(account,options)=>{
      const state=await base.state(account,options)
      const snapshot={chainId:profile.chainId,blockNumber:state.blockNumber,blockHash:state.blockHash}
      if(state.deployed&&await reader.verifyDeployed({safeAddress:account.safeAddress,owner:account.recoveryOwner},snapshot)!==true)fail('ACCOUNT_CONFIGURATION_CHANGED')
      const result=await base.agree('eth_call',[{to:account.generation.stack.entryPoint,
        data:entry.encodeFunctionData('balanceOf',[account.safeAddress])},'0x'+state.blockNumber.toString(16)])
      if(await reader.verifyBlock(snapshot)!==true)fail('ACCOUNT_CONFIGURATION_CHANGED')
      return {...state,entryPointDeposit:entry.decodeFunctionResult('balanceOf',result)[0]}
    }}
  }
  function openController(account){
    execution.assertRecoveryDescriptor(account)
    const token=epoch
    return createRecoveryController({journal,execution,rpcFactory:accountRpc,now,
      importBackup:async text=>{
        if(token!==epoch||!rootActive()||JSON.stringify(JSON.parse(text))!==JSON.stringify(account)||
          descriptor?.generationId!==account.generation.generationId)fail('SESSION_LOCKED')
        const derived=profile.privateAccount(root,descriptor,account.slot)
        try{
          if(JSON.stringify(generationAccountDescriptor(descriptor,derived))!==JSON.stringify(account))fail('ACCOUNT_MISMATCH')
          return {descriptor:account,privateKey:derived.privateKey.slice()}
        }finally{derived.privateKey.fill(0)}
      },
      sign:({privateKey,...input})=>{
        if(token!==epoch||!rootActive())fail('SESSION_LOCKED')
        return execution.signRecoveryTransaction({...input,privateKey:hexlify(privateKey)})
      },
    })
  }
  async function selectAccount(slot){
    const account=inventory?.accounts.find(row=>row.slot===slot)
    if(!account||inventory.generationId!==descriptor?.generationId)fail('SCAN_REQUIRED')
    const token=epoch,value=generationAccountDescriptor(descriptor,account)
    selected?.lock();const next=openController(value);next.setRpc(sources())
    if(rootActive())await next.unlock(JSON.stringify(value),'')
    else{
      await journal.withRecord(value.safeAddress,async({record,save})=>{
        if(record&&execution.descriptorDigest(record.descriptor)!==execution.descriptorDigest(value))fail('ACCOUNT_MISMATCH')
        if(!record)await save({version:1,descriptor:value,plan:null,status:'READY'})
      })
      await next.openSaved(value.safeAddress)
    }
    if(token!==epoch){next.lock();fail('SESSION_LOCKED')}
    selected=next;return next.read()
  }
  async function resumeAccount(address){
    const token=epoch;let next
    try{
      if(!rootActive())fail('SESSION_LOCKED')
      if(scanning)fail('BUSY')
      const record=await journal.read(address)
      if(token!==epoch||!rootActive())fail('SESSION_LOCKED')
      if(!record)fail('SAVED_RECORD_REQUIRED')
      if(JSON.stringify(record.descriptor.generation)!==JSON.stringify(descriptor))fail('ACCOUNT_MISMATCH')
      selected?.lock();next=openController(record.descriptor);next.setRpc(sources())
      // The importer derives this exact slot from the newly decrypted root and checks
      // its full descriptor before admitting a key. The saved operation is not replaced.
      await next.unlock(JSON.stringify(record.descriptor),'')
      if(token!==epoch||!rootActive())fail('SESSION_LOCKED')
      selected=next;return await next.read()
    }catch(error){next?.lock();if(token===epoch){lock();selected=null}throw error}
  }
  async function unlockKnownAccount(slot,address){
    const token=epoch;let derived,next
    try{
      if(!rootActive())fail('SESSION_LOCKED')
      if(scanning)fail('BUSY')
      if(!Number.isInteger(slot)||slot<0||slot>=65536||
        typeof address!=='string'||!/^0x[0-9a-f]{40}$/i.test(address))fail('KNOWN_ACCOUNT_INVALID')
      derived=profile.privateAccount(root,descriptor,slot)
      if(derived.safeAddress.toLowerCase()!==address.toLowerCase())fail('ACCOUNT_MISMATCH')
      const value=generationAccountDescriptor(descriptor,derived)
      derived.privateKey.fill(0);derived=null
      selected?.lock();next=openController(value);next.setRpc(sources())
      // Preserve an existing operation; create READY only if this exact account
      // has no local journal entry. The importer checks root-to-slot ownership.
      await next.unlock(JSON.stringify(value),'')
      if(token!==epoch||!rootActive())fail('SESSION_LOCKED')
      selected=next;return await next.read()
    }catch(error){next?.lock();if(token===epoch){lock();selected=null}throw error}
    finally{derived?.privateKey.fill(0)}
  }
  async function openSaved(address){
    lock()
    const token=epoch,record=await journal.read(address)
    if(token!==epoch)fail('SESSION_LOCKED')
    if(!record)fail('SAVED_RECORD_REQUIRED')
    const next=openController(record.descriptor)
    const saved=await next.openSaved(address)
    if(token!==epoch)fail('SESSION_LOCKED')
    if(urls)next.setRpc(urls)
    descriptor=profile.normalizeDescriptor(saved.descriptor.generation)
    profile=adapter.profileFor(descriptor);inventory=null;selected=next
    return saved
  }
  const current=()=>{if(!selected)fail('ACCOUNT_REQUIRED');return selected}
  const unlocked=()=>{if(!rootActive())fail('SESSION_LOCKED');return current()}
  return {setRpc,setScanCooldown,unlock,discover,selectAccount,resumeAccount,unlockKnownAccount,openSaved,lock,list:journal.list,slotCount:65536,chainId:profile.chainId,
    pauseSearch:()=>{pauseSearch=true},
    descriptor:()=>descriptor,inventory:()=>inventory,
    isUnlocked:()=>rootActive()&&(!selected||selected.isUnlocked()),
    read:()=>current().read(),check:options=>current().check(options),prepare:async input=>unlocked().prepare(input),
    cancelReview:()=>current().cancelReview(),reconcile:()=>current().reconcile(),
    submit:async(hash,approved)=>{try{return await unlocked().submit(hash,approved)}finally{lock()}},
  }
}
