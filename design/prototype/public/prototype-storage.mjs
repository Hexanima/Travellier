export const travelStorageKey='travellier-design-participation-v1';
// Only travel data. Never serialize credentials, account fields or device photo URLs.
export function encodeTravelState(s){
 const trips=structuredClone(s.trips);for(const t of trips)for(const p of t.posts)p.photos=p.photos.filter(x=>!x.startsWith('blob:'));
 return JSON.stringify({version:1,trips,tripId:s.tripId,sequence:s.sequence,notifications:s.notifications});
}
export function restoreTravelState(seed,json){
 try{const data=JSON.parse(json);if(data.version!==1||!Array.isArray(data.trips)||!Array.isArray(data.notifications)||!Number.isInteger(data.sequence))return seed;
  if(!data.trips.every(t=>Array.isArray(t.activities)&&Array.isArray(t.posts)&&Array.isArray(t.members)&&Array.isArray(t.destinations)&&Array.isArray(t.transports)))return seed;
  return {...seed,...data,role:data.trips.find(t=>t.id===data.tripId)?.members.find(m=>m.id===seed.profile.id)?.role||'participant'};
 }catch{return seed;}
}
