import http from 'node:http';
import mongoose from 'mongoose';
import {attachSockets} from './src/sockets/index.js';
import {initializeRuntime} from './src/runtime.js';
const {app,auth,config,csrf,logger,setIO}=await initializeRuntime();let sockets;
const server=http.createServer(app);server.requestTimeout=30000;server.headersTimeout=10000;
sockets=attachSockets(server,{auth,config,csrf,logger});
setIO(sockets.io);
server.listen(config.port,()=>logger.info({port:config.port},'Crew Ask started'));
mongoose.connection.on('disconnected',()=>logger.warn('Database disconnected'));
mongoose.connection.on('connected',()=>logger.info('Database connected'));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;logger.info('Shutting down');const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();await sockets.close();await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();clearTimeout(deadline);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
