import {recoveryIsUnresolved} from '../../shared/wallet/recoveryRecord.js'
export {recoveryIsTerminal} from '../../shared/wallet/recoveryRecord.js'

export function hasRecoveryEvidence(record){
  return !!(record?.transactionHash || record?.plan?.replacesTransactionHash)
}

export function recoveryRecordToResume(records){
  const newest = records.filter(record=>record.plan).sort((a,b)=>b.plan.createdAt-a.plan.createdAt)
  return newest.find(record=>hasRecoveryEvidence(record)&&recoveryIsUnresolved(record))
    ?? newest.find(hasRecoveryEvidence)
    ?? newest[0]
}
