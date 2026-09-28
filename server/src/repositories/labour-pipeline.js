/** The company lookup is used only for a staff inbox text search, never for client authorization. */
export function companySearchStages(query,pattern=''){
  if(!pattern)return [{$match:query}];
  const {$or=[],...base}=query;
  return [{$match:base},{$lookup:{from:'companies',localField:'companyId',foreignField:'_id',as:'__company'}},
    {$match:{$or:[...$or,{'__company.name':{$regex:pattern,$options:'i'}},{'__company.aliases':{$regex:pattern,$options:'i'}}]}},{$unset:'__company'}];
}
/** MongoDB-side date-aware filtering. This mirrors the approved phaseFor/firstDate UI. */
export function labourPipeline(query,{page=1,limit=25,status,upcoming=false,now=new Date(),companySearch=''}={}){
  const dateForOffset={$dateToString:{format:'%Y-%m-%d',date:{$dateAdd:{startDate:{$dateFromString:{dateString:'$__candidate',format:'%Y-%m-%d'}},unit:'day',amount:'$$offset'}},timezone:'UTC'}};
  const withinEnd=date=>({$or:[{$eq:['$end','']},{$lte:[date,'$end']}]});
  const weeklyDates={$map:{input:{$range:[0,7]},as:'offset',in:dateForOffset}};
  const firstWeekly={$arrayElemAt:[{$filter:{input:weeklyDates,as:'d',cond:{$and:[withinEnd('$$d'),{$in:[{$subtract:[{$dayOfWeek:{$dateFromString:{dateString:'$$d',format:'%Y-%m-%d'}}},1]},'$days']}]}}},0]};
  const stages=[
    ...companySearchStages(query,companySearch),
    {$set:{__today:{$dateToString:{format:'%Y-%m-%d',date:now,timezone:{$ifNull:['$site.zone','America/Toronto']}}}}},
    {$set:{__candidate:{$cond:[{$gt:['$start','$__today']},'$start','$__today']}}},
    {$set:{__next:{$ifNull:[{$switch:{branches:[
      {case:{$eq:['$mode','dates']},then:{$arrayElemAt:[{$filter:{input:'$dates',as:'d',cond:{$gte:['$$d','$__today']}}},0]}},
      {case:{$eq:['$mode','one']},then:{$cond:[{$gte:['$start','$__today']},'$start',null]}},
      {case:{$eq:['$mode','range']},then:{$cond:[withinEnd('$__candidate'),'$__candidate',null]}},
      {case:{$eq:['$mode','weekly']},then:firstWeekly}
    ],default:null}},null]}}},
    {$set:{__date:{$ifNull:['$__next','$start']}}},
    {$set:{__confirmed:{$let:{vars:{entries:{$filter:{input:{$objectToArray:{$ifNull:['$fills',{}]}},as:'f',cond:{$eq:['$$f.k','$__date']}}}},in:{$ifNull:[{$arrayElemAt:['$$entries.v',0]},0]}}}}},
    {$set:{__phase:{$switch:{branches:[
      {case:{$eq:['$phase','cancelled']},then:'cancelled'},
      {case:{$eq:['$phase','info']},then:'info'},
      {case:{$and:[{$gt:['$headcount',0]},{$gte:['$__confirmed','$headcount']}]},then:'filled'},
      {case:{$or:[{$gt:['$__confirmed',0]},{$in:['$phase',['staffing','filled']]}]},then:'staffing'}
    ],default:'new'}}}}
  ];
  if(status&&status!=='all')stages.push({$match:{__phase:status}});
  if(upcoming)stages.push({$match:{__next:{$ne:null},phase:{$ne:'cancelled'}}});
  stages.push({$facet:{items:[{$sort:upcoming?{__next:1,createdAt:-1,_id:-1}:{createdAt:-1,_id:-1}},{$skip:(page-1)*limit},{$limit:limit},{$unset:['__today','__candidate','__next','__date','__confirmed','__phase']}],count:[{$count:'total'}]}});
  return stages;
}
