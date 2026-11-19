import {formatUnits} from 'ethers'
import {resolveWalletAsset,WALLET_ASSETS} from '../../shared/wallet/assets.js'

export function recoveryNetwork(chainId=1){
  if(chainId!==1)throw new Error('WRONG_NETWORK')
  return {chainId,name:'Ethereum mainnet',nativeSymbol:'ETH',funds:'ETH and USDT'}
}
export function recoverySelectedAsset(chainId,kind='native'){
  recoveryNetwork(chainId)
  if(!['native','erc20'].includes(kind))throw new Error('INVALID_RECOVERY_ASSET')
  return {chainId:1,kind,contractAddress:kind==='erc20'?WALLET_ASSETS.USDT.contractAddress.toLowerCase():null}
}
export function recoveryNativeAmount(value,chainId=1){
  return formatUnits(value,18)+' '+recoveryNetwork(chainId).nativeSymbol
}
export function recoveryPlanInput(plan){
  recoveryNetwork(plan.chainId)
  const asset=resolveWalletAsset(plan.asset)
  if(asset.chainId!==1)throw new Error('INVALID_RECOVERY_ASSET')
  return {action:plan.action,recipient:plan.recipient,amount:formatUnits(plan.amountAtomic,asset.decimals),
    asset:plan.asset,replacement:!!plan.replacesTransactionHash}
}
export function recoveryPlanAmount(plan){
  return recoveryPlanInput(plan).amount+' '+resolveWalletAsset(plan.asset).symbol
}
