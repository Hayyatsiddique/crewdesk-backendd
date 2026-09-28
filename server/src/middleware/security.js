import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {fail} from '../domain/errors.js';
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export const portalOf=req=>req.get('X-Portal')==='staff'?'staff':'client';
export const cookieName=(portal,production)=>(production?'__Host-':'')+'cd_'+portal;
export const csrfCookie=(portal,production)=>(production?'__Host-':'')+'cd_csrf_'+portal;
export const cookieOptions=config=>({httpOnly:true,secure:config.production,sameSite:'strict',path:'/'});
export function csrfSecurity(config){
  const sign=(portal,token)=>createHmac('sha256',config.secret).update('csrf:'+portal+':'+token).digest('hex');
  const valid=(portal,token,signed)=>{if(typeof token!=='string'||typeof signed!=='string'||!/^[\w-]{43}$/.test(token))return false;return same(signed,token+'.'+sign(portal,token));};
  return {
    issue(req,res){const portal=portalOf(req),existing=req.cookies[csrfCookie(portal,config.production)],candidate=existing?.split('.')[0],token=valid(portal,candidate,existing)?candidate:randomBytes(32).toString('base64url');res.cookie(csrfCookie(portal,config.production),token+'.'+sign(portal,token),{...cookieOptions(config),maxAge:86400000});res.json({data:{csrfToken:token}});},
    check(req,res,next){
      if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
      const origin=req.get('Origin');if(origin&&!config.origins.includes(origin))return next(Object.assign(new Error('Untrusted request origin.'),{status:403,code:'ORIGIN_REJECTED'}));
      const portal=portalOf(req);if(!valid(portal,req.get('X-CSRF-Token'),req.cookies[csrfCookie(portal,config.production)]))return next(Object.assign(new Error('Refresh the page and retry this action.'),{status:403,code:'CSRF_INVALID'}));next();
    },valid
  };
}
export function authenticate(auth,config,kind){return async(req,res,next)=>{try{const portal=kind||portalOf(req);const found=await auth.authenticate(req.cookies[cookieName(portal,config.production)],portal);req.user=found.user;req.authSession=found.session;next();}catch(error){next(error);}};}
export const requireKind=kind=>(req,res,next)=>req.user?.kind===kind?next():next(Object.assign(new Error('Not authorized for this portal.'),{status:403,code:'FORBIDDEN'}));
export function sessionResponse(res,value,config){res.cookie(cookieName(value.user.kind,config.production),value.token,{...cookieOptions(config),expires:new Date(value.expiresAt)});return {user:value.user,expiresAt:value.expiresAt};}
