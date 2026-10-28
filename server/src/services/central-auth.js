import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const text=value=>String(value||'').trim();
export const centralCookie='crew_central_sso';
export const centralConfigured=config=>Boolean(config.centralAuthIssuer&&config.centralAuthClientId&&config.centralAuthClientSecret&&config.centralAuthRedirectUri);
export const centralRandom=()=>randomBytes(32).toString('base64url');
export const centralEqual=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
const header=(req,name)=>String(req?.get?.(name)||req?.headers?.[name.toLowerCase()]||'').split(',')[0].trim();
const allowedOrigin=(config,value)=>{try{const url=new URL(String(value||''));return url.origin===String(value||'').replace(/\/$/,'')&&config.origins.includes(url.origin)?url.origin:'';}catch{return '';}};
export function centralBrowserOrigin(config,req,preferred=''){
  const forwardedHost=header(req,'x-forwarded-host'),forwardedProto=header(req,'x-forwarded-proto')||'https';
  const referer=header(req,'referer');
  const candidates=[preferred,forwardedHost?`${forwardedProto}://${forwardedHost}`:'',header(req,'origin'),referer,`${req?.protocol||'https'}://${header(req,'host')}`,config.origin];
  for(const candidate of candidates){try{const origin=allowedOrigin(config,candidate)||allowedOrigin(config,new URL(candidate).origin);if(origin)return origin;}catch{}}
  return config.origin;
}
export const centralCallbackUri=(config,req,preferred='')=>centralBrowserOrigin(config,req,preferred)+'/api/auth/staff/sso/callback';
export function centralAuthorizeUrl(config,state,verifier,silent=false,redirectUri=config.centralAuthRedirectUri){const url=new URL(config.centralAuthIssuer.replace(/\/$/,'')+'/authorize');url.search=new URLSearchParams({response_type:'code',client_id:config.centralAuthClientId,redirect_uri:redirectUri,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});if(silent)url.searchParams.set('prompt','none');return url.toString();}
async function request(config,path,values){if(!centralConfigured(config))throw Object.assign(new Error('Central sign-in is not configured.'),{status:503,code:'SSO_NOT_CONFIGURED'});const response=await fetch(config.centralAuthIssuer.replace(/\/$/,'')+path,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${config.centralAuthClientId}:${config.centralAuthClientSecret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values),signal:AbortSignal.timeout(15000)});const body=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(body.error||'Central sign-in failed.'),{status:response.status,code:'SSO_FAILED'});return body;}
export const centralExchange=(config,code,verifier,redirectUri=config.centralAuthRedirectUri)=>request(config,'/token',{grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:redirectUri});
export const centralIntrospect=(config,token)=>request(config,'/introspect',{token});
export const centralRevoke=async(config,token)=>{if(token&&centralConfigured(config))await request(config,'/revoke',{token}).catch(()=>{});};
