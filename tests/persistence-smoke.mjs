import {createRequire} from 'node:module';
import {mkdtemp,cp} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const temp=await mkdtemp(path.join(os.tmpdir(),'resume-persistence-'));const profile=path.join(temp,'browser');
const seed={config:{baseUrl:'http://example.com/v1',apiKey:'synthetic-key',model:'test'},profile:{basic:{fullName:'Synthetic'}},resumeSource:{name:'synthetic.pdf',text:'Synthetic',data:'data:application/pdf;base64,JVBERi0='}};
let previousId;
for(const index of [1,2]){
 const root=path.join(temp,'extension-'+index);await cp('dist/unpacked',root,{recursive:true});
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
 try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];
 if(index===1){previousId=id;await worker.evaluate(data=>chrome.storage.local.set(data),seed);}
 else{assert.equal(id,previousId);const data=await worker.evaluate(()=>chrome.storage.local.get(['config','profile','resumeSource']));assert.deepEqual(data,seed);}
 }finally{await context.close();}
}
console.log('PASS: same extension ID and saved credentials/resume/PDF after browser restart and loading from different directory. Synthetic data only.');
