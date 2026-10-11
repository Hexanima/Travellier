// Money is handled in integer minor units; no exchange-rate conversions.
const cents=value=>{const n=Number(value);return Math.round((n+Number.EPSILON*Math.max(1,Math.abs(n)))*100);};
const conserveTotal=(rows,total)=>{
 const declared=rows.reduce((sum,row)=>sum+(row.unit==='percent'?total*cents(row.value):row.cents*10000),0);
 if(declared!==total*10000)return;
 let delta=total-rows.reduce((sum,row)=>sum+row.cents,0);
 for(const row of rows.slice().reverse().filter(row=>row.unit==='percent'&&Number(row.value)>0)){
  const change=delta<0?Math.max(delta,-row.cents):delta;row.cents+=change;delta-=change;if(!delta)break;
 }
};
export const moneyLabel=(value,currency='')=>(currency?currency+' ':'')+Number(value).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
export const expensePayments=expense=>expense.payments|| (expense.paidBy?[{memberId:expense.paidBy,unit:'percent',value:100}]:[]);
export function expenseSummary(expense){
 const total=cents(expense.totalAmount),out={error:null,payments:[],shares:[],remaining:0,unallocated:0,complete:false};
 const fail=error=>({...out,error});
 if(!Number.isSafeInteger(total)||total<0)return fail('Revisá el monto total del gasto.');
 if(expense.currency&&!['ARS','EUR','USD'].includes(expense.currency))return fail('Elegí una moneda: ARS, EUR o USD.');
 const amount=(row,kind)=>{
  const value=Number(row.value);
  if(!row.memberId||!['amount','percent'].includes(row.unit)||!Number.isFinite(value)||value<0||row.unit==='percent'&&value>100)throw new Error('Revisá el '+kind+': elegí una persona y un monto o porcentaje válido.');
  return row.unit==='percent'?Math.round(total*value/100):cents(value);
 };
 try{
  out.payments=expensePayments(expense).map(row=>({...row,cents:amount(row,'pago')}));
  conserveTotal(out.payments,total);
  const paid=out.payments.reduce((sum,row)=>sum+row.cents,0);
  if(paid>total)return fail('Los pagos superan el monto total del gasto.');
  out.remaining=(total-paid)/100;
  const seen=new Set();
  out.shares=(expense.shares||[]).map(row=>{
   if(!row.memberId||seen.has(row.memberId))throw new Error('Revisá el reparto: cada persona debe aparecer una sola vez.');seen.add(row.memberId);
   return {...row,cents:['remainder','excluded'].includes(row.unit)?0:amount(row,'reparto')};
  });
  conserveTotal(out.shares,total);
  const assigned=out.shares.reduce((sum,row)=>sum+row.cents,0),rest=total-assigned,remainder=out.shares.filter(row=>row.unit==='remainder');
  if(rest<0)return fail('El reparto supera el monto total del gasto.');
  if(remainder.length)remainder.forEach((row,index)=>row.cents=Math.floor(rest/remainder.length)+(index<rest%remainder.length?1:0));
  else out.unallocated=rest/100;
  out.payments.forEach(row=>row.amount=row.cents/100);out.shares.forEach(row=>row.amount=row.cents/100);
  out.complete=out.remaining===0&&out.unallocated===0&&out.shares.length>0;
  return out;
 }catch(error){return fail(error.message);}
}
export function tripBalance(trip){
 const groups=new Map();
 for(const post of trip.posts.filter(p=>p.expense)){
  const expense=post.expense,currency=expense.currency||'',summary=expenseSummary(expense);
  if(!groups.has(currency))groups.set(currency,{currency,total:0,pending:[],transfers:[],balances:new Map()});
  const group=groups.get(currency);group.total+=cents(expense.totalAmount);
  if(summary.error||!summary.complete||!currency){group.pending.push({post,summary});continue;}
  for(const row of summary.payments)group.balances.set(row.memberId,(group.balances.get(row.memberId)||0)+row.cents);
  for(const row of summary.shares)group.balances.set(row.memberId,(group.balances.get(row.memberId)||0)-row.cents);
 }
 return [...groups.values()].map(group=>{
  const creditors=[...group.balances].filter(([,n])=>n>0).map(([id,n])=>({id,n})),debtors=[...group.balances].filter(([,n])=>n<0).map(([id,n])=>({id,n:-n}));
  for(const debtor of debtors)for(const creditor of creditors){const n=Math.min(debtor.n,creditor.n);if(n>0){group.transfers.push({from:debtor.id,to:creditor.id,amount:n/100});debtor.n-=n;creditor.n-=n;}}
  return {...group,total:group.total/100,balances:[...group.balances].map(([memberId,n])=>({memberId,amount:n/100}))};
 });
}
export function expenseFormData(data){
 const payments=[];for(let i=0;data['paymentMember'+i]!==undefined;i++)payments.push({memberId:data['paymentMember'+i],unit:data['paymentUnit'+i],value:data['paymentValue'+i]});
 const shares=[];for(let i=0;data['shareMember'+i]!==undefined;i++)shares.push({memberId:data['shareMember'+i],unit:data['shareUnit'+i],value:data['shareValue'+i]});
 return {...data,...(data.paymentRows!==undefined||data.paymentMember0!==undefined?{payments}:{}),...(data.shareMember0!==undefined?{shares}:{})};
}
