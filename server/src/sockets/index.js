import {Server} from 'socket.io';
import {models} from '../models/index.js';
import {cookieName,csrfCookie} from '../middleware/security.js';
function cookies(header=''){return Object.fromEntries(header.split(';').map(s=>s.trim().split(/=(.*)/s)).filter(x=>x[0]&&x[1]).map(([k,v])=>[k,v]));}
export function attachSockets(server,{auth,config,csrf,logger}){
  const io=new Server(server,{cors:{origin:config.origins,credentials:true},maxHttpBufferSize:16384,serveClient:true,allowRequest(req,callback){callback(null,config.origins.includes(req.headers.origin));}});
  io.use(async(socket,next)=>{
    try{
      const portal=socket.handshake.auth.portal==='staff'?'staff':'client',jar=cookies(socket.request.headers.cookie);
      if(!csrf.valid(portal,socket.handshake.auth.csrfToken,jar[csrfCookie(portal,config.production)]))throw new Error('Invalid CSRF token');
      const token=jar[cookieName(portal,config.production)],found=await auth.authenticate(token,portal);
      socket.data={userId:found.user.id,companyId:found.user.companyId,portal,token,sessionId:found.session.id};next();
    }catch{next(new Error('Authentication required'));}
  });
  io.on('connection',socket=>{
    const d=socket.data;socket.join('user:'+d.userId);socket.join('session:'+d.sessionId);
    if(d.portal==='staff')socket.join('staff');else if(d.companyId)socket.join('company:'+d.companyId);
    // No client-controlled join-room or mutation listeners are registered.
    const timer=setInterval(async()=>{try{await auth.authenticate(d.token,d.portal);}catch{socket.disconnect(true);}},15000);timer.unref();socket.on('disconnect',()=>clearInterval(timer));
  });
  let stream,closing=false,retry;
  const openStream=()=>{
    if(closing)return;
    stream=models.events.watch([{$match:{operationType:'insert'}}],{fullDocument:'default'});
    stream.on('change',change=>{
      const e=change.fullDocument;if(!e)return;
      // Invalidation metadata only. Internal event text, notes and drafts are never broadcast.
      const notice={type:e.type,recordId:e.recordId,at:new Date(e.createdAt).toISOString()};
      for(const id of e.metadata?.affectedUserIds||[])io.in('user:'+id).disconnectSockets(true);
      for(const id of e.metadata?.refreshUserIds||[])io.to('user:'+id).emit('invalidate',notice);
      io.to('staff').emit('invalidate',notice);
      if(e.companyId)io.to('company:'+e.companyId).emit('invalidate',notice);
      if(e.actorId)io.to('user:'+e.actorId).emit('invalidate',notice);
    });
    stream.on('error',()=>{logger.warn('Realtime database stream interrupted; reconnecting.');stream.close().catch(()=>{});clearTimeout(retry);retry=setTimeout(()=>{io.emit('invalidate',{type:'sync.reconnected'});openStream();},3000);retry.unref();});
  };
  openStream();
  return {io,async close(){closing=true;clearTimeout(retry);await stream?.close();await new Promise(resolve=>io.close(resolve));}};
}
