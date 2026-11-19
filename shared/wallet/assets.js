export const ETHEREUM_MAINNET_CHAIN_ID = 1
export const WALLET_ASSETS = Object.freeze({
  ETH: Object.freeze({
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    kind: 'native',
    contractAddress: null,
    symbol: 'ETH',
    decimals: 18,
  }),
  USDT: Object.freeze({
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    kind: 'erc20',
    contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    decimals: 6,
  }),
})

/** Resolve by chain and contract identity, never by a caller-provided ticker. */
export function resolveWalletAsset({ chainId, kind, contractAddress } = {}) {
  if (chainId !== ETHEREUM_MAINNET_CHAIN_ID) throw new Error('Unsupported wallet network')
  if (kind === 'native' && contractAddress == null) return WALLET_ASSETS.ETH
  if (kind === 'erc20' && typeof contractAddress === 'string' &&
      /^0x[0-9a-fA-F]{40}$/.test(contractAddress) &&
      contractAddress.toLowerCase() === WALLET_ASSETS.USDT.contractAddress.toLowerCase()) return WALLET_ASSETS.USDT
  throw new Error('Unsupported wallet asset')
}
