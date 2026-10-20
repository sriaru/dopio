export type Plan = {
  artist_id: string | null;
  artist_name: string;
  genre: string;
  title: string;
  format: string;
  date: string;
  tasks: { title: string; due_date: string }[];
  question: string;
};
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '2199-12-31' &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function validatePlan(value: unknown, ready = false): Plan {
  if (!value || typeof value !== 'object') throw new Error('Invalid plan');
  const p = value as Plan;
  for (const key of ['artist_name','genre','title','format','date','question'] as const)
    if (typeof p[key] !== 'string' || p[key].length > (key === 'question' ? 1000 : key === 'title' ? 150 : 100)) throw new Error('Invalid plan details');
  if (p.artist_id !== null && (typeof p.artist_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.artist_id))) throw new Error('Invalid artist');
  if (!Array.isArray(p.tasks) || p.tasks.length > 20 || p.tasks.some(t => !t || typeof t.title !== 'string' || !t.title.trim() || t.title.length > 150 || typeof t.due_date !== 'string' || !validDate(t.due_date))) throw new Error('Invalid tasks');
  if (ready || !p.question) {
    if (!p.artist_name.trim() || !p.title.trim() || !['Single','EP','Album'].includes(p.format) || !validDate(p.date) || !p.tasks.length || p.tasks.some(t => t.due_date > p.date)) throw new Error('Complete the artist, release, format, date and tasks before approving.');
  }
  return p;
}
export const planSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    artist_id: {type: ['string','null']},
    ...Object.fromEntries(['artist_name','genre','title','format','date','question'].map(k => [k,{type:'string'}])),
    format: {type:'string',enum:['','Single','EP','Album']},
    date: {type:'string',description:'Release date as YYYY-MM-DD, for example 2026-11-05. Empty string only when unknown.'},
    tasks: {type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},due_date:{type:'string',description:'Task deadline as YYYY-MM-DD, on or before the release date.'}},required:['title','due_date']}},
  },
  required: ['artist_id','artist_name','genre','title','format','date','question','tasks'],
};
