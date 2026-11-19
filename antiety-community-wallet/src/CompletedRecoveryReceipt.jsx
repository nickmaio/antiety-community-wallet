import PropTypes from 'prop-types'
import {recoveryNativeAmount,recoveryPlanAmount} from './networkPresentation.js'
import RecoveryReference from './RecoveryReference.jsx'

export default function CompletedRecoveryReceipt({record}){
  const reference=record.resolvedByTransactionHash||record.transactionHash
  // If an earlier attempt wins, show its amount and fee.
  const attempt=reference===record.transactionHash?record:record.history?.find(row=>row.transactionHash===reference)
  const plan=attempt?.plan
  if(!plan)return null
  const action=plan.action==='deploy'?'Account activation':plan.action==='return-gas'?'Network fee reserve return':'Withdrawal'
  return <>
    <dl className="facts">
      <dt>Action</dt><dd>{action}</dd>
      {plan.action!=='deploy'&&<><dt>Amount</dt><dd className="transaction-amount">{recoveryPlanAmount(plan)}</dd></>}
      {plan.recipient&&<><dt>{plan.action==='return-gas'?'Return to':'Destination'}</dt><dd><RecoveryReference value={plan.recipient} label="destination address" /></dd></>}
      <dt>Transaction reference</dt><dd><RecoveryReference value={reference} label="transaction reference" compact /></dd>
    </dl>
    <details className="disclosure receipt-details"><summary>Fee details</summary>
      <dl className="facts">
        <dt>Approved maximum network fee</dt><dd>{recoveryNativeAmount(plan.maximumFeeAtomic,plan.chainId??1)}</dd>
        <dt>Gas paid by</dt><dd><RecoveryReference value={plan.recoveryOwner} label="recovery gas address" compact /></dd>
      </dl>
    </details>
  </>
}

CompletedRecoveryReceipt.propTypes={record:PropTypes.object.isRequired}
