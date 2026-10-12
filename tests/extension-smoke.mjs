import {createRequire} from 'node:module';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=process.cwd();
const profile=await mkdtemp(path.join(os.tmpdir(),'resume-extension-test-'));
const context=await chromium.launchPersistentContext(profile,{channel:process.env.PLAYWRIGHT_CHANNEL||'chromium',headless:true,timeout:20000,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
 const id=worker.url().split('/')[2];const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 assert.deepEqual(manifest.host_permissions,['https://*/*','http://*/*']);
 const recruitment=await context.newPage();
 await recruitment.route('https://recruitment.example.test/**',route=>route.fulfill({contentType:'text/html',body:'<label>Name<input name="fullName"></label>'}));
 await recruitment.goto('https://recruitment.example.test/apply');
 const scanned=await worker.evaluate(async()=>{
  const tabs=await chrome.tabs.query({url:'https://recruitment.example.test/*'});
  await chrome.scripting.executeScript({target:{tabId:tabs[0].id},files:['adapters/registry.js','adapters/generic.js','content.js']});
  return await chrome.tabs.sendMessage(tabs[0].id,{type:'SCAN'});
 });
 assert.equal(scanned.ok,true);assert.equal(scanned.fields[0].label,'Name');
 await recruitment.close();
 await page.goto(`chrome-extension://${id}/options.html`);
 await page.waitForFunction(()=>!!document.querySelector('#infoSummary'));
 const invalid=await page.evaluate(()=>chrome.runtime.sendMessage({type:'MODELS',config:{baseUrl:'http://example.com/v1',apiKey:''}}));
 assert.equal(invalid.ok,false);assert.match(invalid.error,/Key/);
 await worker.evaluate(()=>{
  chrome.permissions.contains=async()=>true;
  globalThis.fetch=async(url,options)=>({ok:true,json:async()=>url.endsWith('/models')?{data:[{id:'test-model'}]}:{choices:[{message:{content:'{"basic":{"fullName":"Demo"},"skills":[]}'}}]}});
 });
 const models=await page.evaluate(()=>chrome.runtime.sendMessage({type:'MODELS',config:{baseUrl:'http://example.com/v1',apiKey:'test-only'}}));
 assert.deepEqual(models.models,['test-model']);
 const parsed=await page.evaluate(()=>chrome.runtime.sendMessage({type:'PARSE_RESUME',config:{baseUrl:'http://example.com/v1',apiKey:'test-only',model:'test-model'},text:'Demo'}));
 assert.equal(parsed.profile.basic.fullName,'Demo');
 const result=await page.evaluate(async()=>{
  const {extractPdfText}=await import('./shared/pdf.js');
  const stream='BT /F1 12 Tf 50 750 Td (Extension PDF Worker Test) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return await extractPdfText(new File([pdf],'test.pdf',{type:'application/pdf'}));
 });
 assert.match(result.text,/Extension PDF Worker Test/);assert.deepEqual(errors,[]);
 console.log('Real extension loaded; message routing, model list and PDF parsing responses (mock API), PDF Worker and font resources passed under extension CSP.');
}finally{await context.close();}
