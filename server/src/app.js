import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {apiRoutes} from './routes/api.js';
const mobileClient=(req)=>req.get('sec-ch-ua-mobile')==='?1'||/Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(req.get('user-agent')||'');
export function createApp({domain,auth,config,logger,csrf,getIO=()=>null,isReady=()=>true}){
  const app=express();app.disable('x-powered-by');app.set('trust proxy',config.trustProxy);
  app.use(pinoHttp({logger,genReqId:()=>randomUUID(),serializers:{req:r=>({id:r.id,method:r.method,path:r.url?.split('?')[0]}),res:r=>({statusCode:r.statusCode}),err:e=>({type:e.type,code:e.code,message:e.message})}}));
  app.use((req,res,next)=>{res.set('X-Request-ID',req.id);next();});
  app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],scriptSrcAttr:["'none'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','blob:'],fontSrc:["'self'"],connectSrc:["'self'",'https://photon.komoot.io',...config.origins,...config.origins.map(o=>o.replace(/^http/,'ws'))],frameSrc:["'self'",'https://www.openstreetmap.org'],objectSrc:["'none'"],baseUri:["'none'"],formAction:["'self'"],frameAncestors:["'none'"],upgradeInsecureRequests:config.production?[]:null}},strictTransportSecurity:config.production?{maxAge:31536000,includeSubDomains:true}:false}));
  app.use(cors({origin(origin,cb){cb(null,!origin||config.origins.includes(origin));},credentials:true,methods:['GET','POST','PATCH','OPTIONS'],allowedHeaders:['Content-Type','X-Portal','X-CSRF-Token','Idempotency-Key']}));
  app.use(express.json({limit:'128kb',strict:true}));app.use(cookieParser());
  app.get('/health',(req,res)=>res.status(isReady()?200:503).json({status:isReady()?'ok':'unavailable',database:isReady()?'connected':'disconnected'}));
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(!isReady())return res.status(503).json({error:{code:'DATABASE_UNAVAILABLE',message:'The database is temporarily unavailable.',requestId:req.id}});next();},csrf.check,async(req,res,next)=>{try{await auth.limit('api:'+req.ip,600,60);next();}catch(e){next(e);}},apiRoutes({domain,auth,config,csrf,getIO}));
  app.use('/api',(req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'API route not found.',requestId:req.id}}));
  const client=fileURLToPath(new URL('../../client/',import.meta.url));
  app.get('/',(req,res)=>res.redirect('/client/home'));
  // Keep one client URL: phones receive the mobile shell, while laptop and desktop users receive the full workspace.
  // Vary prevents a CDN or proxy from serving one device's shell to another device type.
  app.get(/^\/client(?:\/.*)?$/,(req,res)=>{res.vary(['User-Agent','Sec-CH-UA-Mobile']);res.set('Accept-CH','Sec-CH-UA-Mobile');res.sendFile(client+(mobileClient(req)?'client-mobile.html':'client-desktop.html'));});
  app.get(/^\/client-mobile(?:\/.*)?$/,(req,res)=>res.sendFile(client+'client-mobile.html'));
  app.get(/^\/staff(?:\/.*)?$/,(req,res)=>{res.vary(['User-Agent','Sec-CH-UA-Mobile']);res.set('Accept-CH','Sec-CH-UA-Mobile');res.sendFile(client+'staff-backend.html');});
  // HTML and runtime configuration always stay fresh; fingerprinted/bundled assets are safe to retain between navigations.
  app.use(express.static(client,{index:false,dotfiles:'deny',setHeaders(res,path){if(path.endsWith('.html')||path.endsWith('runtime-config.js')||path.endsWith('push-service-worker.js'))res.set('Cache-Control','no-store');else res.set('Cache-Control','public, max-age=86400, stale-while-revalidate=604800');}}));
  app.use((req,res)=>res.status(404).type('text').send('Not found'));
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    let status=error.status||500,code=error.code||'INTERNAL_ERROR',message=error.message;
    if(error.code===11000){status=409;code='DUPLICATE';message='A matching record already exists. Refresh and review the existing entry.';}
    if(error.name==='ValidationError'||error.name==='CastError'||error.name==='StrictModeError'){status=400;code='VALIDATION';message='Some fields are invalid.';}
    if(error.type==='entity.parse.failed'){status=400;code='INVALID_JSON';message='The request body must be valid JSON.';}
    if(error.type==='entity.too.large'){status=413;code='PAYLOAD_TOO_LARGE';message='The submitted form is too large.';}
    if(status>=500){logger.error({requestId:req.id,errorType:error.name,errorCode:error.code},'Request failed');message='The request could not be completed. Please try again.';}
    res.status(status).json({error:{code,message,details:status<500?error.details:undefined,requestId:req.id}});
  });
  return app;
}
