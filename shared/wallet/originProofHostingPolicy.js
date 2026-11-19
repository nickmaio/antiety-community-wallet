export const ORIGIN_PROOF_CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'"
export function originProofHeaders(input){
  const headers=new Headers(input)
  headers.set('Content-Security-Policy',ORIGIN_PROOF_CSP)
  headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer')
  headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');headers.set('X-Robots-Tag','noindex, nofollow')
  // This synthetic-only page requires a pinned opener for the ciphertext handoff.
  headers.set('Cross-Origin-Opener-Policy','unsafe-none')
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), publickey-credentials-create=(self), publickey-credentials-get=(self)')
  return headers
}
