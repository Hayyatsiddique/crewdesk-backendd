import mongoose from 'mongoose';
const {Schema}=mongoose;
const str={type:String,default:''};
const arr={type:[String],default:[]};
const mixed=Schema.Types.Mixed;
const sub=fields=>new Schema(fields,{_id:false,id:false,strict:'throw'});
const base={_id:{type:String,required:true},version:{type:Number,default:0},_fence:{type:Number,default:0},createdAt:{type:Date,required:true},updatedAt:{type:Date,required:true}};
const shift=sub({id:String,name:String,startTime:String,endTime:String});
const contact=sub({name:str,email:str,phone:str});
const site=sub({id:String,version:Number,createdAt:Date,updatedAt:Date,name:String,address:String,zone:String,contactName:String,contactPhone:String,notes:String,ppe:[String]});
const pending=sub({id:String,headcount:Number,startTime:String,endTime:String,reason:String,requestedAt:Date,requestedBy:String});
const definitions={
  users:{kind:{type:String,enum:['client','staff'],required:true},name:{type:String,required:true},email:str,phone:str,normalizedEmail:str,normalizedPhone:str,emailAliases:arr,phoneAliases:arr,emailVerified:Boolean,phoneVerified:Boolean,unverifiedEmail:str,unverifiedPhone:str,companyId:{type:String,default:null},requestedCompanyId:{type:String,default:null},requestedCompanyName:str,status:{type:String,enum:['active','disabled','merged'],default:'active'},notificationStatus:{type:String,enum:['pending_login','active'],default:'active'},notificationsActivatedAt:Date,authVersion:{type:Number,default:0},passwordHash:{type:String,select:false},lastLoginAt:Date,mergedInto:String},
  companies:{name:{type:String,required:true},normalizedName:{type:String,required:true},aliases:arr,status:{type:String,enum:['pending','active','suspended','merged'],default:'pending'},industry:str,email:str,phone:str,billingContact:contact,defaultShifts:[shift],tickets:arr,licences:arr,ppe:arr,notes:str,recruiterId:{type:String,default:null},recruiterIds:arr,recruiterNotifications:{type:Map,of:[String],default:{}},signupAt:Date,mergedInto:String},
  recruiters:{name:{type:String,required:true},email:{type:String,required:true},phone:str,whatsappPhone:str,active:{type:Boolean,default:true},userId:{type:String,default:null}},
  worksites:{companyId:{type:String,required:true},name:String,address:String,zone:String,contactName:String,contactPhone:String,notes:str,ppe:arr},
  labour:{referenceNumber:{type:String,required:true},companyId:{type:String,required:true},accountId:{type:String,required:true},role:String,headcount:Number,siteId:String,site,mode:{type:String,enum:['one','range','weekly','dates']},start:String,end:String,days:[Number],dates:[String],startTime:String,endTime:String,equipment:str,tickets:arr,licences:arr,ppe:arr,contactName:String,contactPhone:String,notes:str,internalNotes:str,recruiterId:{type:String,default:null},recruiterIds:arr,recruiterNotifications:{type:Map,of:[String],default:{}},phase:{type:String,enum:['new','info','staffing','filled','cancelled']},fills:{type:Map,of:Number,default:{}},workers:{type:Map,of:[sub({name:String,phone:String})],default:{}},pendingChange:{type:pending,default:null},pendingCancel:{type:pending,default:null}},
  jobs:{referenceNumber:{type:String,required:true},companyId:{type:String,required:true},accountId:{type:String,required:true},title:String,description:String,start:String,end:String,location:String,workType:{type:String,enum:['Contract','Temp','Temp-to-perm','Permanent']},openings:Number,licences:arr,status:{type:String,enum:['new','sourcing','shortlist','closed']},internalNotes:str},
  messages:{requestId:{type:String,required:true},companyId:{type:String,required:true},senderType:{type:String,enum:['client','staff']},senderId:String,senderName:String,text:String},
  profiles:{jobId:{type:String,required:true},companyId:{type:String,required:true},name:String,summary:String,resumeText:String,published:{type:Boolean,default:false},publishedAt:{type:Date,default:null}},
  pushSubscriptions:{userId:{type:String,required:true},endpoint:{type:String,required:true},expirationTime:{type:Number,default:null},keys:sub({p256dh:String,auth:String})},
  events:{type:{type:String,required:true},companyId:{type:String,default:null},actorId:{type:String,default:null},recordId:{type:String,default:null},text:String,metadata:{type:mixed,default:{}}},
  identities:{channel:{type:String,enum:['email','sms']},destination:String,userId:{type:String,required:true},verified:{type:Boolean,default:false}},
  companyNames:{companyId:{type:String,required:true}},
  sessions:{tokenHash:{type:String,required:true},userId:{type:String,required:true},portal:{type:String,enum:['client','staff']},authVersion:Number,expiresAt:{type:Date,required:true}},
  otpChallenges:{portal:{type:String,enum:['client','staff'],default:'client'},channel:{type:String,enum:['email','sms']},destination:String,codeHash:String,attempts:Number,status:{type:String,enum:['pending','consumed','locked','failed']},intent:String,signup:{type:mixed,default:{}},expiresAt:{type:Date,required:true}},
  otpCooldowns:{until:{type:Date,required:true},expiresAt:{type:Date,required:true}},
  rateBuckets:{count:{type:Number,default:0},expiresAt:{type:Date,required:true}},
  readCursors:{userId:String,type:String,through:Date},
  receipts:{userId:String,fingerprint:String,result:mixed,expiresAt:{type:Date,required:true}},
  counters:{value:{type:Number,default:1000}}
};
export const models={};
for(const [name,fields] of Object.entries(definitions)){
  const schema=new Schema({...base,...fields},{versionKey:false,id:false,strict:'throw',minimize:false,autoIndex:false});
  if(['companies','users','labour','jobs','events','worksites','profiles','messages'].includes(name))schema.index({companyId:1,createdAt:-1,_id:-1});
  if(name==='companies'){schema.index({normalizedName:1});schema.index({status:1,createdAt:-1});}
  if(name==='users'){schema.index({normalizedEmail:1});schema.index({normalizedPhone:1});schema.index({kind:1,status:1,companyId:1});}
  if(name==='recruiters')schema.index({email:1},{unique:true});
  if(['labour','jobs'].includes(name)){schema.index({referenceNumber:1},{unique:true});schema.index({[name==='labour'?'phase':'status']:1,createdAt:-1});}
  if(name==='events')schema.index({type:1,createdAt:-1});
  if(name==='profiles')schema.index({jobId:1,published:1,createdAt:1});
  if(name==='pushSubscriptions'){schema.index({endpoint:1},{unique:true});schema.index({userId:1});}
  if(name==='messages')schema.index({requestId:1,createdAt:-1,_id:-1});
  if(name==='sessions'){schema.index({tokenHash:1},{unique:true});schema.index({userId:1});}
  if(name==='identities')schema.index({userId:1});
  if(['sessions','otpChallenges','otpCooldowns','rateBuckets','receipts'].includes(name))schema.index({expiresAt:1},{expireAfterSeconds:0});
  models[name]=mongoose.models[name]||mongoose.model(name,schema,name);
}
export async function ensureIndexes(){
  for(const model of Object.values(models)){await model.createCollection();await model.createIndexes();}
  // Older/demo builds created a unique users.email index. SMS-only accounts
  // intentionally store an empty email, so that legacy index blocks the second
  // phone signup. Authentication uniqueness is enforced by identities._id.
  const userIndexes=await models.users.collection.indexes();
  const legacyEmail=userIndexes.find(index=>index.name==='email_1'&&index.unique===true&&index.key?.email===1&&Object.keys(index.key).length===1);
  if(legacyEmail)await models.users.collection.dropIndex(legacyEmail.name);
}
