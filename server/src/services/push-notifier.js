import webpush from 'web-push';

/** Browser push is deliberately optional: mail and SMS delivery remain usable without it. */
export function createPushNotifier(config,{client=webpush}={}){
  const enabled=Boolean(config.pushVapidPublicKey&&config.pushVapidPrivateKey&&config.pushVapidSubject);
  if(enabled)client.setVapidDetails(config.pushVapidSubject,config.pushVapidPublicKey,config.pushVapidPrivateKey);

  async function send(subscriptions,{title,body,path}){
    if(!enabled||!subscriptions.length)return {sent:0,expired:[]};
    const payload=JSON.stringify({title:String(title).slice(0,120),body:String(body).slice(0,240),path:String(path||'/client')});
    const results=await Promise.allSettled(subscriptions.map(subscription=>client.sendNotification({endpoint:subscription.endpoint,expirationTime:subscription.expirationTime,keys:subscription.keys},payload,{TTL:86400,urgency:'high'})));
    return results.reduce((summary,result,index)=>{
      if(result.status==='fulfilled')summary.sent++;
      else if([404,410].includes(result.reason?.statusCode))summary.expired.push(subscriptions[index].id);
      return summary;
    },{sent:0,expired:[]});
  }

  return {enabled:()=>enabled,publicKey:()=>enabled?config.pushVapidPublicKey:'',send};
}
