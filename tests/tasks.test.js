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
test('plan ignores dropdowns and only fills manually-enterable text fields',async()=>{
 const apiCalls=[];
 const f=fixture(async request=>{
  apiCalls.push(request);
  if(request.type==='PLAN')return {plan:{actions:[{fieldId:'name',value:'Sun',reason:'resume fact'}],missing:[],questions:[]}};
  return {ok:true,plan:{actions:[],missing:[],questions:[]}};
 });
 const fields=[{id:'name',label:'姓名',kind:'text'},{id:'school',label:'学校',kind:'custom-select'},{id:'degree',label:'学历',kind:'select'}];
 const messages=[];
 f.chrome.tabs.sendMessage=async(id,m)=>{
  messages.push(m);
  if(m.type==='SCAN')return {ok:true,url:'https://example.test/'+id,token:'token',fields};
  if(m.type==='FILL')return {ok:true,results:[{fieldId:m.actions[0].fieldId,ok:true,value:'Sun'}]};
  return {ok:true,results:[]};
 };
 await f.tasks.start(1,{action:'SCAN'});await done(f.tasks,1);
 await f.tasks.start(1,{action:'PLAN'});const planned=await done(f.tasks,1);
 assert.deepEqual(planned.plan.actions.map(a=>a.fieldId),['name']);
 assert.match(planned.status,/跳过 2 个下拉框/);
 assert.equal(messages.some(m=>m.type==='FILL'),false);
 assert.equal(apiCalls.some(m=>['SELECT_OPTION','SUGGEST_QUERY'].includes(m.type)),false);
 await f.tasks.start(1,{action:'FILL',chosen:['name'],overwrite:true});const filled=await done(f.tasks,1);
 assert.equal(filled.results[0].ok,true);
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

test('unrecognized questions never reach AI or supplements; one-field retry preserves other results',async()=>{
 const apiCalls=[];
 const f=fixture(async request=>{
  apiCalls.push(request);
  if(request.type==='PLAN')return {plan:{actions:request.fields.map(field=>({fieldId:field.id,value:field.id==='name'?'Sun':'22',reason:'resume fact'})),missing:[],questions:[]}};
  return {plan:{actions:[],missing:[],questions:[]}};
 });
 const fields=[{id:'name',label:'姓名',kind:'text',recognition:{status:'recognized'}},{id:'unknown',label:'未识别字段',kind:'text',recognition:{status:'unrecognized'}},{id:'age',label:'年龄',kind:'text',recognition:{status:'recognized'}}];
 let attempts=0;
 f.chrome.tabs.sendMessage=async(id,m)=>{
  f.calls.push({id,m});
  if(m.type==='SCAN')return {ok:true,url:'https://example.test/'+id,token:'token-'+id,fields};
  if(m.type==='FILL')return {ok:true,results:[m.actions[0].fieldId==='age'&&++attempts===1?{fieldId:'age',ok:false,error:'页面未保存'}:{fieldId:m.actions[0].fieldId,ok:true,value:m.actions[0].value}]};
  if(m.type==='VERIFY')return {ok:true,results:m.fieldIds.map(fieldId=>({fieldId,ok:true}))};
  return {ok:true,results:[]};
 };
 await f.tasks.start(1,{action:'SCAN'});const scanned=await done(f.tasks,1);
 assert.match(scanned.status,/1 项字段未识别/);
 await f.tasks.start(1,{action:'ANALYZE'});await done(f.tasks,1);
 assert.deepEqual(apiCalls[0].fields.map(field=>field.id),['name','age']);
 await f.tasks.start(1,{action:'PLAN'});await done(f.tasks,1);
 await f.tasks.start(1,{action:'FILL',chosen:['name','age'],overwrite:true});const first=await done(f.tasks,1);
 assert.equal(first.results.find(r=>r.fieldId==='name').ok,true);
 assert.equal(first.results.find(r=>r.fieldId==='age').ok,false);
 await assert.rejects(()=>f.tasks.start(1,{action:'PLAN_ONE',fieldId:'unknown'}),/未识别/);
 await f.tasks.start(1,{action:'PLAN_ONE',fieldId:'age'});const replanned=await done(f.tasks,1);
 assert.equal(replanned.plan.actions.length,2);
 assert.equal(replanned.results.find(r=>r.fieldId==='name').ok,true);
 await f.tasks.start(1,{action:'FILL_ONE',fieldId:'age',overwrite:true});const retried=await done(f.tasks,1);
 assert.equal(retried.results.find(r=>r.fieldId==='age').ok,true);
 assert.equal(retried.results.find(r=>r.fieldId==='name').ok,true);
 assert.equal(f.calls.filter(({m})=>m.type==='FILL'&&m.actions[0].fieldId==='name').length,1);
});
