/** Explicit allowlists: a client never receives private notes, credentials or draft profiles. */
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, structuredClone(o[k])]));
const base = ['id','version','createdAt','updatedAt'];
export function userDTO(u, staff = false) {
  return pick(u,[...base,'kind','name','email','phone','companyId','status','emailAliases','phoneAliases','emailVerified','phoneVerified',
    ...(staff ? ['requestedCompanyId','requestedCompanyName','lastLoginAt','mergedInto','unverifiedEmail','unverifiedPhone'] : [])]);
}
export function siteDTO(s) { return pick(s,[...base,'name','address','zone','contactName','contactPhone','notes','ppe']); }
export function companyDTO(c, sites = [], staff = false) {
  return {...pick(c,[...base,'name','aliases','status','industry','email','phone','defaultShifts','tickets','licences','ppe','signupAt',
    ...(staff ? ['billingContact','notes','recruiterId','recruiterIds','recruiterNotifications','mergedInto'] : [])]),worksites:sites.map(siteDTO)};
}
export function labourDTO(r, messages = [], staff = false) {
  const result = pick(r,[...base,'referenceNumber','companyId','accountId','role','headcount','siteId','site','mode','start','end','days','dates',
    'startTime','endTime','equipment','tickets','licences','ppe','contactName','contactPhone','notes','phase','fills','workers','pendingChange','pendingCancel',
    ...(staff ? ['internalNotes','recruiterId','recruiterIds','recruiterNotifications'] : [])]);
  return {...result,_id:r.id,id:r.referenceNumber,messages:messages.map(m => ({id:m.id,by:m.senderType,name:m.senderName,text:m.text,at:m.createdAt}))};
}
export function jobDTO(j, profiles = [], staff = false) {
  const result = pick(j,[...base,'referenceNumber','companyId','accountId','title','description','start','end','location','workType','openings','licences','status',
    ...(staff ? ['internalNotes'] : [])]);
  return {...result,_id:j.id,id:j.referenceNumber,profiles:profiles.filter(p => staff || p.published).map(p => pick(p,[...base,'name','summary','resumeText','published','publishedAt']))};
}
export function eventDTO(e, read = false, userId) {
  return {...pick(e,[...base,'type','companyId','actorId','recordId','text','metadata']),at:e.createdAt,seenBy:read ? [userId] : []};
}
