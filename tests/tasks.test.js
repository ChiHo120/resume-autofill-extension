import test from 'node:test';
import assert from 'node:assert/strict';
import {createTasks,taskKey} from '../shared/tasks.js';
function fixture(api) {
 const storage={},calls=[];
 const chrome={storage:{session:{get:async key=>key==null?structuredClone(storage):{[key]:structuredClone(storage[key])},set:async data=>Object.assign(storage,structuredClone(data)),remove:async key=>{delete storage[key];}}},
  tabs:{get:async id=>({id,url:'https://example.test/'+id,title:'Tab '+id}),sendMessage:async(id,m)=>{calls.push({id,m});if(m.type==='SCAN')return {ok:true,url:'https://example.test/'+id,token:'token-'+id,fields:[{id:'age',label:'年龄',kind:'text'}]};return {ok:true,results:[]};}},scripting:{executeScript:async()=>{}}};
 return {storage,calls,chrome,tasks:createTasks(chrome,api)};
}
async function done(tasks,id){for(let i=0;i<100;i++){await new Promise(setImmediate);const state=await tasks.read(id);if(!state.busy)return state;}throw new Error('Task did not settle');}
test('tab tasks remain isolated and release busy state after API failure',async()=>{
 const f=fixture(async()=>{throw new Error('API failure');});
 await f.tasks.start(1,{action:'SCAN'});await done(f.tasks,1);
 await f.tasks.start(2,{action:'SCAN'});await done(f.tasks,2);
 await f.tasks.start(1,{action:'ANALYZE'});
 assert.match((await done(f.tasks,1)).status,/API failure/);
 assert.equal((await f.tasks.read(2)).scan.tabId,2);
 assert.ok(f.calls.every(({id,m})=>m.type==='SCAN'||m.token==='token-'+id));
});
test('navigation during analysis cancels stale result; duplicate jobs are rejected',async()=>{
 let resolveApi;const gate=new Promise(resolve=>{resolveApi=resolve;});
 const f=fixture(()=>gate);await f.tasks.start(1,{action:'SCAN'});await done(f.tasks,1);
 await f.tasks.start(1,{action:'ANALYZE'});
 await assert.rejects(()=>f.tasks.start(1,{action:'SCAN'}),/仍在运行/);
 await f.tasks.invalidate(1,'navigation');
 const state=await done(f.tasks,1);assert.equal(state.invalid,true);assert.equal(state.analysis,null);assert.equal(state.status,'navigation');
 await f.tasks.start(1,{action:'SCAN'});assert.equal((await done(f.tasks,1)).invalid,false);
 resolveApi({plan:{actions:[],missing:[],questions:[]}});await new Promise(setImmediate);
 assert.match((await f.tasks.read(1)).status,/发现/);
});
test('worker restart recovers interrupted jobs without leaving controls locked',async()=>{
 const f=fixture(async()=>{});f.storage[taskKey(7)]={tabId:7,busy:true,scan:null,status:'running'};
 const state=await f.tasks.read(7);assert.equal(state.busy,false);assert.match(state.status,/中断/);
});
test('plan inspects every dropdown, displays actual choices, and filling refuses changed options',async()=>{
 const apiCalls=[];
 const f=fixture(async request=>{
  apiCalls.push(request);
  if(request.type==='SELECT_OPTION')return {selection:{optionId:request.options[0].id,reason:'resume fact'}};
  if(request.type==='SUGGEST_QUERY')return {query:'中南大学'};
  return {ok:true};
 });
 const fields=[{id:'school',label:'学校',kind:'custom-select'},{id:'degree',label:'学历',kind:'custom-select'},{id:'broken',label:'无法打开',kind:'custom-select'}];
 let changed=false;const messages=[];
 f.chrome.tabs.sendMessage=async(id,m)=>{
  messages.push(m);
  if(m.type==='SCAN')return {ok:true,url:'https://example.test/'+id,token:'token',fields};
  if(m.type==='OPEN_OPTIONS'){
   if(m.fieldId==='broken')return {ok:false,error:'无法确认弹层'};
   const options=m.fieldId==='school'?(m.query?[{id:'o9',label:'中南大学'}]:[]):[{id:'o2',label:changed?'博士':'本科'}];
   return {ok:true,sessionId:'session',options,searchable:m.fieldId==='school'};
  }
  if(m.type==='FILL')return {ok:true,results:[{fieldId:m.actions[0].fieldId,ok:true,value:'中南大学'}]};
  return {ok:true,results:[]};
 };
 await f.tasks.start(1,{action:'SCAN'});await done(f.tasks,1);
 await f.tasks.start(1,{action:'PLAN'});const planned=await done(f.tasks,1);
 assert.deepEqual(planned.plan.actions.map(a=>a.optionLabel),['中南大学','本科']);
 assert.equal(planned.plan.actions[0].searchQuery,'中南大学');
 assert.equal(planned.plan.missing[0].fieldId,'broken');
 assert.equal(messages.some(m=>m.type==='FILL'),false);
 assert.equal(apiCalls.filter(m=>m.type==='SELECT_OPTION').length,2);
 assert.equal(apiCalls.at(-1).type,'SYNC_MISSING');
 changed=true;await f.tasks.start(1,{action:'FILL',chosen:['school','degree'],overwrite:true});const filled=await done(f.tasks,1);
 assert.equal(filled.results[0].ok,true);assert.equal(filled.results[1].ok,false);
 assert.match(filled.results[1].error,/变化/);
 assert.equal(messages.filter(m=>m.type==='FILL').length,1);
});

test('one-click fill auto-generates a plan for pages without dropdowns',async()=>{
 const f=fixture(async request=>request.type==='PLAN'?{plan:{actions:[{fieldId:'age',value:'22',reason:'resume fact'}],missing:[],questions:[]}}:{ok:true});
 f.chrome.tabs.sendMessage=async(id,m)=>{f.calls.push({id,m});if(m.type==='SCAN')return {ok:true,url:'https://example.test/'+id,token:'token-'+id,fields:[{id:'age',label:'年龄',kind:'text'}]};if(m.type==='FILL')return {ok:true,results:[{fieldId:'age',ok:true,value:'22'}]};return {ok:true,results:[]};};
 await f.tasks.start(1,{action:'SCAN'});await done(f.tasks,1);
 await f.tasks.start(1,{action:'FILL'});const state=await done(f.tasks,1);
 assert.equal(state.plan.actions[0].value,'22');
 assert.equal(state.results[0].ok,true);
 assert.equal(f.calls.filter(({m})=>m.type==='FILL').length,1);
});
