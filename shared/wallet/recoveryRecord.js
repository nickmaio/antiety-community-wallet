import { requireRecoveryTest } from './recoveryExecution.js'
import {resolveWalletAsset} from './assets.js'
const fields = new Set(['version', 'descriptor', 'plan', 'status', 'history', 'rawTransaction',
  'transactionHash', 'safeTransactionHash', 'attemptedAt', 'relayFailure', 'executionSucceeded',
  'blockNumber', 'blockHash', 'resolvedByTransactionHash', 'checkedAt'])
const planFields = new Set(['version', 'chainId', 'action', 'safeAddress', 'recoveryOwner',
  'descriptorHash', 'recipient', 'amountAtomic', 'eoaNonce', 'safeNonce', 'gasLimit',
  'maxPriorityFeePerGas', 'maxFeePerGas', 'maximumFeeAtomic', 'blockNumber', 'blockHash',
  'createdAt', 'expiresAt', 'replacesTransactionHash', 'broadcastSource', 'reviewHash','asset'])
const statuses = new Set(['READY', 'PREPARED', 'SIGNING', 'SIGNED', 'ATTEMPTED', 'SUBMITTED',
  'UNKNOWN', 'FINALITY_PENDING', 'FAILED_FINALITY_PENDING', 'FINALIZED', 'FAILED_FINALIZED'])
const terminal = new Set(['FINALIZED', 'FAILED_FINALIZED'])
const hash = /^0x[0-9a-f]{64}$/i

export const recoveryIsTerminal = record => terminal.has(record?.status)
export const recoveryIsUnresolved = record => !!record?.plan && !terminal.has(record.status) &&
  (record.status !== 'PREPARED' || !!record.plan.replacesTransactionHash)

