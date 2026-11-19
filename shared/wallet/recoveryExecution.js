import { MAINNET_GENERATION_PINS } from './mainnetGenerationPins.js'
import {resolveWalletAsset} from './assets.js'
import {parsePaymentAmount} from './amounts.js'

export class RecoveryTestError extends Error {
  constructor(code) { super(code); this.code = code }
}
export function requireRecoveryTest(condition, code) {
  if (!condition) throw new RecoveryTestError(code)
}
export function createRecoveryExecution({ Interface, Wallet, Transaction, recoverAddress, TypedDataEncoder, ZeroAddress, getAddress, keccak256, parseEther, toUtf8Bytes, descriptorAdapter,network='ethereum-mainnet' }) {
requireRecoveryTest(network==='ethereum-mainnet','WRONG_NETWORK')
const pins=MAINNET_GENERATION_PINS
requireRecoveryTest(typeof descriptorAdapter?.assertDescriptor==='function'&&typeof descriptorAdapter.deploymentInitCode==='function','MAINNET_RECOVERY_DESCRIPTOR_REQUIRED')
const assertRecoveryDescriptor = descriptorAdapter.assertDescriptor
const initCode = descriptorAdapter.deploymentInitCode
const safeInterface = new Interface([
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function getModulesPaginated(address start,uint256 pageSize) view returns (address[] array,address next)',
  'function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)',
  'function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns (bool)',
  'event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)',
  'event ExecutionFailure(bytes32 indexed txHash,uint256 payment)',
])
const SAFE_TYPES = { SafeTx: [
  { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
  { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' },
  { name: 'gasPrice', type: 'uint256' }, { name: 'gasToken', type: 'address' },
  { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
] }
const descriptorDigest = descriptor => keccak256(toUtf8Bytes(JSON.stringify(descriptor)))
const planDigest = plan => keccak256(toUtf8Bytes(JSON.stringify(plan)))
const atomic = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
const HASH = /^0x[0-9a-f]{64}$/i
const actions=descriptorAdapter?.allowGasReturn?['withdraw','deploy','return-gas']:['withdraw','deploy']
const depositInterface=new Interface(['function withdrawTo(address,uint256)'])
const tokenInterface=new Interface(['function transfer(address,uint256)','event Transfer(address indexed from,address indexed to,uint256 value)'])
function recoveryAsset(input){
  const value=input??{chainId:1,kind:'native',contractAddress:null}
  requireRecoveryTest(value&&Object.keys(value).sort().join(',')==='chainId,contractAddress,kind','INVALID_RECOVERY_ASSET')
  let asset;try{asset=resolveWalletAsset(value)}catch{throw new RecoveryTestError('INVALID_RECOVERY_ASSET')}
  return {chainId:1,kind:asset.kind,contractAddress:asset.contractAddress?.toLowerCase()??null}
}
const planAsset=plan=>{requireRecoveryTest(plan.asset!==undefined,'INVALID_RECOVERY_ASSET');return recoveryAsset(plan.asset)}
const paymentBalance=(state,asset,action)=>action==='return-gas'?state.entryPointDeposit:asset?.kind==='erc20'?state.tokenBalance:state.safeBalance
const paymentMaximum=(1n<<256n)-1n

function safePayment(plan) {
  const returning=plan.action==='return-gas',asset=planAsset(plan),token=asset?.kind==='erc20'
  requireRecoveryTest(!token||plan.action==='withdraw','INVALID_RECOVERY_ASSET')
  return { to: returning?pins.entryPoint.address:token?getAddress(asset.contractAddress):plan.recipient, value: returning||token?'0':plan.amountAtomic,
    data: returning?depositInterface.encodeFunctionData('withdrawTo',[plan.safeAddress,plan.amountAtomic]):
      token?tokenInterface.encodeFunctionData('transfer',[plan.recipient,plan.amountAtomic]):'0x', operation: 0,
    safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: ZeroAddress,
    refundReceiver: ZeroAddress, nonce: plan.safeNonce }
}
function recoverySafeHash(plan) {
  return TypedDataEncoder.hash({ chainId: pins.chainId, verifyingContract: plan.safeAddress },
    SAFE_TYPES, safePayment(plan))
}
function recoverySafeHashCall(plan) {
  return safeInterface.encodeFunctionData('getTransactionHash', Object.values(safePayment(plan)))
}
function recoveryDeploymentCall(descriptor) {
  assertRecoveryDescriptor(descriptor)
  const code = initCode(descriptor)
  return { to: getAddress(code.slice(0, 42)), data: `0x${code.slice(42)}` }
}
const validDeploymentGas = value => atomic(value) && BigInt(value) >= 1000000n && BigInt(value) <= 3000000n
function prepareRecoveryPlan({ descriptor, state, action = 'withdraw', recipient,
  amount = '0.0001', asset:inputAsset,now = Date.now() }) {
  assertRecoveryDescriptor(descriptor)
  requireRecoveryTest(actions.includes(action), 'INVALID_ACTION')
  const asset=recoveryAsset(inputAsset)
  requireRecoveryTest(asset?.kind!=='erc20'||action==='withdraw','INVALID_RECOVERY_ASSET')
  requireRecoveryTest(state.chainId === pins.chainId, 'WRONG_NETWORK')
  requireRecoveryTest(Number.isSafeInteger(now) && now >= 0, 'INVALID_TIME')
  requireRecoveryTest(HASH.test(state.blockHash), 'INVALID_CHAIN_OBSERVATION')
  requireRecoveryTest(typeof state.eoaNonce === 'bigint' && state.eoaNonce >= 0n &&
    state.eoaNonce <= BigInt(Number.MAX_SAFE_INTEGER), 'INVALID_RECOVERY_NONCE')
  requireRecoveryTest(state.eoaNonce === state.pendingEoaNonce, 'RECOVERY_OWNER_HAS_PENDING_TRANSACTION')
  let amountAtomic = '0'
  if (action !== 'deploy') {
    requireRecoveryTest(state.deployed === true, 'DEPLOY_REQUIRED')
    try { recipient = action==='return-gas'?descriptor.safeAddress:getAddress(recipient)
      amountAtomic=parsePaymentAmount(amount,resolveWalletAsset(asset)) }
    catch { throw new RecoveryTestError('INVALID_PAYMENT') }
    requireRecoveryTest(recipient !== ZeroAddress && (action==='return-gas'||recipient !== descriptor.safeAddress) &&
      BigInt(amountAtomic) > 0n && BigInt(amountAtomic) <= paymentMaximum, 'INVALID_PAYMENT')
    requireRecoveryTest(paymentBalance(state,asset,action) >= BigInt(amountAtomic), asset?.kind==='erc20'?'INSUFFICIENT_TOKEN_BALANCE':'INSUFFICIENT_SAFE_BALANCE')
  } else {
    requireRecoveryTest(state.deployed === false, 'SAFE_ALREADY_DEPLOYED')
    recipient = null
  }
  // Browser recovery supplies its independently estimated and simulated limit.
  // Keep the old pure-function default for compatibility with existing CLI plans.
  const gasLimit = action === 'deploy' ? state.deploymentGasLimit ?? '1000000' : '500000'
  requireRecoveryTest(action !== 'deploy' || validDeploymentGas(gasLimit), 'RECOVERY_ACTIVATION_GAS_INVALID')
  const maxPriorityFeePerGas = '1000000000'
  const maxFeePerGas = (state.baseFee * 2n + BigInt(maxPriorityFeePerGas)).toString()
  const maximumFeeAtomic = (BigInt(gasLimit) * BigInt(maxFeePerGas)).toString()
  requireRecoveryTest(BigInt(maximumFeeAtomic) <= parseEther('0.01'), 'RECOVERY_FEE_CAP_TOO_HIGH')
  requireRecoveryTest(state.recoveryBalance >= BigInt(maximumFeeAtomic), 'RECOVERY_OWNER_NEEDS_GAS')
  const payload = { version: 1, chainId: pins.chainId, action,asset,
    safeAddress: descriptor.safeAddress, recoveryOwner: descriptor.recoveryOwner,
    descriptorHash: descriptorDigest(descriptor), recipient, amountAtomic,
    eoaNonce: state.eoaNonce.toString(), safeNonce: state.safeNonce?.toString() ?? null,
    gasLimit, maxPriorityFeePerGas, maxFeePerGas, maximumFeeAtomic,
    blockNumber: state.blockNumber, blockHash: state.blockHash,
    createdAt: now, expiresAt: now + 5 * 60_000 }
  return { ...payload, reviewHash: planDigest(payload) }
}

function assertRecoveryPlan({ plan, descriptor, state, reviewHash, now = Date.now() }) {
  assertRecoveryDescriptor(descriptor)
  requireRecoveryTest(plan && plan.reviewHash === reviewHash && HASH.test(reviewHash || ''), 'REVIEW_HASH_MISMATCH')
  const payload = { ...plan }; delete payload.reviewHash
  requireRecoveryTest(planDigest(payload) === reviewHash, 'REVIEW_HASH_MISMATCH')
  const asset=planAsset(plan)
  requireRecoveryTest(asset?.kind!=='erc20'||plan.action==='withdraw','INVALID_RECOVERY_ASSET')
  requireRecoveryTest(plan.chainId === pins.chainId && plan.version === 1 &&
    plan.safeAddress === descriptor.safeAddress && plan.recoveryOwner === descriptor.recoveryOwner &&
    plan.descriptorHash === descriptorDigest(descriptor), 'PLAN_ACCOUNT_MISMATCH')
  requireRecoveryTest(Number.isSafeInteger(plan.createdAt) && Number.isSafeInteger(plan.expiresAt) &&
    plan.createdAt <= now && plan.expiresAt === plan.createdAt + 5 * 60_000 && now < plan.expiresAt, 'PLAN_EXPIRED')
  for (const key of ['amountAtomic', 'eoaNonce', 'gasLimit', 'maxPriorityFeePerGas', 'maxFeePerGas', 'maximumFeeAtomic']) {
    requireRecoveryTest(atomic(plan[key]), 'INVALID_PLAN')
  }
  requireRecoveryTest(state.chainId === pins.chainId && state.blockNumber >= plan.blockNumber &&
    state.eoaNonce.toString() === plan.eoaNonce && state.eoaNonce === state.pendingEoaNonce, 'RECOVERY_NONCE_CHANGED')
  requireRecoveryTest(actions.includes(plan.action) &&
    (plan.action === 'deploy' ? validDeploymentGas(plan.gasLimit) : plan.gasLimit === '500000') &&
    (plan.replacesTransactionHash ? HASH.test(plan.replacesTransactionHash) && plan.broadcastSource === 'secondary'
      : plan.maxPriorityFeePerGas === '1000000000') &&
    BigInt(plan.maxFeePerGas) >= state.baseFee + BigInt(plan.maxPriorityFeePerGas) &&
    BigInt(plan.maximumFeeAtomic) === BigInt(plan.gasLimit) * BigInt(plan.maxFeePerGas) &&
    BigInt(plan.maximumFeeAtomic) <= parseEther('0.01'), 'FEE_REVIEW_INVALID')
  requireRecoveryTest(state.recoveryBalance >= BigInt(plan.maximumFeeAtomic), 'RECOVERY_OWNER_NEEDS_GAS')
  if (plan.action === 'deploy') {
    requireRecoveryTest(!state.deployed && plan.recipient === null && plan.amountAtomic === '0' && plan.safeNonce === null,
      'DEPLOYMENT_STATE_CHANGED')
  } else {
    requireRecoveryTest(state.deployed && atomic(plan.safeNonce) && state.safeNonce.toString() === plan.safeNonce,
      'SAFE_NONCE_CHANGED')
    requireRecoveryTest(getAddress(plan.recipient) === plan.recipient && plan.recipient !== ZeroAddress &&
      (plan.action==='return-gas'?plan.recipient===descriptor.safeAddress:plan.recipient !== descriptor.safeAddress) && BigInt(plan.amountAtomic) > 0n &&
      BigInt(plan.amountAtomic) <= paymentMaximum, 'INVALID_PAYMENT')
    requireRecoveryTest(paymentBalance(state,asset,plan.action) >= BigInt(plan.amountAtomic), asset?.kind==='erc20'?'INSUFFICIENT_TOKEN_BALANCE':'INSUFFICIENT_SAFE_BALANCE')
  }
  return plan
}

/** Only called after explicit review approval. Never estimates with a live signature. */
async function signRecoveryTransaction({ privateKey, descriptor, plan, state, reviewHash, now, parentRecord }) {
  assertRecoveryPlan({ plan, descriptor, state, reviewHash, now })
  const signer = new Wallet(privateKey)
  requireRecoveryTest(signer.address === descriptor.recoveryOwner, 'RECOVERY_KEY_MISMATCH')
  let to, data
  if (plan.replacesTransactionHash) {
    assertRecoveryReplacement(plan, parentRecord)
    const prior = assertSignedRecoveryRecord(parentRecord)
    to = prior.to; data = prior.data
  } else if (plan.action === 'deploy') {
    const call = recoveryDeploymentCall(descriptor)
    to = call.to; data = call.data
  } else {
    const payment = safePayment(plan)
    const signature = await signer.signTypedData({ chainId: pins.chainId,
      verifyingContract: descriptor.safeAddress }, SAFE_TYPES, payment)
    to = descriptor.safeAddress
    data = safeInterface.encodeFunctionData('execTransaction', [
      ...Object.values(payment).slice(0, 9), signature,
    ])
  }
  const rawTransaction = await signer.signTransaction({ type: 2, chainId: pins.chainId,
    to, data, value: 0, nonce: Number(plan.eoaNonce), gasLimit: plan.gasLimit,
    maxFeePerGas: plan.maxFeePerGas, maxPriorityFeePerGas: plan.maxPriorityFeePerGas })
  return { rawTransaction, transactionHash: keccak256(rawTransaction),
    safeTransactionHash: plan.action !== 'deploy' ? recoverySafeHash(plan) : null }
}

/** Reconciliation never trusts a transaction reference without its saved signed bytes. */
function assertSignedRecoveryRecord(record) {
  const { plan, descriptor } = record || {}
  assertRecoveryDescriptor(descriptor)
  const { reviewHash, ...payload } = plan || {}
  requireRecoveryTest(planDigest(payload) === reviewHash && plan.chainId === pins.chainId &&
    plan.descriptorHash === descriptorDigest(descriptor) && plan.safeAddress === descriptor.safeAddress &&
    plan.recoveryOwner === descriptor.recoveryOwner, 'INVALID_RECOVERY_RECORD')
  const asset=planAsset(plan)
  requireRecoveryTest(asset?.kind!=='erc20'||plan.action==='withdraw','INVALID_RECOVERY_ASSET')
  const transaction = Transaction.from(record.rawTransaction)
  requireRecoveryTest(transaction.hash === record.transactionHash && transaction.type === 2 &&
    transaction.chainId === BigInt(pins.chainId) && transaction.from === descriptor.recoveryOwner &&
    transaction.value === 0n && transaction.nonce === Number(plan.eoaNonce) &&
    transaction.gasLimit === BigInt(plan.gasLimit) && transaction.maxFeePerGas === BigInt(plan.maxFeePerGas) &&
    transaction.maxPriorityFeePerGas === BigInt(plan.maxPriorityFeePerGas), 'SIGNED_TRANSACTION_MISMATCH')
  if (plan.action === 'deploy') {
    const code = initCode(descriptor)
    requireRecoveryTest(transaction.to === getAddress(code.slice(0, 42)) &&
      transaction.data === `0x${code.slice(42)}` && record.safeTransactionHash === null, 'DEPLOYMENT_CALL_MISMATCH')
  } else {
    requireRecoveryTest(actions.includes(plan.action) && transaction.to === descriptor.safeAddress, 'INVALID_RECOVERY_RECORD')
    const args = safeInterface.decodeFunctionData('execTransaction', transaction.data)
    const expected = Object.values(safePayment(plan)).slice(0, 9)
    requireRecoveryTest(expected.every((value, index) => args[index].toString() === value.toString()) &&
      record.safeTransactionHash === recoverySafeHash(plan) &&
      recoverAddress(record.safeTransactionHash, args[9]) === descriptor.recoveryOwner &&
      safeInterface.encodeFunctionData('execTransaction', [...args]) === transaction.data, 'SIGNED_PAYMENT_MISMATCH')
  }
  return transaction
}

const bumpFee = value => (BigInt(value) * 120n + 99n) / 100n
function assertRecoveryReplacement(plan, parent) {
  const prior = assertSignedRecoveryRecord(parent)
  requireRecoveryTest(parent.transactionHash === plan.replacesTransactionHash &&
    plan.broadcastSource === 'secondary' && ['safeAddress', 'recoveryOwner', 'descriptorHash',
      'action', 'recipient', 'amountAtomic', 'eoaNonce', 'safeNonce', 'gasLimit'].every(key =>
      plan[key] === parent.plan[key]) &&
    JSON.stringify(plan.asset)===JSON.stringify(parent.plan.asset)&&
    BigInt(plan.maxFeePerGas) >= bumpFee(prior.maxFeePerGas) &&
    BigInt(plan.maxPriorityFeePerGas) >= bumpFee(prior.maxPriorityFeePerGas), 'REPLACEMENT_MUST_PRESERVE_PAYMENT_AND_NONCES')
  return parent
}

/** Fee-only replacement: both variants share the EOA and Safe nonce. */
function prepareRecoveryReplacement({ parent, descriptor, state, now = Date.now() }) {
  assertSignedRecoveryRecord(parent)
  requireRecoveryTest(['UNKNOWN', 'ATTEMPTED', 'SUBMITTED', 'SIGNED'].includes(parent.status), 'REPLACEMENT_PARENT_NOT_UNRESOLVED')
  const base = prepareRecoveryPlan({ descriptor, state: parent.plan.action === 'deploy'
    ? { ...state, deploymentGasLimit: parent.plan.gasLimit } : state, action: parent.plan.action,
    recipient: parent.plan.recipient,asset:parent.plan.asset,
    amount: formatReplacementAmount(parent.plan.amountAtomic,parent.plan.asset?resolveWalletAsset(parent.plan.asset).decimals:18), now })
  const priority = bumpFee(parent.plan.maxPriorityFeePerGas)
  const observedFee = state.baseFee * 2n + priority
  const bumpedFee = bumpFee(parent.plan.maxFeePerGas)
  const maximumFee = observedFee > bumpedFee ? observedFee : bumpedFee
  const payload = { ...base }; delete payload.reviewHash
  payload.maxPriorityFeePerGas = priority.toString()
  payload.maxFeePerGas = maximumFee.toString()
  payload.maximumFeeAtomic = (maximumFee * BigInt(payload.gasLimit)).toString()
  payload.replacesTransactionHash = parent.transactionHash
  payload.broadcastSource = 'secondary'
  requireRecoveryTest(BigInt(payload.maximumFeeAtomic) <= parseEther('0.01'), 'RECOVERY_FEE_CAP_TOO_HIGH')
  requireRecoveryTest(state.recoveryBalance >= BigInt(payload.maximumFeeAtomic), 'RECOVERY_OWNER_NEEDS_GAS')
  const plan = { ...payload, reviewHash: planDigest(payload) }
  assertRecoveryReplacement(plan, parent)
  return plan
}
function formatReplacementAmount(atomicAmount,decimals=18) {
  const digits = String(atomicAmount).padStart(decimals+1, '0')
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
}

/** Resolve an exact nonce/payment lineage, never an unrelated history entry. */
function recoveryAttemptCandidates(record) {
  const candidates = []
  let current = record
  const seen = new Set()
  while (current) {
    if (current.rawTransaction) {
      assertSignedRecoveryRecord(current)
      requireRecoveryTest(!seen.has(current.transactionHash), 'RECOVERY_HISTORY_CYCLE')
      seen.add(current.transactionHash); candidates.push(current)
    }
    if (!current.plan.replacesTransactionHash) break
    requireRecoveryTest(candidates.length < 10, 'RECOVERY_REPLACEMENT_LIMIT')
    const parent = record.history?.find(item => item.transactionHash === current.plan.replacesTransactionHash)
    requireRecoveryTest(parent, 'RECOVERY_PARENT_MISSING')
    assertRecoveryReplacement(current.plan, parent)
    current = parent
  }
  return candidates
}

function verifyRecoveryReceipts({ record, receipts, blocks, finalizedHeads }) {
  assertSignedRecoveryRecord(record)
  if (!receipts[0] || !receipts[1]) return { status: 'UNKNOWN' }
  const identity = receipt => JSON.stringify({ transactionHash: receipt.transactionHash?.toLowerCase(),
    blockHash: receipt.blockHash?.toLowerCase(), number: BigInt(receipt.blockNumber).toString(),
    status: BigInt(receipt.status).toString() })
  requireRecoveryTest(identity(receipts[0]) === identity(receipts[1]) &&
    receipts.every(receipt => receipt.transactionHash?.toLowerCase() === record.transactionHash.toLowerCase()) &&
    blocks.every(block => block?.hash?.toLowerCase() === receipts[0].blockHash?.toLowerCase() &&
      BigInt(block.number) === BigInt(receipts[0].blockNumber)), 'RECEIPT_DISAGREEMENT')
  let paid = BigInt(receipts[0].status) === 1n
  if (paid && record.plan.action !== 'deploy') {
    const events = receipts.map(receipt => (receipt.logs || []).flatMap(log => {
      if (log.address?.toLowerCase() !== record.plan.safeAddress.toLowerCase()) return []
      try {
        const event = safeInterface.parseLog(log)
        return event?.args?.txHash?.toLowerCase() === record.safeTransactionHash?.toLowerCase() &&
          ['ExecutionSuccess', 'ExecutionFailure'].includes(event.name) ? [event.name] : []
      } catch { return [] }
    }))
    requireRecoveryTest(events.every(rows => rows.length === 1) && events[0][0] === events[1][0], 'SAFE_EXECUTION_NOT_VERIFIED')
    paid = events[0][0] === 'ExecutionSuccess'
    if(planAsset(record.plan).kind==='erc20'){
      const transfer=receipt=>{
        const rows=[]
        for(const log of receipt.logs||[]){
          if(typeof log?.address!=='string'||log.address.toLowerCase()!==record.plan.asset.contractAddress.toLowerCase())continue
          let event;try{event=tokenInterface.parseLog(log)}catch{continue}
          if(event?.name!=='Transfer'||event.args.from.toLowerCase()!==record.plan.safeAddress.toLowerCase())continue
          const encoded=tokenInterface.encodeEventLog('Transfer',event.args)
          requireRecoveryTest(log.removed!==true&&log.transactionHash?.toLowerCase()===record.transactionHash.toLowerCase()&&
            log.blockHash?.toLowerCase()===receipt.blockHash.toLowerCase()&&BigInt(log.blockNumber)===BigInt(receipt.blockNumber)&&
            encoded.data.toLowerCase()===log.data?.toLowerCase()&&JSON.stringify(encoded.topics.map(x=>x.toLowerCase()))===
              JSON.stringify(log.topics?.map(x=>typeof x==='string'?x.toLowerCase():null)), 'TOKEN_EXECUTION_NOT_VERIFIED')
          rows.push({to:event.args.to.toLowerCase(),amount:event.args.value.toString(),logIndex:BigInt(log.logIndex).toString()})
        }
        requireRecoveryTest(paid?rows.length===1&&rows[0].to===record.plan.recipient.toLowerCase()&&rows[0].amount===record.plan.amountAtomic:
          rows.length===0,'TOKEN_EXECUTION_NOT_VERIFIED')
        return rows
      }
      requireRecoveryTest(JSON.stringify(transfer(receipts[0]))===JSON.stringify(transfer(receipts[1])),'TOKEN_EXECUTION_NOT_VERIFIED')
    }
  }
  const finalized = finalizedHeads.every(head => head && BigInt(head.number) >= BigInt(receipts[0].blockNumber))&&
    finalizedHeads.every(head=>HASH.test(head.hash||'')&&head.hash.toLowerCase()===finalizedHeads[0].hash.toLowerCase()&&
      BigInt(head.number)===BigInt(finalizedHeads[0].number)&&
      (BigInt(head.number)!==BigInt(receipts[0].blockNumber)||head.hash.toLowerCase()===receipts[0].blockHash.toLowerCase()))
  return { status: finalized ? paid ? 'FINALIZED' : 'FAILED_FINALIZED' : paid ? 'FINALITY_PENDING' : 'FAILED_FINALITY_PENDING',
    executionSucceeded: paid, blockNumber: Number(BigInt(receipts[0].blockNumber)), blockHash: receipts[0].blockHash }
}

return { assertRecoveryDescriptor, safeInterface, descriptorDigest, recoverySafeHash, recoverySafeHashCall, recoveryDeploymentCall, prepareRecoveryPlan, assertRecoveryPlan, signRecoveryTransaction, assertSignedRecoveryRecord, assertRecoveryReplacement, prepareRecoveryReplacement, recoveryAttemptCandidates, verifyRecoveryReceipts }
}
