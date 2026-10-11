export function durationFrom(data){
 if(data.durationHours!==undefined||data.durationMinutesPart!==undefined){
  if(!String(data.durationHours??'').trim()&&!String(data.durationMinutesPart??'').trim())return null;
  const hours=Number(data.durationHours||0),minutes=Number(data.durationMinutesPart||0);
  return Number.isInteger(hours)&&hours>=0&&Number.isInteger(minutes)&&minutes>=0&&minutes<60&&hours*60+minutes>0?hours*60+minutes:NaN;
 }
 return data.durationMinutes==null||data.durationMinutes===''?null:Number(data.durationMinutes);
}
export const activityEnd=a=>a.durationMinutes>0?new Date(Date.parse(a.scheduledAt)+a.durationMinutes*60000).toISOString():null;
export function activityTimeLabel(activity,includeDate=false){
 const start=new Date(activity.scheduledAt),endAt=activityEnd(activity),end=endAt?new Date(endAt):null;
 const differentYear=Boolean(end&&start.getFullYear()!==end.getFullYear());
 const date=value=>value.toLocaleDateString('es-AR',{day:'numeric',month:'short',...(differentYear?{year:'numeric'}:{})});
 const time=value=>value.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false});
 const first=(includeDate||differentYear?date(start)+' · ':'')+time(start);
 if(!end)return first;
 const hours=Math.floor(activity.durationMinutes/60),minutes=activity.durationMinutes%60;
 const duration=[hours?hours+' h':'',minutes?minutes+' min':''].filter(Boolean).join(' ');
 return first+' – '+(start.toDateString()!==end.toDateString()?date(end)+' · ':'')+time(end)+' · '+duration;
}
export function activitiesOverlap(a,b){
 if(a.scheduledAt===b.scheduledAt)return true;
 const endA=activityEnd(a),endB=activityEnd(b);
 return Boolean(endA&&endB&&a.scheduledAt<endB&&b.scheduledAt<endA);
}
export const participationConflicts=(trip,activity,userId='nico')=>trip.activities.filter(a=>a.id!==activity.id&&a.participations[userId]==='going'&&activitiesOverlap(a,activity));
export const conflictSnapshot=activities=>activities.map(a=>({id:a.id,title:a.title,scheduledAt:a.scheduledAt,durationMinutes:a.durationMinutes??null}));
export const confirmationMatches=(accepted,actual)=>JSON.stringify(accepted)===JSON.stringify(actual);