export function createRecoveryRecordCodec({ assertRecoveryDescriptor, assertSignedRecoveryRecord, descriptorDigest, recoveryAttemptCandidates, keccak256, toUtf8Bytes,
  allowedActions = ['withdraw','deploy'],chainId=1 }) {
requireRecoveryTest(chainId===1,'WRONG_NETWORK')
/** Allow only public account/operation data. Never accept a backup or arbitrary stored fields. */
function assertRecoveryRecord(record, ancestor = false) {
  requireRecoveryTest(record && typeof record === 'object' && !Array.isArray(record) &&
    Object.keys(record).every(key => fields.has(key)) && record.version === 1 &&
    statuses.has(record.status), 'RECOVERY_JOURNAL_INVALID')
  assertRecoveryDescriptor(record.descriptor)
  if (record.status === 'READY') {
    requireRecoveryTest(record.plan === null && !record.rawTransaction,
      'RECOVERY_JOURNAL_INVALID')
  } else {
    const plan = record.plan
    requireRecoveryTest(plan && Object.keys(plan).every(key => planFields.has(key)), 'RECOVERY_JOURNAL_INVALID')
    const { reviewHash, ...payload } = plan
    requireRecoveryTest(hash.test(reviewHash) && keccak256(toUtf8Bytes(JSON.stringify(payload))) === reviewHash &&
      plan.version === 1 && plan.chainId === chainId &&
      plan.safeAddress === record.descriptor.safeAddress && plan.recoveryOwner === record.descriptor.recoveryOwner &&
      plan.descriptorHash === descriptorDigest(record.descriptor), 'RECOVERY_JOURNAL_INVALID')
    if(chainId===1){
      requireRecoveryTest(plan.asset&&Object.keys(plan.asset).sort().join(',')==='chainId,contractAddress,kind','RECOVERY_JOURNAL_INVALID')
      let asset;try{asset=resolveWalletAsset(plan.asset)}catch{requireRecoveryTest(false,'RECOVERY_JOURNAL_INVALID')}
      requireRecoveryTest(asset.chainId===chainId&&(asset.kind!=='erc20'||plan.action==='withdraw'),'RECOVERY_JOURNAL_INVALID')
    }else requireRecoveryTest(plan.asset===undefined,'RECOVERY_JOURNAL_INVALID')
    requireRecoveryTest(allowedActions.includes(plan.action) &&
      ['amountAtomic', 'eoaNonce', 'gasLimit', 'maxPriorityFeePerGas', 'maxFeePerGas', 'maximumFeeAtomic'].every(
        key => typeof plan[key] === 'string' && /^(0|[1-9][0-9]*)$/.test(plan[key])) &&
      Number.isSafeInteger(plan.createdAt) && plan.createdAt >= 0 && plan.expiresAt === plan.createdAt + 300000 &&
      Number.isSafeInteger(plan.blockNumber) && plan.blockNumber >= 0 && hash.test(plan.blockHash) &&
      (plan.action !== 'deploy' ? /^0x[0-9a-f]{40}$/i.test(plan.recipient) &&
        typeof plan.safeNonce === 'string' && /^(0|[1-9][0-9]*)$/.test(plan.safeNonce)
        : plan.recipient === null && plan.safeNonce === null) &&
      (plan.replacesTransactionHash == null || hash.test(plan.replacesTransactionHash) &&
        plan.broadcastSource === 'secondary'), 'RECOVERY_JOURNAL_INVALID')
    if (record.rawTransaction) assertSignedRecoveryRecord(record)
    requireRecoveryTest(!['SIGNED', 'ATTEMPTED', 'SUBMITTED', 'UNKNOWN', 'FINALITY_PENDING',
      'FAILED_FINALITY_PENDING', 'FINALIZED', 'FAILED_FINALIZED'].includes(record.status) || !!record.rawTransaction ||
      !!plan.replacesTransactionHash && (record.status === 'UNKNOWN' ||
        record.history?.some(row => row.transactionHash === record.resolvedByTransactionHash)),
    'RECOVERY_JOURNAL_INVALID')
  }
  for (const key of ['transactionHash', 'safeTransactionHash', 'blockHash', 'resolvedByTransactionHash']) {
    requireRecoveryTest(record[key] == null || hash.test(record[key]), 'RECOVERY_JOURNAL_INVALID')
  }
  for (const key of ['attemptedAt', 'checkedAt']) {
    requireRecoveryTest(record[key] == null || typeof record[key] === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record[key]) &&
      Number.isFinite(Date.parse(record[key])), 'RECOVERY_JOURNAL_INVALID')
  }
  requireRecoveryTest(record.blockNumber == null || Number.isSafeInteger(record.blockNumber) && record.blockNumber >= 0,
    'RECOVERY_JOURNAL_INVALID')
  requireRecoveryTest(record.executionSucceeded == null || typeof record.executionSucceeded === 'boolean',
    'RECOVERY_JOURNAL_INVALID')
  for (const key of ['rawTransaction', 'transactionHash', 'safeTransactionHash', 'attemptedAt', 'checkedAt',
    'blockHash', 'resolvedByTransactionHash']) {
    requireRecoveryTest(record[key] == null || typeof record[key] === 'string' && record[key].length <= 32768,
      'RECOVERY_JOURNAL_INVALID')
  }
  if (record.relayFailure != null) {
    const f = record.relayFailure
    requireRecoveryTest(Object.keys(f).every(k => ['source', 'category', 'httpStatus', 'rpcCode',
      'rpcRejection', 'rpcCategory'].includes(k)) &&
      [null, 'primary', 'secondary'].includes(f.source) &&
      [null, 'timeout', 'non-json', 'rpc_http_failure', 'rpc_response_too_large', 'rpc_response_invalid',
        'transport-or-internal', 'unknown'].includes(f.category) &&
      [null, 'underpriced', 'nonce-too-low', 'already-known', 'insufficient-funds', 'intrinsic-gas',
        'unsupported-method', 'rate-or-limit', 'other'].includes(f.rpcCategory) &&
      [f.httpStatus, f.rpcCode].every(v => v == null || Number.isInteger(v)) &&
      typeof f.rpcRejection === 'boolean', 'RECOVERY_JOURNAL_INVALID')
  }
  requireRecoveryTest(record.history == null || !ancestor && Array.isArray(record.history) &&
    record.history.length <= 100, 'RECOVERY_JOURNAL_INVALID')
  for (const row of record.history || []) {
    assertRecoveryRecord(row, true)
    requireRecoveryTest(descriptorDigest(row.descriptor) === descriptorDigest(record.descriptor),
      'RECOVERY_JOURNAL_ACCOUNT_MISMATCH')
  }
  if (!ancestor && record.plan) {
    const attempts = recoveryAttemptCandidates(record)
    requireRecoveryTest(!record.resolvedByTransactionHash || attempts.some(
      row => row.transactionHash === record.resolvedByTransactionHash), 'RECOVERY_JOURNAL_INVALID')
  }
  return record
}

return { assertRecoveryRecord }
}
