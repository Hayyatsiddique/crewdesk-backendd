import pino from 'pino';
export const createLogger=level=>pino({level,redact:{paths:['password','code','token','cookie','authorization','req.headers','req.body','res.headers["set-cookie"]'],remove:true}});
