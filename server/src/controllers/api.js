import {fail} from '../domain/errors.js';
export const read=fn=>async(req,res,next)=>{try{res.json({data:await fn(req)});}catch(error){next(error);}};
export function command(service,name,{id=req=>req.params.id||'',created=false}={}){
  return read(async req=>{const key=req.get('Idempotency-Key');if(created&&!key)fail(400,'IDEMPOTENCY_REQUIRED','A retry-safe submission key is required.');return service.execute(req.user,name,req.body,id(req),{key,route:req.baseUrl+req.route.path});});
}
