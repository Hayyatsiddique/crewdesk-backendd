import nodemailer from 'nodemailer';
import {crewAskEmail} from './email-template.js';

/**
 * Sends non-OTP client updates. A failed email must never prevent an SMS (or
 * vice versa), so each delivery is isolated and reported separately.
 */
export function createClientNotifier(config,{fetchImpl=fetch,createTransport=nodemailer.createTransport}={}){
  let mailer;
  const emailReady=()=>Boolean(config.smtpHost&&config.smtpPort&&config.smtpUser&&config.smtpPassword&&config.emailFrom);
  const smsReady=()=>Boolean(config.aircallApiId&&config.aircallApiToken&&config.aircallNumberId);
  const transport=()=>mailer??=createTransport({
    host:config.smtpHost,port:config.smtpPort,secure:config.smtpSecure,requireTLS:!config.smtpSecure,
    auth:{user:config.smtpUser,pass:config.smtpPassword},connectionTimeout:12000,greetingTimeout:12000,socketTimeout:12000
  });
  const urlFor=path=>new URL(path,config.origin).toString();

  async function email(to,message){
    const {subject,text,path,htmlText}=message;
    if(!to||!emailReady())return false;
    await transport().sendMail({
      from:config.emailFrom,to,subject,text,
      html:crewAskEmail({preheader:subject,heading:subject.replace(/^Crew Ask:\s*/,''),body:htmlText||text,actionLabel:'Open Crew Ask',actionUrl:urlFor(path)})
    });
    return true;
  }

  async function sms(to,{text}){
    if(!to||!smsReady())return false;
    const response=await fetchImpl(`https://api.aircall.io/v1/numbers/${encodeURIComponent(config.aircallNumberId)}/messages/send`,{
      method:'POST',signal:AbortSignal.timeout(12000),
      headers:{Authorization:'Basic '+Buffer.from(config.aircallApiId+':'+config.aircallApiToken).toString('base64'),Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify({to,body:text})
    });
    if(!response.ok)throw new Error('SMS provider rejected delivery');
    return true;
  }

  async function completion(users,message){
    const attempts=users.flatMap(user=>[email(user.email,message),sms(user.phone,message)]);
    const results=await Promise.allSettled(attempts);
    return results.reduce((summary,result,index)=>{
      if(result.status==='fulfilled'&&result.value)summary[index%2===0?'email':'sms']++;
      return summary;
    },{email:0,sms:0});
  }

  return {completion,email,sms};
}
