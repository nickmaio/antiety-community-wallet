import {getAddress,keccak256,Interface} from 'ethers'
import {generationExecution} from './generationExecution.js'
import {createRecoveryRpcTransport} from '../../shared/wallet/recoveryRpc.js'

export const {validateRecoveryRpcUrls,applyPublicRecoveryRpcOverride,createRecoveryRpc}=createRecoveryRpcTransport({
  getAddress,keccak256,Interface,safeInterface:generationExecution.safeInterface,network:'ethereum-mainnet'
})
