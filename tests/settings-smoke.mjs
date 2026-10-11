import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const server=createServer(async(req,res)=>{
 try { const file=path.join(process.cwd(),decodeURIComponent(req.url.split('?')[0]));
 const data=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);
 }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true,timeout:20000});
function fixturePdf(){
 const stream='BT /F1 12 Tf 50 750 Td (Demo Applicant - demo@example.com - Engineer) Tj ET';
 const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objs.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objs[i]}\nendobj\n`;}
 const xref=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(pdf);
}
try{
 console.log('Settings browser launched');
 const page=await browser.newPage({viewport:{width:1100,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.messages=JSON.parse(localStorage.getItem('testMessages')||'[]');window.savedData=JSON.parse(localStorage.getItem('testData')||'{}');window.granted=[];
  const changeListeners=[];
  const persist=()=>localStorage.setItem('testData',JSON.stringify(window.savedData));
  window.addMissingSuggestion=data=>{window.savedData.pendingFields=data;persist();for(const fn of changeListeners)fn({pendingFields:{newValue:data}},'local');};
  window.chrome={storage:{onChanged:{addListener:fn=>changeListeners.push(fn)},local:{get:async()=>window.savedData,set:async data=>{window.savedData={...window.savedData,...data};persist();},remove:async keys=>{for(const key of keys)delete window.savedData[key];persist();}}},permissions:{request:async p=>{window.granted.push(p);return true;},getAll:async()=>({origins:[]})},runtime:{sendMessage:async m=>{
   window.messages.push(m);localStorage.setItem('testMessages',JSON.stringify(window.messages));
   if(m.type==='MODELS')return {ok:true,models:['model-A','exact Model ID']};
   if(m.type==='PARSE_RESUME')return {ok:true,profile:{basic:{fullName:'Demo Applicant',email:'demo@example.com'},skills:['Engineering']}};
  }}};
 });
 await page.goto(origin+'/options.html');await page.locator('#infoSummary').waitFor();
 console.log('Settings page loaded');
 await page.locator('#baseUrl').fill('http://example.com/v1');await page.locator('#apiKey').fill('test-key');
 await page.locator('#loadModels').click();await page.waitForFunction(()=>document.querySelector('#modelStatus').textContent.includes('2'));
 await page.locator('#model').selectOption('exact Model ID');
 await page.locator('#import').setInputFiles({name:'synthetic-resume.pdf',mimeType:'application/pdf',buffer:fixturePdf()});
 await page.locator('#parsePdf').waitFor({state:'visible'});
 assert.match(await page.locator('#pdfText').inputValue(),/Demo Applicant/);
 console.log('PDF text extracted');
 // Saving must work without AI recognition, with either the template or blank JSON.
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已保存'));
 assert.equal((await page.evaluate(()=>window.savedData)).profile,null);
 await page.locator('#pdfText').fill('Demo Applicant - edited PDF text - Engineer');
 await page.locator('#save').click();await page.waitForFunction(()=>window.savedData.profile===null);
 assert.equal((await page.evaluate(()=>window.savedData)).resumeSource.text,'Demo Applicant - edited PDF text - Engineer');
 await page.evaluate(()=>addMissingSuggestion([{id:'["","年龄",1]',label:'年龄',section:'',reason:'请在简历中补充年龄',value:''}]));
 const age=page.locator('#supplementFields textarea[aria-label="年龄"]');await age.fill('22');
 await page.evaluate(()=>addMissingSuggestion([{id:'["","年龄",1]',label:'年龄',section:'',reason:'请在简历中补充年龄',value:''},{id:'["","城市",1]',label:'城市',section:'',reason:'请补充城市',value:''}]));
 assert.equal(await age.inputValue(),'22');
 await page.locator('#supplementFields textarea[aria-label="城市"]').fill('上海');
 await page.locator('#submitSupplements').click();await page.waitForFunction(()=>window.savedData.supplements?.length===2);
 assert.match(await page.locator('#infoSummary').inputValue(),/年龄：22/);
 assert.match(await page.locator('#infoSummary').inputValue(),/城市：上海/);
 assert.match(await page.locator('#infoSummary').inputValue(),/edited PDF text/);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#infoSummary').value.includes('年龄：22'));
 assert.equal(await page.locator('#supplementFields textarea[aria-label="年龄"]').inputValue(),'22');
 await page.locator('#bulkSupplements').fill('到岗时间：下个月\n城市：上海');await page.locator('#addBulk').click();
 assert.equal(await page.locator('#supplementFields textarea[aria-label="到岗时间"]').inputValue(),'下个月');
 await page.locator('#submitSupplements').click();await page.waitForFunction(()=>window.savedData.supplements?.length===3);
 const pdfDownloadPromise=page.waitForEvent('download');await page.locator('#backup').click();
 const pdfBackup=await fs.readFile(await (await pdfDownloadPromise).path());
 assert.equal(JSON.parse(pdfBackup).profile,null);
 assert.equal(JSON.parse(pdfBackup).version,2);
 assert.equal(JSON.parse(pdfBackup).supplements.length,3);
 await page.locator('#backupFile').setInputFiles({name:'pdf-backup.json',mimeType:'application/json',buffer:pdfBackup});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('备份已恢复'));
 assert.equal(await page.locator('#supplementFields textarea[aria-label="到岗时间"]').inputValue(),'下个月');
 assert.match(await page.locator('#pdfText').inputValue(),/edited PDF text/);
 assert.equal((await page.evaluate(()=>window.messages)).length,1);
 console.log('PDF-only save, backup and restore passed');
 await page.locator('#pdfText').fill('Demo Applicant - demo@example.com - Engineer');
 await page.locator('#parsePdf').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('识别完成'));
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已保存'));
 const saved=await page.evaluate(()=>window.savedData);assert.equal(saved.config.baseUrl,'http://example.com/v1');assert.equal(saved.config.model,'exact Model ID');assert.equal(saved.profile.basic.fullName,'Demo Applicant');
 assert.match(saved.infoSummary,/到岗时间：下个月/);
 const messages=await page.evaluate(()=>window.messages);assert.equal(messages[0].type,'MODELS');assert.match(messages[1].text,/demo@example.com/);
 await page.locator('#manualModel').fill('custom-model');await page.locator('#save').click();await page.waitForFunction(()=>window.savedData.config.model==='custom-model');
 const persisted=await page.evaluate(()=>window.savedData);
 assert.match(persisted.resumeSource.data,/^data:application\/pdf;base64,/);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#apiKey').value==='test-key');
 assert.equal(await page.locator('#manualModel').inputValue(),'custom-model');
 assert.match(await page.locator('#pdfText').inputValue(),/Demo Applicant/);
 const downloadPromise=page.waitForEvent('download');await page.locator('#backup').click();const download=await downloadPromise;
 const backup=await fs.readFile(await download.path());assert.equal(JSON.parse(backup).config.apiKey,'test-key');
 await page.locator('#backupFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:backup});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('备份已恢复'));
 assert.match(await page.locator('#infoSummary').inputValue(),/Demo Applicant/);
 // Old v1 backups must keep legacy data readable without requiring JSON editing.
 const oldBackup=Buffer.from(JSON.stringify({version:1,config:persisted.config,profile:{basic:{fullName:'Legacy Applicant'}},resumeSource:null}));
 await page.locator('#backupFile').setInputFiles({name:'old-backup.json',mimeType:'application/json',buffer:oldBackup});
 await page.waitForFunction(()=>document.querySelector('#infoSummary').value.includes('Legacy Applicant'));
 assert.equal(await page.locator('#supplementFields textarea').count(),0);
 await page.locator('#backupFile').setInputFiles({name:'new-backup.json',mimeType:'application/json',buffer:backup});
 await page.waitForFunction(()=>document.querySelector('#infoSummary').value.includes('年龄：22'));
 assert.deepEqual(errors,[]);
 await fs.mkdir('dist',{recursive:true});await page.screenshot({path:'dist/settings-preview.png',fullPage:true});
 console.log('Settings browser checks passed: PDF extraction, live missing fields, preserving drafts, submitting answers, combined summary, persistence, v2 backup and v1 migration. API and Chrome permissions mocked.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
