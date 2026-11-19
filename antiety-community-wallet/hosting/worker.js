import {recoveryBrandContentType,recoveryHostingHeaders} from './policy.js'

/** Static recovery distribution only. RPCs are contacted directly by the browser. */
export default {
  async fetch(request,env){
    const url=new URL(request.url),brandContentType=recoveryBrandContentType(url.pathname)
    const finish=response=>{
      const headers=new Headers(response.headers)
      for(const [key,value]of Object.entries(recoveryHostingHeaders))headers.set(key,value)
      if(response.ok&&url.pathname.startsWith('/.well-known/'))headers.set('Content-Type','application/json')
      if(response.ok&&brandContentType)headers.set('Content-Type',brandContentType)
      if(response.ok&&url.pathname==='/wallet-recovery-ethereum.zip')headers.set('Content-Disposition',`attachment; filename="${url.pathname.slice(1)}"`)
      return new Response(request.method==='HEAD'?null:response.body,{status:response.status,statusText:response.statusText,headers})
    }
    if(!['GET','HEAD'].includes(request.method))return finish(new Response('Static files only',{status:405,headers:{Allow:'GET, HEAD'}}))
    const asset=/^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(url.pathname)
    const association=['/.well-known/assetlinks.json','/.well-known/assetlinks.antiety-development.json','/.well-known/apple-app-site-association'].includes(url.pathname)
    const document=['/','/index.html','/SHA256SUMS.json','/RECOVERY-BUILD.json','/README.md','/wallet-recovery-ethereum.zip','/wallet-recovery-ethereum.zip.sha256'].includes(url.pathname)
    if(asset||association||document||brandContentType){
      if(url.pathname==='/')url.pathname='/index.html'
      url.search=''
      return finish(await env.ASSETS.fetch(new Request(url,{method:request.method,headers:request.headers})))
    }
    if(url.pathname==='/robots.txt')return finish(new Response('User-agent: *\nDisallow: /\n',{headers:{'Content-Type':'text/plain; charset=utf-8'}}))
    return finish(new Response('Page not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}}))
  }
}
