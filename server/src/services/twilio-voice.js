const xml=value=>String(value||'').replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]));

/** Outbound recruiter alerts only. Disabled unless the operator explicitly enables it. */
export function createTwilioVoice(config,{fetchImpl=fetch}={}){
  const ready=()=>Boolean(config.twilioVoiceEnabled&&config.twilioAccountSid&&config.twilioAuthToken&&config.twilioVoiceFrom);
  async function call(to,text){
    if(!to||!ready())return false;
    const body=new URLSearchParams({
      To:to,
      From:config.twilioVoiceFrom,
      Twiml:`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna" language="en-US">${xml(text)}</Say></Response>`,
      TimeLimit:'45'
    });
    const response=await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/Calls.json`,{
      method:'POST',signal:AbortSignal.timeout(12000),
      headers:{Authorization:'Basic '+Buffer.from(config.twilioAccountSid+':'+config.twilioAuthToken).toString('base64'),Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body
    });
    if(!response.ok)throw new Error('Twilio Voice rejected the call request');
    const value=await response.json();
    return {sid:value.sid||'',status:value.status||'queued'};
  }
  return {call,ready};
}
