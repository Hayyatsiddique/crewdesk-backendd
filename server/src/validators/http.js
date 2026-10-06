import {z} from 'zod';
const text=z.string().max(16000),version=z.number().int().nonnegative(),id=z.string().min(1).max(100),tags=z.array(z.string().max(80)).max(100);
const site={name:text,address:text,zone:text,contactName:text,contactPhone:text,notes:text.optional(),ppe:tags.optional()};
const crew={role:text,headcount:z.number(),headcountByDate:z.record(z.string().max(20),z.number()).optional(),siteId:id,mode:text,start:text,end:text.optional(),days:z.array(z.number()).max(7).optional(),dates:z.array(text).max(100).optional(),startTime:text,endTime:text,equipment:text.optional(),tickets:tags.optional(),licences:tags.optional(),ppe:tags.optional(),contactName:text,contactPhone:text,notes:text.optional()};
const company={version,name:text,industry:text.optional(),email:text.optional(),phone:text.optional(),billingContact:z.object({name:text,email:text,phone:text}).strict(),defaultShifts:z.array(z.object({id,text: text.optional(),name:text,startTime:text,endTime:text}).omit({text:true}).strict()).max(30),tickets:tags,licences:tags,ppe:tags,notes:text.optional()};
const schemas={
  otp:z.object({channel:z.enum(['email','sms']),contact:text,intent:z.enum(['signin','signup']),name:text.optional(),companyName:text.optional(),secondary:text.optional()}).strict(),
  verify:z.object({challengeId:id,code:z.string().length(6)}).strict(),staffOtp:z.object({channel:z.enum(['email','sms']),contact:text}).strict(),
  'company.update':z.object(company).strict(),'company.status':z.object({version,status:text}).strict(),
  'company.merge':z.object({sourceId:id,targetId:id,sourceVersion:version,targetVersion:version,confirm:z.literal(true)}).strict(),
  'site.create':z.object(site).strict(),'site.update':z.object({...site,version}).strict(),
  'account.create':z.object({name:text,email:text.optional(),phone:text.optional(),companyId:id.nullable().optional()}).strict(),
  'account.link':z.object({version,companyId:id,confirm:z.literal(true)}).strict(),
  'account.remove':z.object({version}).strict(),
  'account.merge':z.object({sourceId:id,targetId:id,sourceVersion:version,targetVersion:version,companyId:id.nullable(),confirm:z.literal(true)}).strict(),
  'recruiter.create':z.object({name:text,email:text,phone:text.optional(),whatsappPhone:text.optional()}).strict(),'recruiter.contact':z.object({version,email:text,phone:text.optional(),whatsappPhone:text.optional()}).strict(),'recruiter.signup-notifications':z.object({version,notificationChannels:z.array(z.enum(['sms','email'])).max(2)}).strict(),'recruiter.remove':z.object({version}).strict(),
  'company.recruiter':z.object({version,recruiterIds:z.array(id).max(20),notificationChannels:z.record(z.array(z.enum(['sms','whatsapp','email','voice'])).max(4)).optional()}).strict(),
  'labour.recruiter':z.object({version,recruiterIds:z.array(id).max(20),notificationChannels:z.record(z.array(z.enum(['sms','whatsapp','email','voice'])).max(4)).optional()}).strict(),
  'labour.create':z.object(crew).strict(),'labour.accept':z.object({version}).strict(),'labour.confirm':z.object({version,date:text,count:z.number(),workers:z.array(z.object({name:text,phone:text}).strict()).max(500).optional()}).strict(),
  'labour.message':z.object({text,needInfo:z.boolean().optional()}).strict(),'labour.note':z.object({version,text}).strict(),
  'labour.change':z.object({version,headcount:z.number(),startTime:text,endTime:text,reason:text}).strict(),'labour.cancel':z.object({version,reason:text}).strict(),
  'labour.resolve':z.object({version,approve:z.boolean(),pendingId:id}).strict(),
  'job.create':z.object({title:text,description:text,start:text,end:text,location:text,workType:text,openings:z.number(),licences:tags.optional()}).strict(),
  'job.status':z.object({version,status:text}).strict(),'job.note':z.object({version,text}).strict(),'job.profile':z.object({version,name:text,summary:text,resumeText:text}).strict(),
  'push.subscribe':z.object({endpoint:z.string().url().max(2000),expirationTime:z.number().nullable().optional(),keys:z.object({p256dh:z.string().min(20).max(300),auth:z.string().min(8).max(200)}).strict()}).strict(),
  'events.read':z.object({through:text}).strict()
};
export const validate=name=>(req,res,next)=>{const result=schemas[name].safeParse(req.body);if(!result.success)return next(Object.assign(new Error('Some fields are invalid.'),{status:400,code:'VALIDATION',details:result.error.issues.map(i=>({field:i.path.join('.'),message:i.message}))}));req.body=result.data;next();};
