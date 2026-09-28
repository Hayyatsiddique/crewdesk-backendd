import {initializeRuntime} from '../../server/src/runtime.js';

export default async function handler(req,res){
  try{
    const {app,ensureDatabase}=await initializeRuntime();
    await ensureDatabase();
    return app(req,res);
  }catch(error){
    console.error('Crew Ask serverless startup failed',{name:error?.name,message:error?.message});
    if(!res.headersSent)res.status(503).json({error:{code:'STARTUP_UNAVAILABLE',message:'The service is temporarily unavailable.'}});
  }
}
