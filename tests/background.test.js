import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let stored={config:{baseUrl:'https://example.com/v1',apiKey:'test',model:'test-model'},profile:null,resumeSource:{name:'resume.pdf',text:'Demo Applicant - Engineer'}};
const requests=[];
globalThis.chrome={
  sidePanel:{setPanelBehavior:async()=>{}},
  storage:{local:{setAccessLevel:async()=>{},get:async()=>stored,set:async data=>{stored={...stored,...data};}}},
  permissions:{contains:async()=>true},
  runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage:{addListener:fn=>{listener=fn;}}}
};
globalThis.fetch=async(url,options)=>{
  requests.push(JSON.parse(options.body));
  const data=JSON.parse(requests.at(-1).messages[1].content);
  const response=data.options?{optionId:'engineer',reason:'Resume says Engineer'}:
    {actions:data.fields.filter(f=>f.id==='name').map(f=>({fieldId:f.id,value:'Demo Applicant'})),missing:data.fields.filter(f=>f.id!=='name').map(f=>({fieldId:f.id,reason:'请补充年龄'})),questions:[]};
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(response)}}]})};
};
await import('../background.js');
const send=message=>new Promise(resolve=>listener(message,{id:'test-extension',url:chrome.runtime.getURL('panel.html')},resolve));

test('PDF-only resume supplies facts to form planning and select options',async()=>{
  const plan=await send({type:'PLAN',fields:[{id:'name',kind:'text'}]});
  assert.equal(plan.ok,true);
  assert.equal(plan.plan.actions[0].value,'Demo Applicant');
  assert.equal(JSON.parse(requests[0].messages[1].content).resume.pdfText,'Demo Applicant - Engineer');
  assert.equal(JSON.parse(requests[0].messages[1].content).resume.profile,null);

  const selection=await send({type:'SELECT_OPTION',field:{id:'job',kind:'select'},options:[{id:'engineer',label:'Engineer'}]});
  assert.equal(selection.ok,true);
  assert.equal(selection.selection.optionId,'engineer');
  assert.equal(JSON.parse(requests[1].messages[1].content).resume.pdfText,'Demo Applicant - Engineer');

  stored={...stored,resumeSource:null};
  const missing=await send({type:'PLAN',fields:[{id:'name',kind:'text'}]});
  assert.equal(missing.ok,false);
  assert.match(missing.error,/fullName/);
  assert.equal(requests.length,2);

  stored={...stored,resumeSource:{name:'resume.pdf',text:'Demo Applicant'},supplements:[{id:'answer',label:'年龄',value:'22'}]};
  const analyzed=await send({type:'PLAN',fields:[{id:'age',label:'年龄',kind:'text'},{id:'terms',label:'同意',kind:'checkbox',protected:true}]});
  assert.equal(analyzed.ok,true);
  assert.equal(stored.pendingFields.length,1);assert.equal(stored.pendingFields[0].label,'年龄');
  assert.equal(stored.supplements[0].value,'22');
  assert.equal(JSON.parse(requests.at(-1).messages[1].content).resume.supplements[0].value,'22');
  assert.match(requests.at(-1).messages[0].content,/take priority/);
  await send({type:'PLAN',fields:[{id:'new-age',label:'年龄',kind:'text'}]});
  assert.equal(stored.pendingFields.length,1);
  await send({type:'SELECT_OPTION',field:{id:'job',kind:'select'},options:[{id:'engineer',label:'Engineer'}]});
  assert.equal(JSON.parse(requests.at(-1).messages[1].content).resume.supplements[0].value,'22');
});
