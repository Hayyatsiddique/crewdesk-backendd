import { requireValue as check } from './errors.js';

export const ZONES = ['America/Toronto', 'America/Winnipeg', 'America/Edmonton', 'America/Vancouver', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
export const DEFAULT_SHIFTS = [
  {id:'days', name:'Days', startTime:'07:00', endTime:'15:30'},
  {id:'afternoons', name:'Afternoons', startTime:'15:00', endTime:'23:00'},
  {id:'nights', name:'Nights', startTime:'23:00', endTime:'07:00'}
];
export const emailKey = value => String(value || '').trim().toLowerCase();
export const nameKey = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]/gu, '');
export function phoneKey(value) {
  const raw = String(value || '').trim(), digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // Unprefixed ten-digit numbers are NANP numbers, as in the approved Canada UI.
  if (!raw.startsWith('+') && digits.length === 10) return '+1' + digits;
  if (!raw.startsWith('+') && digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  check(raw.startsWith('+') && /^[1-9]\d{7,14}$/.test(digits), 'Use a valid phone number with a country code, for example +14165550144.');
  return '+' + digits;
}
export function text(value, label, max, required = true) {
  check(typeof value === 'string', label + ' must be text.');
  const result = value.trim();
  check((!required || result.length > 0) && result.length <= max, label + ' must be ' + (required ? '1' : '0') + '-' + max + ' characters.');
  check(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result), label + ' contains invalid control characters.');
  return result;
}
export const optionalText = (v, label, max) => text(v ?? '', label, max, false);
export function email(value, required = false) {
  const e = emailKey(text(value ?? '', 'Email', 160, required));
  check(!e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), 'Enter a valid email address.'); return e;
}
export function phone(value, required = false) {
  const p = text(value ?? '', 'Phone', 30, required); if (!p) return '';
  check(/^\+?[\d\s().-]+$/.test(p), 'Enter a valid phone number.'); return phoneKey(p);
}
export function integer(value, label, min, max) {
  check(typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max, `${label} must be an integer from ${min} to ${max}.`); return value;
}
export function oneOf(value, list, label) { check(list.includes(value), 'Choose a valid ' + label + '.'); return value; }
export function unique(values) { return [...new Map(values.map(v => [v.toLowerCase(), v])).values()]; }
export function tags(value, label = 'Requirements') {
  if (value === undefined) return [];
  check(Array.isArray(value) && value.length <= 100, label + ' must contain at most 100 values.');
  return unique(value.map(v => text(v, label, 80)));
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T12:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export const plusDay = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
export function today(zone = 'America/Toronto', at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(at);
  const get = t => parts.find(p => p.type === t).value; return `${get('year')}-${get('month')}-${get('day')}`;
}
export const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function times(startTime, endTime) {
  check(validTime(startTime) && validTime(endTime) && startTime !== endTime, 'Enter different, valid start and finish times.');
  return {startTime, endTime}; // Intentionally retain local wall-clock times, including overnight shifts.
}
export function scheduleHas(r, date) {
  if (!validDate(date) || !validDate(r.start)) return false;
  if (r.mode === 'dates') return r.dates.includes(date);
  if (date < r.start || (r.end && date > r.end)) return false;
  if (r.mode === 'one') return date === r.start;
  return r.mode === 'range' || (r.mode === 'weekly' && r.days.includes(new Date(date + 'T12:00:00Z').getUTCDay()));
}
export function nextDates(r, count = 7, from = today(r.site?.zone)) {
  if (r.mode === 'dates') return r.dates.filter(d => d >= from).sort().slice(0, count);
  if (!validDate(r.start)) return [];
  const found = []; let d = r.start > from ? r.start : from;
  for (let i = 0; i < 400 && found.length < count; i++, d = plusDay(d, 1)) {
    if ((r.end && d > r.end) || (r.mode === 'one' && d > r.start)) break;
    if (scheduleHas(r, d)) found.push(d);
  }
  return found;
}
export function schedule(input, zone, at = new Date()) {
  const mode = oneOf(input.mode, ['one','range','weekly','dates'], 'schedule mode'), t = today(zone, at);
  let start = input.start, end = input.end || '', days = [], dates = [];
  if (mode === 'dates') {
    check(Array.isArray(input.dates) && input.dates.length > 0 && input.dates.length <= 100, 'Choose 1-100 individual shift dates.');
    check(input.dates.every(d => validDate(d) && d >= t), 'Remove past or invalid shift dates.');
    check(new Set(input.dates).size === input.dates.length, 'Shift dates must be unique.');
    dates = [...input.dates].sort(); start = dates[0]; end = dates.at(-1);
  } else {
    check(validDate(start) && start >= t, 'Choose a start date today or later in the worksite time zone.');
    if (mode === 'one') end = '';
    if (mode === 'range') check(validDate(end), 'Choose an end date.');
    if (end) check(validDate(end) && end >= start && daysBetween(start, end) <= 366, 'Use an end date within 366 days of the start.');
    if (mode === 'weekly') {
      check(Array.isArray(input.days) && input.days.length > 0 && input.days.length <= 7, 'Choose at least one weekday.');
      days = [...new Set(input.days.map(d => integer(d, 'Weekday', 0, 6)))].sort();
      check(nextDates({mode,start,end,days}, 1, start).length > 0, 'No selected weekdays fall in this date range.');
    }
  }
  return {mode, start, end, days, dates};
}
export function siteInput(b) {
  return {name:text(b.name,'Site name',100), address:text(b.address,'Address',300),
    zone:oneOf(b.zone,ZONES,'site time zone'), contactName:text(b.contactName,'On-site contact',100),
    contactPhone:phone(b.contactPhone,true), notes:optionalText(b.notes,'Site notes',2000), ppe:tags(b.ppe,'PPE')};
}
export function crewInput(b, site, at) {
  const role = text(b.role,'Position',100), equipment = optionalText(b.equipment,'Equipment',120);
  check(!/forklift/i.test(role) || equipment, 'Enter the forklift or equipment type.');
  return {role, headcount:integer(b.headcount,'Headcount',1,500), ...schedule(b,site.zone,at),
    ...times(b.startTime,b.endTime), equipment, tickets:tags(b.tickets), licences:tags(b.licences), ppe:tags(b.ppe),
    contactName:text(b.contactName,'On-site contact',100), contactPhone:phone(b.contactPhone,true), notes:optionalText(b.notes,'Notes',5000)};
}
export function jobInput(b, at) {
  check(validDate(b.start) && b.start >= today('America/Toronto',at) && validDate(b.end) && b.end >= b.start, 'Choose a valid hiring period starting today or later.');
  return {title:text(b.title,'Job title',120), description:text(b.description,'Job description',15000), start:b.start, end:b.end,
    location:text(b.location,'Location',200), workType:oneOf(b.workType,['Contract','Temp','Temp-to-perm','Permanent'],'work type'),
    openings:integer(b.openings,'Openings',1,500), licences:tags(b.licences)};
}
export function companyInput(b) {
  check(Array.isArray(b.defaultShifts) && b.defaultShifts.length >= 1 && b.defaultShifts.length <= 30, 'Keep 1-30 shift templates.');
  const shifts = b.defaultShifts.map(s => ({id:text(s.id,'Shift ID',80),name:text(s.name,'Shift name',100),...times(s.startTime,s.endTime)}));
  check(new Set(shifts.map(s => s.name.toLowerCase())).size === shifts.length, 'Give every shift template a different name.');
  check(new Set(shifts.map(s => s.id)).size === shifts.length, 'Shift IDs must be unique.');
  const billing = b.billingContact || {};
  return {name:text(b.name,'Company name',120),industry:optionalText(b.industry,'Industry',100),email:email(b.email),phone:phone(b.phone),
    billingContact:{name:optionalText(billing.name,'Billing contact',100),email:email(billing.email),phone:phone(billing.phone)},
    defaultShifts:shifts,tickets:tags(b.tickets),licences:tags(b.licences),ppe:tags(b.ppe),notes:optionalText(b.notes,'Internal company notes',5000)};
}
export function pageInput(q = {}) {
  const parse = (v, fallback) => v === undefined || v === '' ? fallback : Number(v);
  return {page:integer(parse(q.page,1),'Page',1,100000),limit:integer(parse(q.limit,25),'Page size',1,100),search:optionalText(q.search,'Search',100)};
}
export const regexEscape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
