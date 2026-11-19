export const statusText = {
  READY: 'Your recovered wallet', PREPARED: 'Review transaction',
  SIGNING: 'Signing was interrupted', SIGNED: 'Signed transaction saved',
  ATTEMPTED: 'Awaiting confirmation', SUBMITTED: 'Awaiting confirmation',
  UNKNOWN: 'Confirmation unknown', FINALITY_PENDING: 'Awaiting finality',
  FAILED_FINALITY_PENDING: 'Failed · awaiting finality', FINALIZED: 'Transaction finalized',
  FAILED_FINALIZED: 'Transaction failed',
}
const errors = {
  RECOVERY_COOLDOWN_INVALID: 'Enter a wait between scan requests from 0.25 to 60 seconds',
  RECOVERY_CONNECTION_SETTINGS_INVALID: 'Enter two HTTPS Ethereum mainnet RPC URLs from different providers under Connection settings',
  GENERATION_RECOVERY_SESSION_LOCKED: 'Recovery is locked. Select the original file and enter its passphrase again',
  GENERATION_RECOVERY_ESTIMATE_INVALID: 'Enter an approximate sender count within the supported range, or leave it blank',
  GENERATION_RECOVERY_SCAN_STORAGE_UNAVAILABLE: 'Search progress cannot be saved. Use a normal browser window with local storage available',
  GENERATION_RECOVERY_SCAN_STORAGE_FAILED: 'Search progress could not be saved. Previously saved progress is unchanged',
  GENERATION_RECOVERY_SCAN_CONFLICT: 'Another recovery tab updated this search. Reopen it to resume the saved progress',
  GENERATION_RECOVERY_SCAN_INVALID: 'Saved search progress could not be verified. Keep browser data and start a fresh search with the original file',
  GENERATION_RECOVERY_SCAN_REQUIRED: 'Scan the complete wallet before choosing a receiving account',
  GENERATION_RECOVERY_ACCOUNT_MISMATCH: 'This recovery file does not match the saved receiving account. Select its original file',
  GENERATION_RECOVERY_KNOWN_ACCOUNT_INVALID: 'Enter a receiving account number within the supported range and its full Ethereum address',
  GENERATION_RECOVERY_SCAN_INTERRUPTED: 'Search stopped. Unlock with the original file to resume the last saved progress',
  GENERATION_RECOVERY_SCAN_TIMEOUT: 'Search timed out. Unlock with the original file to resume the last saved progress',
  GENERATION_RECOVERY_RPC_TIMEOUT: 'A blockchain source timed out. Check Connection settings and try again',
  GENERATION_RECOVERY_RPC_UNAVAILABLE: 'A blockchain source is unavailable. Check Connection settings and try again',
  GENERATION_RECOVERY_RPC_RATE_LIMITED: 'A blockchain source is rate limited. Use your own provider RPC URL under Connection settings',
  GENERATION_RECOVERY_RPC_INVALID: 'The blockchain source returned an invalid or incomplete response',
  GENERATION_RECOVERY_RPC_REJECTED: 'The endpoint rejected a blockchain read. Check its network, RPC access and account limits',
  GENERATION_RECOVERY_RPC_ACCESS_DENIED: 'RPC access was denied. Check the API key and allow this localhost origin in the provider settings',
  GENERATION_RECOVERY_RPC_STALE: 'A blockchain source is behind. Try again shortly or change the source',
  GENERATION_RECOVERY_WRONG_NETWORK: 'Both RPC sources must use Ethereum mainnet',
  GENERATION_RECOVERY_RPC_DISAGREEMENT: 'Blockchain sources disagree. No transaction was approved',
  GENERATION_RECOVERY_SCAN_REORGED: 'The blockchain snapshot changed. Scan the wallet again',
  GENERATION_RECOVERY_ACCOUNT_CONFIGURATION_CHANGED: 'A receiving account has a changed configuration. Recovery stopped',
  GENERATION_RECOVERY_STACK_OR_SNAPSHOT_CHANGED: 'The wallet contracts or blockchain snapshot could not be verified',
  WALLET_GENERATION_CANNOT_DECRYPT: 'Cannot unlock this file. Check the file and its original passphrase',
  WALLET_GENERATION_INVALID_EXPORT: 'Select a current Antiety multi-account recovery file',
  WALLET_GENERATION_INVALID_DESCRIPTOR: 'Use an Antiety multi-account recovery file for Ethereum mainnet',
  RECOVERY_FILE_INVALID: 'Select a valid recovery JSON file',
  RECOVERY_FILE_DECRYPTION_FAILED: 'Cannot unlock this file. Check the file and its original passphrase',
  RECOVERY_SESSION_LOCKED: 'Recovery is locked. Select the file and enter its passphrase again',
  PLAN_EXPIRED: 'This review expired. Refresh it before approving',
  RECOVERY_OWNER_NEEDS_GAS: 'Add ETH to the recovery gas address below, then check the wallet again',
  INSUFFICIENT_SAFE_BALANCE: 'The wallet does not have enough of the selected asset for this amount',
  INVALID_PAYMENT: 'Enter a valid destination and an amount within the available balance',
  DEPLOY_REQUIRED: 'Activate the wallet on Ethereum mainnet before withdrawing',
  RECOVERY_ACTIVATION_GAS_INVALID: 'The account activation gas estimate is outside the supported range. No transaction was signed',
  RECOVERY_ACTIVATION_SIMULATION_FAILED: 'The account activation could not be verified. No transaction was signed',
  RECOVERY_OWNER_HAS_PENDING_TRANSACTION: 'The recovery address has a pending transaction. Wait for it to settle',
  RECOVERY_OTHER_TAB_ACTIVE: 'Another recovery tab is working. Wait for it to finish',
  RECOVERY_BROWSER_LOCK_UNAVAILABLE: 'Use a current browser with Web Locks support to recover safely',
  RECOVERY_STORAGE_UNAVAILABLE: 'Browser storage is unavailable. Use a normal browser window',
  RECOVERY_STORAGE_WRITE_FAILED: 'Could not save transaction status. No automatic retry will be made',
  RECOVERY_SAVED_RECORDS_UNAVAILABLE: 'Could not open saved recovery records. Keep this site’s browser data and reload the page',
  RECOVERY_JOURNAL_INVALID: 'The saved transaction record could not be verified',
  RECONCILE_EXISTING_RECOVERY_FIRST: 'Check the saved transaction before preparing another withdrawal',
  TWO_RPC_SOURCES_REQUIRED: 'Choose two independent Ethereum mainnet RPC endpoints under Connection settings',
  RPC_REQUEST_FAILED: 'Could not reach both blockchain sources. Check Connection settings and try again',
  RPC_CHECK_TIMEOUT: 'The blockchain check timed out. Try again or change the endpoints under Connection settings',
  RPC_HEAD_STALE: 'A blockchain source is behind. Try again shortly or change the source',
  RPC_HEAD_DISAGREEMENT: 'Blockchain sources are not aligned yet. Try again shortly',
  RPC_DISAGREEMENT: 'Blockchain sources disagree. No transaction was approved',
  WRONG_NETWORK: 'An endpoint is on the wrong network. Both must use Ethereum mainnet',
  SAFE_CONFIGURATION_CHANGED: 'Wallet owners or configuration have changed. Recovery stopped',
  RECOVERY_NONCE_CHANGED: 'Another recovery transaction changed the wallet state. Check status and prepare a new review',
  SAFE_NONCE_CHANGED: 'The wallet changed since this review. Check status and prepare a new review',
}
const localDiagnosticCodes=new Set([...Object.keys(errors),'GENERATION_ACCOUNT_INVALID',
  'RECOVERY_JOURNAL_ACCOUNT_MISMATCH','INVALID_ARGUMENT','BAD_DATA','BUFFER_OVERRUN','NUMERIC_FAULT',
  'TypeError','ReferenceError','RangeError','NotFoundError','InvalidStateError','UnknownError',
  'SecurityError','QuotaExceededError','AbortError','VersionError','TransactionInactiveError','DataCloneError'])
