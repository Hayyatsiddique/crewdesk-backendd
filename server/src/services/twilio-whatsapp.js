/** Twilio's WhatsApp channel uses the standard Message resource with whatsapp: addresses. */
export function createTwilioWhatsApp(config,{fetchImpl=fetch}={}){
  const ready=()=>Boolean(config.twilioWhatsAppEnabled&&config.twilioAccountSid&&config.twilioAuthToken&&config.twilioWhatsAppFrom);
  const address=number=>String(number||'').startsWith('whatsapp:')?String(number):'whatsapp:'+number;
  async function send(to,text){
    if(!to||!ready())return false;
    const body=new URLSearchParams({To:address(to),From:address(config.twilioWhatsAppFrom),Body:String(text).slice(0,1600)});
    const response=await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/Messages.json`,{
      method:'POST',signal:AbortSignal.timeout(12000),
      headers:{Authorization:'Basic '+Buffer.from(config.twilioAccountSid+':'+config.twilioAuthToken).toString('base64'),Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body
    });
    if(!response.ok)throw new Error('Twilio WhatsApp rejected delivery');
    const value=await response.json();
    return {sid:value.sid||'',status:value.status||'queued'};
  }
  return {send,ready};
}
