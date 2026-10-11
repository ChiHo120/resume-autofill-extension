import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let stored={config:{baseUrl:'https://example.com/v1',apiKey:'test',model:'test-model'},profile:null,resumeSource:{name:'resume.pdf',text:'Demo Applicant - Engineer'}};
const requests=[];
globalThis.chrome={
  sidePanel:{setPanelBehavior:async()=>{}},
  storage:{local:{setAccessLevel:async()=>{},get:async()=>stored}},
  permissions:{contains:async()=>true},
  runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage:{addListener:fn=>{listener=fn;}}}
};
globalThis.fetch=async(url,options)=>{
  requests.push(JSON.parse(options.body));
  const response=requests.length===1
    ? {actions:[{fieldId:'name',value:'Demo Applicant'}],missing:[],questions:[]}
    : {optionId:'engineer',reason:'Resume says Engineer'};
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
});
