const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
const shortDate=value=>{
  if(!validDate(value))return '';
  const [year,month,day]=String(value).split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,month-1,day)));
};
const timeParts=value=>{
  const match=/^(\d{2}):(\d{2})$/.exec(String(value||''));
  if(!match)return null;
  const hours=Number(match[1]),minutes=Number(match[2]);
  return hours<24&&minutes<60?{hours,minutes}:null;
};
const clock=value=>{
  const parts=timeParts(value);
  if(!parts)return String(value||'Not set');
  const suffix=parts.hours<12?'AM':'PM',hours=parts.hours%12||12;
  return `${hours}:${String(parts.minutes).padStart(2,'0')} ${suffix}`;
};
const duration=(start,end)=>{
  const a=timeParts(start),b=timeParts(end);
  if(!a||!b)return '';
  const minutes=((b.hours*60+b.minutes)-(a.hours*60+a.minutes)+1440)%1440;
  if(!minutes)return '';
  const hours=Math.floor(minutes/60),remainder=minutes%60;
  return `${hours?`${hours}h`:''}${hours&&remainder?' ':''}${remainder?`${remainder}m`:''}`;
};
const schedule=record=>{
  const start=shortDate(record.start),end=shortDate(record.end);
  if(record.mode==='weekly'){
    const days=(record.days||[]).map(Number).filter(day=>Number.isInteger(day)&&day>=0&&day<=6).sort((a,b)=>a-b).map(day=>WEEKDAYS[day]);
    return `${days.join(', ')||'Weekly'} | ${start||'Start date not set'} - ${end||'ongoing'}`;
  }
  if(record.mode==='dates'){
    const dates=(record.dates||[]).map(shortDate).filter(Boolean);
    return dates.join(', ')||start||'Dates not set';
  }
  if(record.mode==='range')return `${start||'Start date not set'} - ${end||'ongoing'}`;
  return start||'Date not set';
};

/** Client-facing schedule detail shared by email, SMS, WhatsApp and push copy. */
export function labourNotificationTiming(record){
  const hours=`${clock(record.startTime)} - ${clock(record.endTime)}`;
  const shiftDuration=duration(record.startTime,record.endTime);
  const zone=record.site?.zone||'America/Toronto';
  return `Schedule: ${schedule(record)}\n\nShift: ${hours}\n${zone}${shiftDuration?` · ${shiftDuration} before breaks`:''}`;
}
