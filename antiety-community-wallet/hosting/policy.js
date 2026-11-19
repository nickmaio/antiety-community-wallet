export const recoveryHostingHeaders={
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src https:; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'",
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow',
  'Cross-Origin-Opener-Policy':'same-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()'
}

export function recoveryBrandContentType(path){
  if(path==='/favicon.ico')return 'image/x-icon'
  if(path==='/assets/antiety-logo.png')return 'image/png'
}
