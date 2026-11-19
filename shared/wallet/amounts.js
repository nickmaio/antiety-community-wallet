const MAX_UINT256 = (1n << 256n) - 1n

function precision(asset) {
  if (!asset || !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36) {
    throw new Error('Invalid asset precision')
  }
  return asset.decimals
}

/** Parse a reviewed payment amount without rounding or floating-point arithmetic. */
export function parsePaymentAmount(display, asset) {
  const decimals = precision(asset)
  if (typeof display !== 'string' || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(display)) {
    throw new Error('Invalid payment amount')
  }
  const [whole, fraction = ''] = display.split('.')
  if (fraction.length > decimals) throw new Error('Too many fractional digits')
  const atomic = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction || '0').padEnd(decimals, '0'))
  if (atomic === 0n || atomic > MAX_UINT256) throw new Error('Payment amount out of range')
  return atomic.toString()
}

/** Normalize on-chain values to an unsigned decimal string. */
export function normalizeAtomicAmount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid atomic amount')
  const atomic = BigInt(value)
  if (atomic > MAX_UINT256) throw new Error('Atomic amount out of range')
  return atomic.toString()
}

/** Format an atomic amount exactly; display truncation belongs to the UI. */
export function formatAtomicAmount(value, asset) {
  const decimals = precision(asset)
  const atomic = BigInt(normalizeAtomicAmount(value))
  const unit = 10n ** BigInt(decimals)
  const whole = atomic / unit
  const fraction = (atomic % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

/** Keep editable decimal input within the displayed balance without floating-point rounding. */
export function boundedPaymentAmountInput(value, balance, asset) {
  if (value === '') return ''
  const decimals = precision(asset)
  if (typeof value !== 'string' || value.length > 100 || !/^(0|[1-9][0-9]*)(?:\.[0-9]*)?$/.test(value)) return null
  if (typeof balance !== 'string' || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(balance) || balance.length > 100) return null
  const atomic = input => {
    const [whole, fraction = ''] = input.split('.')
    if (fraction.length > decimals) return null
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction || '0').padEnd(decimals, '0'))
  }
  const proposed = atomic(value), maximum = atomic(balance)
  if (proposed === null || maximum === null || maximum > MAX_UINT256) return null
  return proposed > maximum ? formatAtomicAmount(maximum.toString(), asset) : value
}
