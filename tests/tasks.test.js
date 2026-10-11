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
