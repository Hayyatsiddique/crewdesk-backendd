import 'dotenv/config';
export function loadConfig(env=process.env){
  const production=env.NODE_ENV==='production',vercelOrigin=env.VERCEL_URL?`https://${env.VERCEL_URL}`:'',vercelProductionOrigin=env.VERCEL_PROJECT_PRODUCTION_URL?`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`:'',origin=env.PUBLIC_ORIGIN||vercelProductionOrigin||vercelOrigin||'http://localhost:5000';
  const origins=[...new Set([...(env.ALLOWED_ORIGINS||origin).split(','),origin,vercelOrigin,vercelProductionOrigin].map(x=>x.trim()).filter(Boolean))];
  for(const o of origins){const url=new URL(o);if(url.origin!==o)throw new Error('ALLOWED_ORIGINS entries must be origins without paths or trailing slashes.');if(production&&url.protocol!=='https:')throw new Error('Production requires HTTPS origins.');}
  if(!env.MONGODB_URI)throw new Error('Set MONGODB_URI to a MongoDB replica set or Atlas URI.');
  if(!env.AUTH_SECRET||env.AUTH_SECRET.length<48||/change|example|replace/i.test(env.AUTH_SECRET))throw new Error('Set AUTH_SECRET to at least 48 randomly generated characters.');
  const otpProvider=env.OTP_PROVIDER||'development';
  if(!['development','live'].includes(otpProvider))throw new Error('OTP_PROVIDER must be development or live.');
  if(production&&otpProvider!=='live')throw new Error('Development OTP delivery is forbidden in production.');
  const port=Number(env.PORT||5000),sessionHours=Number(env.SESSION_HOURS||2160),staffSessionHours=Number(env.STAFF_SESSION_HOURS||2160),trustProxy=Number(env.TRUST_PROXY_HOPS||0);
  if(!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(sessionHours)||sessionHours<1||sessionHours>2160||!Number.isInteger(staffSessionHours)||staffSessionHours<1||staffSessionHours>2160||!Number.isInteger(trustProxy)||trustProxy<0||trustProxy>5)throw new Error('Invalid port, session duration or proxy hop count.');
  const smtpPort=Number(env.SMTP_PORT||587),smtpSecure=['1','true'].includes(String(env.SMTP_SECURE||'0').toLowerCase());
  if(!Number.isInteger(smtpPort)||smtpPort<1||smtpPort>65535)throw new Error('Invalid SMTP port.');
  const twilioVoiceEnabled=['1','true'].includes(String(env.TWILIO_VOICE_ENABLED||'').toLowerCase()),twilioVoiceNewCompany=['1','true'].includes(String(env.TWILIO_VOICE_NEW_COMPANY||'').toLowerCase()),twilioWhatsAppEnabled=['1','true'].includes(String(env.TWILIO_WHATSAPP_ENABLED||'').toLowerCase()),twilioWhatsAppClientNotifications=['1','true'].includes(String(env.TWILIO_WHATSAPP_CLIENT_NOTIFICATIONS||'').toLowerCase()),twilioWhatsAppFrom=env.TWILIO_WHATSAPP_FROM||'';
  if(twilioWhatsAppEnabled&&(!env.TWILIO_ACCOUNT_SID||!env.TWILIO_AUTH_TOKEN||!/^whatsapp:\+[1-9]\d{7,14}$/.test(twilioWhatsAppFrom)))throw new Error('Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM=whatsapp:+<approved sender> before enabling WhatsApp.');
  const pushVapidPublicKey=env.PUSH_VAPID_PUBLIC_KEY||'',pushVapidPrivateKey=env.PUSH_VAPID_PRIVATE_KEY||'',pushVapidSubject=env.PUSH_VAPID_SUBJECT||'';
  if((pushVapidPublicKey||pushVapidPrivateKey||pushVapidSubject)&&!(pushVapidPublicKey&&pushVapidPrivateKey&&/^mailto:|^https:\/\//.test(pushVapidSubject)))throw new Error('Set PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY and a mailto: or https: PUSH_VAPID_SUBJECT together.');
  return {production,port,sessionHours,staffSessionHours,trustProxy,origin,origins,mongoUri:env.MONGODB_URI,secret:env.AUTH_SECRET,otpProvider,smtpHost:env.SMTP_HOST,smtpPort,smtpSecure,smtpUser:env.SMTP_USER,smtpPassword:env.SMTP_PASSWORD,emailFrom:env.EMAIL_FROM||env.SMTP_USER,aircallApiId:env.AIRCALL_API_ID,aircallApiToken:env.AIRCALL_API_TOKEN,aircallNumberId:env.AIRCALL_NUMBER_ID,twilioVoiceEnabled,twilioVoiceNewCompany,twilioWhatsAppEnabled,twilioWhatsAppClientNotifications,twilioWhatsAppFrom,twilioAccountSid:env.TWILIO_ACCOUNT_SID,twilioAuthToken:env.TWILIO_AUTH_TOKEN,twilioVoiceFrom:env.TWILIO_VOICE_FROM,pushVapidPublicKey,pushVapidPrivateKey,pushVapidSubject,logLevel:env.LOG_LEVEL||'info'};
}
