import {validateRecoveryRpcUrls} from './rpc.js'

export const DEFAULT_RECOVERY_COOLDOWN_MS=1000
export function normalizeRecoveryCooldown(value){
  if(!Number.isInteger(value)||value<250||value>60000)throw new Error('RECOVERY_COOLDOWN_INVALID')
  return value
}
export function normalizeRecoveryConnections(value){
  if(!value||value.version!==1||!Array.isArray(value.sources)||value.sources.length!==2||
    value.sources.some(url=>typeof url!=='string'||url.length>8192))throw new Error('RECOVERY_CONNECTION_SETTINGS_INVALID')
  let sources
  try{sources=validateRecoveryRpcUrls(value.sources.map(url=>url.trim()))}catch{throw new Error('RECOVERY_CONNECTION_SETTINGS_INVALID')}
  return Object.freeze({version:1,sources:Object.freeze([...sources]),cooldownMs:normalizeRecoveryCooldown(value.cooldownMs)})
}

/** Explicitly requested local connection preferences only. Never accepts a wallet
 * record, file, passphrase or key, and never sends settings to a server.
 */
export function createRecoveryConnectionStore({storage,chainId=1}={}){
  if(chainId!==1)throw new Error('WRONG_NETWORK')
  const storageKey='antiety.independent-recovery.mainnet-connections.v1'
  const local=()=>storage===undefined?globalThis.localStorage:storage
  return {
    load(fallbackSources){
      const fallback=normalizeRecoveryConnections({version:1,sources:fallbackSources,cooldownMs:DEFAULT_RECOVERY_COOLDOWN_MS})
      try{
        const text=local()?.getItem(storageKey)
        if(!text)return {settings:fallback,saved:false,unavailable:!local()}
        if(text.length>18000)throw new Error('invalid')
        return {settings:normalizeRecoveryConnections(JSON.parse(text)),saved:true,unavailable:false}
      }catch{return {settings:fallback,saved:false,unavailable:true}}
    },
    save(value){
      const settings=normalizeRecoveryConnections(value)
      try{
        const target=local();if(!target)throw new Error('unavailable')
        target.setItem(storageKey,JSON.stringify(settings))
        if(target.getItem(storageKey)!==JSON.stringify(settings))throw new Error('not saved')
        return true
      }catch{return false}
    },
    forget(){try{const target=local();if(!target)return false;target.removeItem(storageKey);return target.getItem(storageKey)===null}catch{return false}},
  }
}