export function savedRecoveryRecordsError(cause){
  const error=new Error('RECOVERY_SAVED_RECORDS_UNAVAILABLE')
  error.diagnosticCode=[cause?.code,cause?.message,cause?.name].find(value=>localDiagnosticCodes.has(value))||'UNKNOWN_LOCAL_FAILURE'
  return error
}
const diagnosticStages=new Set(['wallet scan','saved records','transaction status','account selection','account chain check','file unlock'])
const diagnosticMethods=new Set(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getBalance',
  'eth_getStorageAt','eth_getTransactionCount','eth_call','eth_estimateGas','eth_getTransactionReceipt','eth_getTransactionByHash'])
export function recoveryErrorText(error,stage,chainId=1) {
  const mainnetErrors={
    RECOVERY_CONNECTION_SETTINGS_INVALID:'Enter two independent HTTPS Ethereum mainnet RPC URLs under Connection settings',
    GENERATION_RECOVERY_WRONG_NETWORK:'Both RPC sources must use Ethereum mainnet',
    WRONG_NETWORK:'An endpoint is on the wrong network. Both must use Ethereum mainnet',
    TWO_RPC_SOURCES_REQUIRED:'Choose two independent Ethereum mainnet RPC endpoints under Connection settings',
    RECOVERY_OWNER_NEEDS_GAS:'Add ETH on Ethereum mainnet to the recovery gas address below, then check again',
    INSUFFICIENT_SAFE_BALANCE:'The receiving account does not have enough ETH for this amount',
    INSUFFICIENT_TOKEN_BALANCE:'The receiving account does not have enough USDT for this amount',
    INVALID_PAYMENT:'Enter a valid destination and a positive amount in the selected asset’s units',
    DEPLOY_REQUIRED:'Activate this receiving account on Ethereum mainnet before withdrawing',
    TOKEN_TRANSFER_RESTRICTED:'USDT transfers are restricted by the token issuer. No withdrawal was signed',
    TOKEN_POLICY_CHANGED:'The USDT contract policy changed. Recovery stopped before signing',
    TOKEN_EXECUTION_NOT_VERIFIED:'The exact USDT transfer could not be verified. Keep the saved status and check again; do not send another withdrawal',
    INVALID_RECOVERY_ASSET:'Choose ETH or the official Ethereum mainnet USDT token',
  }
  const missingResource=(error?.code||error?.message)==='RPC_REQUEST_FAILED'&&error?.rpcRejection===true&&error?.rpcCode===-32001
  const known=missingResource?'A blockchain source could not find the requested data. Try again shortly':
    mainnetErrors[error?.code||error?.message]||errors[error?.code || error?.message]
  const message=known || 'Recovery could not continue. Check the saved status before trying again'
  const source=['primary','secondary'].includes(error?.source)?`Source ${error.source==='primary'?1:2}: `:''
  const details=[]
  if(source&&Number.isInteger(error.httpStatus)&&error.httpStatus>=100&&error.httpStatus<=599)details.push(`HTTP ${error.httpStatus}`)
  if(source&&Number.isSafeInteger(error.rpcCode))details.push(`RPC ${error.rpcCode}`)
  if(source&&diagnosticMethods.has(error.method))details.push(`request: ${error.method}`)
  if(error?.message==='RECOVERY_SAVED_RECORDS_UNAVAILABLE'&&
    (localDiagnosticCodes.has(error.diagnosticCode)||error.diagnosticCode==='UNKNOWN_LOCAL_FAILURE'))details.push(`saved records: ${error.diagnosticCode}`)
  if(!known)details.push([error?.code,error?.message,error?.name].find(value=>localDiagnosticCodes.has(value))||'UNKNOWN_LOCAL_FAILURE')
  if(diagnosticStages.has(stage))details.push(`stage: ${stage}`)
  return source+message+(details.length?` (${details.join(', ')})`:'')
}
