import {Interface} from 'ethers'
import {requireRecoveryTest as require} from '../../shared/wallet/recoveryExecution.js'

const factory=new Interface(['function createProxyWithNonce(address,bytes,uint256) returns(address)'])
const quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i.test(value)
const hex=value=>'0x'+BigInt(value).toString(16)
const cap=3000000n
function activationCall(execution,descriptor,state,plan){
  require(state.deployed===false,'SAFE_ALREADY_DEPLOYED')
  const call=execution.recoveryDeploymentCall(descriptor)
  return {...call,from:descriptor.recoveryOwner,value:'0x0',nonce:hex(state.eoaNonce),
    gas:hex(plan?.gasLimit??cap),maxFeePerGas:hex(plan?.maxFeePerGas??(state.baseFee*2n+1000000000n)),
    maxPriorityFeePerGas:hex(plan?.maxPriorityFeePerGas??1000000000n)}
}
async function verifySnapshot(rpc,state){
  const blocks=await Promise.all([0,1].map(source=>rpc.read(source,'eth_getBlockByNumber',[hex(state.blockNumber),false])))
  require(blocks.every(block=>quantity(block?.number)&&BigInt(block.number)===BigInt(state.blockNumber)&&
    typeof block.hash==='string'&&block.hash.toLowerCase()===state.blockHash.toLowerCase()),'RPC_DISAGREEMENT')
}
/** No signature is used: factory deployment is an ordinary public call. */
export async function verifyRecoveryActivation({rpc,execution,descriptor,state,plan}){
  require(plan?.action==='deploy'&&/^(?:0|[1-9][0-9]*)$/.test(plan.gasLimit)&&
    BigInt(plan.gasLimit)>=1000000n&&BigInt(plan.gasLimit)<=cap,'RECOVERY_ACTIVATION_GAS_INVALID')
  const call=activationCall(execution,descriptor,state,plan)
  const results=await Promise.all([0,1].map(source=>rpc.read(source,'eth_call',[call,hex(state.blockNumber)])))
  for(const result of results){
    let address
    try{address=factory.decodeFunctionResult('createProxyWithNonce',result)[0]}catch{require(false,'RECOVERY_ACTIVATION_SIMULATION_FAILED')}
    require(address===descriptor.safeAddress&&factory.encodeFunctionResult('createProxyWithNonce',[address])===result,
      'RECOVERY_ACTIVATION_SIMULATION_FAILED')
  }
  require(results[0]===results[1],'RPC_DISAGREEMENT')
  await verifySnapshot(rpc,state)
}
export async function estimateRecoveryActivation({rpc,execution,descriptor,state}){
  const call=activationCall(execution,descriptor,state)
  const estimates=await Promise.all([0,1].map(source=>rpc.read(source,'eth_estimateGas',[call,hex(state.blockNumber)])))
  require(estimates.every(value=>quantity(value)&&BigInt(value)>=21000n&&BigInt(value)<=cap),'RECOVERY_ACTIVATION_GAS_INVALID')
  const maximum=estimates.map(BigInt).reduce((a,b)=>a>b?a:b),padded=(maximum*125n+99n)/100n
  const gasLimit=(padded<1000000n?1000000n:padded).toString()
  require(BigInt(gasLimit)<=cap,'RECOVERY_ACTIVATION_GAS_INVALID')
  return gasLimit
}
