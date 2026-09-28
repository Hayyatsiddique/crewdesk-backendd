import mongoose from 'mongoose';
import {loadConfig} from './config/env.js';
import {createLogger} from './config/logger.js';
import {MongoRepository,initializeDatabase} from './repositories/mongo.js';
import {CrewDeskService} from './domain/service.js';
import {AuthService} from './domain/auth.js';
import {createOtpProvider} from './services/otp-provider.js';
import {csrfSecurity} from './middleware/security.js';
import {createApp} from './app.js';

let runtimePromise;
let connectionPromise;
let databaseBootstrapped=false;

async function ensureDatabase(config){
  if(mongoose.connection.readyState===1)return;
  connectionPromise??=mongoose.connect(config.mongoUri,{serverSelectionTimeoutMS:10000,maxPoolSize:10,minPoolSize:0,autoIndex:false}).finally(()=>{connectionPromise=null;});
  await connectionPromise;
  if(!databaseBootstrapped){
    const hello=await mongoose.connection.db.admin().command({hello:1});
    if(!hello.setName&&hello.msg!=='isdbgrid')throw new Error('MongoDB must be a replica set or Atlas deployment: transactional writes are mandatory.');
    await initializeDatabase();
    databaseBootstrapped=true;
  }
}

/** Build one application runtime per Node process (or warm serverless instance). */
export function initializeRuntime(){
  runtimePromise??=(async()=>{
    const config=loadConfig(),logger=createLogger(config.logLevel);
    await ensureDatabase(config);
    const repo=new MongoRepository(),domain=new CrewDeskService(repo);
    const auth=new AuthService(repo,domain,{secret:config.secret,provider:createOtpProvider(config),sessionHours:config.sessionHours,staffSessionHours:config.staffSessionHours});
    const csrf=csrfSecurity(config);let io;
    const app=createApp({domain,auth,config,logger,csrf,getIO:()=>io,isReady:()=>mongoose.connection.readyState===1});
    return {app,auth,config,csrf,logger,ensureDatabase:()=>ensureDatabase(config),setIO:value=>{io=value;}};
  })();
  return runtimePromise;
}
