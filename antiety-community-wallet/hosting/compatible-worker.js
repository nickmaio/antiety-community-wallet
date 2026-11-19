import recovery from './worker.js'
import {recoveryHostingHeaders} from './policy.js'
import {WALLET_APP_ORIGIN,WALLET_PREVIEW_ORIGIN} from '../../shared/wallet/browserOrigins.js'
import {originProofHeaders} from '../../shared/wallet/originProofHostingPolicy.js'

export const relatedOriginsDocument=JSON.stringify({origins:[WALLET_PREVIEW_ORIGIN,WALLET_APP_ORIGIN]})+'\n'

export function createCompatibleRecoveryWorker(publicFiles){
  const allowed=new Set(publicFiles.map(file=>'/'+file))
  return {async fetch(request,env){
    const url=new URL(request.url),path=url.pathname
    const response=(text,status,extra={})=>new Response(request.method==='HEAD'?null:text,{status,headers:{...recoveryHostingHeaders,...extra}})
    const proof=path==='/production-wallet-origin-check'||path==='/production-wallet-origin-check/'
    const proofAsset=/^\/assets\/production-origin-check-[A-Za-z0-9_-]+\.(?:js|css)$/.test(path)
    if(proof||proofAsset){
      const asset=proof?'/production-wallet-origin-check.html':path
      if(!allowed.has(asset))return response('Page not found',404)
      if(!['GET','HEAD'].includes(request.method)){const headers=originProofHeaders();headers.set('Allow','GET, HEAD');return new Response(null,{status:405,headers})}
      url.pathname=asset;url.search=''
      const original=await env.ASSETS.fetch(new Request(url,{method:request.method,headers:request.headers}))
      return new Response(request.method==='HEAD'?null:original.body,{status:original.status,statusText:original.statusText,headers:originProofHeaders(original.headers)})
    }
    if(!['GET','HEAD'].includes(request.method))return response('Static files only',405,{Allow:'GET, HEAD'})
    if(path==='/.well-known/webauthn')return response(relatedOriginsDocument,200,{'Content-Type':'application/json'})
    if(!['/','/robots.txt'].includes(path)&&!allowed.has(path))return response('Page not found',404)
    return recovery.fetch(request,env)
  }}
}
