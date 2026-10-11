const dateOf=value=>{const d=new Date(value);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
export function inputTime(value){
 const d=new Date(value),pad=n=>String(n).padStart(2,'0'),clock=pad(d.getHours())+':'+pad(d.getMinutes());
 return d.getSeconds()||d.getMilliseconds()?clock+':'+pad(d.getSeconds())+(d.getMilliseconds()?'.'+String(d.getMilliseconds()).padStart(3,'0'):''):clock;
}
export function savedInstant(date,time,previous){
 if(previous&&date===dateOf(previous)&&time===inputTime(previous))return previous;
 return new Date(date+'T'+time).toISOString();
}
export const hasHistoricalSteps=transport=>Boolean(transport?.details.steps?.some(step=>!step.estimatedAt&&step.estimatedTime));
export function urbanSteps(data,transport,departureAt,arrivalAt){
 if(hasHistoricalSteps(transport)&&!['on',true].includes(data.historyReviewed))throw Error('Revisá y confirmá las fechas y horas de los tramos históricos antes de guardar.');
 const steps=[];let previous=departureAt;
 for(let i=0;data['line'+i]!==undefined;i++){
  const old=transport?.details.steps?.[i],date=data['stepDate'+i],time=data['stepTime'+i];let at;
  try{
   if(date)at=savedInstant(date,time,old?.estimatedAt);
   else if(old?.estimatedAt&&time===inputTime(old.estimatedAt))at=old.estimatedAt;
   else{
    if(old?.estimatedTime&&!old.estimatedAt)throw Error();
    at=savedInstant(dateOf(previous),time);
    if(at<previous){const next=new Date(at);next.setDate(next.getDate()+1);at=next.toISOString();}
   }
  }catch{throw Error('Revisá la fecha y la hora de cada tramo.');}
  if(at<previous||at>arrivalAt)throw Error('Los tramos deben estar en orden cronológico y entre la salida y la llegada.');
  steps.push({line:data['line'+i],fromStop:data['fromStop'+i],toStop:data['toStop'+i],estimatedAt:at});previous=at;
 }
 return steps;
}
