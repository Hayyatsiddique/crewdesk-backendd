import nodemailer from 'nodemailer';
import {crewAskEmail} from './email-template.js';

/** Provider credentials and message bodies never go to request logs. */
export function createOtpProvider(config,{fetchImpl=fetch,createTransport=nodemailer.createTransport}={}){
  return {async send({channel,to,code}){
    if(config.otpProvider==='development'){
      if(config.production)throw new Error('Development OTP in production');
      process.stdout.write(`[DEV OTP - NEVER PRODUCTION] ${channel} ${to}: ${code}\n`);return;
    }
    let response;
    if(channel==='email'){
      if(!config.smtpHost||!config.smtpPort||!config.smtpUser||!config.smtpPassword||!config.emailFrom)throw new Error('Email provider is not configured');
      const transport=createTransport({
        host:config.smtpHost,
        port:config.smtpPort,
        secure:config.smtpSecure,
        requireTLS:!config.smtpSecure,
        auth:{user:config.smtpUser,pass:config.smtpPassword},
        connectionTimeout:12000,
        greetingTimeout:12000,
        socketTimeout:12000
      });
      await transport.sendMail({
        from:config.emailFrom,
        to,
        subject:'Your Crew Ask verification code',
        text:`Your Crew Ask code is ${code}. It expires in five minutes. Do not share this code.`,
        html:crewAskEmail({preheader:'Your secure Crew Ask verification code',heading:'Your verification code',body:'Use this code to continue signing in. It expires in five minutes. Do not share it with anyone.',code})
      });
      return;
    }
    else{
      if(!config.aircallApiId||!config.aircallApiToken||!config.aircallNumberId)throw new Error('SMS provider is not configured');
      response=await fetchImpl(`https://api.aircall.io/v1/numbers/${encodeURIComponent(config.aircallNumberId)}/messages/send`,{method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:'Basic '+Buffer.from(config.aircallApiId+':'+config.aircallApiToken).toString('base64'),Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({to,body:`Your Crew Ask verification code is ${code}. It expires in 5 minutes. Do not share it.`})});
    }
    if(!response.ok)throw new Error('OTP provider rejected delivery');
  }};
}
