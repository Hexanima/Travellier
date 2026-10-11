import {catalog} from './catalog.mjs';
export const views=catalog.map(x=>x.id);
export const createState = () => ({view:'trips',variant:'blue',filter:'active',day:12,participation:'going',liked:false,photo:0,selected:[],comments:[],collage:false,role:'admin',expenseMode:'register',transportType:'flight',links:[],commentLikes:[],draft:{},scenario:'default',steps:2});
export const voteCounts = state => ({up:2+Number(state.vote==='up'),down:1+Number(state.vote==='down')});
export function transition(state, action) {
  const s = {...state};
  if(action.type==='activity') {s.view='itinerary';s.day=12;}
  if(action.type==='view' && views.includes(action.value)) s.view=action.value;
  if(action.type==='filter' && ['active','finished'].includes(action.value)) s.filter=action.value;
  if(action.type==='variant' && action.value==='blue') s.variant='blue';
  if(action.type==='role'&&['admin','participant'].includes(action.value))s.role=action.value;
  if(action.type==='expenseMode'&&['register','balance'].includes(action.value))s.expenseMode=action.value;
  if(action.type==='transportType'&&['flight','bus_long','bus_local','car','other'].includes(action.value))s.transportType=action.value;
  if(action.type==='scenario'&&['default','empty','error','loading','denied','success'].includes(action.value))s.scenario=action.value;
  if(action.type==='comment-like'&&typeof action.value==='string')s.commentLikes=s.commentLikes.includes(action.value)?s.commentLikes.filter(x=>x!==action.value):[...s.commentLikes,action.value];
  if(action.type==='link'&&['activity','post','transport'].includes(action.value))s.links=s.links.includes(action.value)?s.links.filter(x=>x!==action.value):[...s.links,action.value];
  if(action.type==='draft'&&action.value&&typeof action.value==='object'){
    if(action.key)s.formDrafts={...state.formDrafts,[action.key]:{...state.formDrafts?.[action.key],...action.value}};
    else s.draft={...s.draft,...action.value};
  }
  if(action.type==='add-step')s.steps=Math.min(5,s.steps+1);
  if(action.type==='remove-step')s.steps=Math.max(1,s.steps-1);
  if(action.type==='day' && [12,13,14,15,16,17].includes(action.value)) s.day=action.value;
  if(action.type==='participation' && ['going','not_going'].includes(action.value)) s.participation=action.value;
  if(action.type==='like') s.liked=!s.liked;
  if(action.type==='photo') s.photo=(s.photo+1)%3;
  if(action.type==='select' && Number.isInteger(action.value) && action.value>=0 && action.value<6) s.selected=s.selected.includes(action.value)?s.selected.filter(id=>id!==action.value):s.selected.length<4?[...s.selected,action.value]:s.selected;
  if(action.type==='comment' && typeof action.value==='string' && action.value.trim()) s.comments=[...s.comments,action.value.trim().slice(0,280)];
  if(action.type==='collage') s.collage=!s.collage;
  return s;
}
export const formKey=(s,id)=>id==='transport-design'?id+':'+(s.destinationId||'roma')+':'+(s.transportDirection||'outbound'):id==='destination-design'?id+':'+(s.destinationId||'roma'):id==='activity-edit-design'?id+':'+(s.activityId||'paseo'):id;
export const getDraft=(s,id)=>s.formDrafts?.[formKey(s,id)]||{};
export function navigate(state,view,context){
  const s=transition(state,{type:'view',value:view});
  if(view==='mixed-day')s.destinationId='roma';
  if(view==='remove-member'&&['Martín','Juli'].includes(context))s.memberName=context;
  if(['vote','proposed','vote-disabled'].includes(view))s.activityId='museos';
  if(view==='participation')s.activityId=context||state.activityId||'paseo';
  if(view==='activity-edit'&&!['activity-edit','delete-activity'].includes(state.view)){
    s.activityId=context||state.activityId||'paseo';s.activityOrigin=state.view;
  }
  if(view==='destination-edit'&&state.view==='destinations'){s.destinationId=context||'roma';s.destinationOrigin=state.view;}
  if(['transport-edit','transport-detail'].includes(view)&&!['transport-edit','transport-detail','transport-impact','transport-history'].includes(state.view)){
    s.transportDirection=context||((state.view==='mixed-day')?'return':'outbound');s.transportOrigin=state.view;
    s.transportType=s.transportDirection==='return'?'other':'flight';
  }
  if(['compose','post-edit'].includes(view)&&!['compose','post-edit','post-links','photo-picker','photo-permission','spontaneous','expense-edit','upload'].includes(state.view)){
    s.postDrafts={...state.postDrafts,[state.postOrigin||'compose']:state.draft};s.postOrigin=view;s.draft=s.postDrafts[view]||{};
  }
  return s;
}
