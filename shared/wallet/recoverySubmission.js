import { requireRecoveryTest } from './recoveryExecution.js'

export function safeRecoveryRelayFailure(error) {
  return {
    source: ['primary', 'secondary'].includes(error?.source) ? error.source : null,
    category: ['timeout', 'non-json', 'rpc_http_failure', 'rpc_response_too_large',
      'rpc_response_invalid', 'transport-or-internal'].includes(error?.category) ? error.category : 'unknown',
    httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
    rpcCode: Number.isInteger(error?.rpcCode) ? error.rpcCode : null,
    rpcRejection: error?.rpcRejection === true,
    rpcCategory: ['underpriced', 'nonce-too-low', 'already-known', 'insufficient-funds',
      'intrinsic-gas', 'unsupported-method', 'rate-or-limit', 'other'].includes(error?.rpcCategory) ? error.rpcCategory : null,
  }
}

/** Persist before each irreversible boundary; never repeat an attempted transport. */
export async function submitRecoveryAttempt({ record, save, sign, broadcast, reviewHash }) {
  requireRecoveryTest(record?.status === 'PREPARED' && record.plan?.reviewHash === reviewHash,
    'RECOVERY_ALREADY_STARTED_OR_REVIEW_CHANGED')
  let current = { ...record, status: 'SIGNING' }
  await save(current)
  const signed = await sign()
  current = { ...current, ...signed, status: 'SIGNED' }
  await save(current)
  current = { ...current, status: 'ATTEMPTED', attemptedAt: new Date().toISOString() }
  await save(current)
  try {
    const hash = await broadcast(signed.rawTransaction)
    requireRecoveryTest(hash?.toLowerCase() === signed.transactionHash.toLowerCase(), 'RPC_REPLY_HASH_MISMATCH')
    current = { ...current, status: 'SUBMITTED' }
  } catch (error) {
    current = { ...current, status: 'UNKNOWN', relayFailure: safeRecoveryRelayFailure(error) }
  }
  await save(current)
  return current
}
