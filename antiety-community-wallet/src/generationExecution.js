import * as ethers from 'ethers'
import {createRecoveryExecution,requireRecoveryTest} from '../../shared/wallet/recoveryExecution.js'
import {createRecoveryRecordCodec} from '../../shared/wallet/recoveryRecord.js'
import {createMainnetGenerationProfile} from '../../shared/wallet/generated/walletGenerationCrypto.js'

export const generationProfile=createMainnetGenerationProfile()
const factory=new ethers.Interface(['function createProxyWithNonce(address,bytes,uint256)'])
const keys='format,generation,slot,chainId,safeAddress,recoveryOwner,initializer,initialization'
export function createGenerationRecoveryExecution({network='ethereum-mainnet'}={}){
  requireRecoveryTest(network==='ethereum-mainnet','WRONG_NETWORK')
  const profile=generationProfile,chainId=profile.chainId
  const profileFor=()=>profile
  function generationAccountDescriptor(generation,account){
    const normalized=profile.normalizeDescriptor(generation)
    const descriptor={format:'antiety-generation-recovery-account-v1',generation:normalized,slot:account.slot,chainId:String(chainId),
      safeAddress:account.safeAddress,recoveryOwner:account.owner,initializer:account.initializer,initialization:{owners:[account.owner]}}
    assertGenerationAccountDescriptor(descriptor)
    return descriptor
  }
  function assertGenerationAccountDescriptor(value){
    requireRecoveryTest(value&&Object.keys(value).sort().join(',')===keys.split(',').sort().join(',')&&
      value.format==='antiety-generation-recovery-account-v1'&&value.chainId===String(chainId)&&
      Number.isInteger(value.slot)&&value.slot>=0&&value.slot<65536,'GENERATION_ACCOUNT_INVALID')
    const descriptor=profile.normalizeDescriptor(value.generation)
    requireRecoveryTest(JSON.stringify(descriptor)===JSON.stringify(value.generation)&&
      JSON.stringify(value.initialization)===JSON.stringify({owners:[value.recoveryOwner]}),'GENERATION_ACCOUNT_INVALID')
    // Public prediction verifies the initializer/address. Root-to-slot ownership is checked again
    // from the authenticated export before a signing key is admitted to the controller.
    profile.normalizeDefaultAccount(descriptor,{generationId:descriptor.generationId,chainId,slot:0,
      owner:value.recoveryOwner,safeAddress:value.safeAddress,initializer:value.initializer})
    return value
  }
  const generationExecution={...createRecoveryExecution({...ethers,network,descriptorAdapter:{
    allowGasReturn:true,
    assertDescriptor:assertGenerationAccountDescriptor,
    deploymentInitCode:descriptor=>{
      assertGenerationAccountDescriptor(descriptor)
      return descriptor.generation.stack.factory+factory.encodeFunctionData('createProxyWithNonce',[
        descriptor.generation.stack.singleton,descriptor.initializer,0]).slice(2)
    },
  }}),requireRecoveryTest}
  const generationRecordCodec=createRecoveryRecordCodec({...generationExecution,keccak256:ethers.keccak256,toUtf8Bytes:ethers.toUtf8Bytes,
    allowedActions:['withdraw','deploy','return-gas'],chainId})
  return {profileFor,generationAccountDescriptor,assertGenerationAccountDescriptor,generationExecution,generationRecordCodec}
}
export const {generationAccountDescriptor,assertGenerationAccountDescriptor,generationExecution,generationRecordCodec}=createGenerationRecoveryExecution()
