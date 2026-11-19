// RP ID stays unchanged: a different page origin must not create a new wallet identity.
export const WALLET_RP_ID='wallet.antiety.com'
export const WALLET_LEGACY_ORIGIN='https://wallet.antiety.com'
export const WALLET_APP_ORIGIN='https://antiety.com'
export const WALLET_PREVIEW_ORIGIN='https://preview.antiety.com'
const known=Object.freeze([WALLET_LEGACY_ORIGIN,WALLET_APP_ORIGIN,WALLET_PREVIEW_ORIGIN])

/** Callers explicitly select trusted origins; defaults retain the old policy. */
export function normalizeWalletBrowserOrigins(input=[WALLET_LEGACY_ORIGIN]){
  if(!Array.isArray(input)||!input.length||input.length>known.length||
    new Set(input).size!==input.length||input.some(origin=>!known.includes(origin)))throw Error('ROOT_VAULT_INVALID_SETUP')
  return Object.freeze([...input])
}
