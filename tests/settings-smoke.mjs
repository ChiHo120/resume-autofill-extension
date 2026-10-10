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
const browser=await chromium.launch({channel:'msedge',headless:true});
function fixturePdf(){
 const stream='BT /F1 12 Tf 50 750 Td (Demo Applicant - demo@example.com - Engineer) Tj ET';
 const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objs.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objs[i]}\nendobj\n`;}
 const xref=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(pdf);
}
try{
 const page=await browser.newPage({viewport:{width:1100,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.messages=[];window.savedData={};window.granted=[];
  window.chrome={storage:{local:{get:async()=>({}),set:async data=>{window.savedData=data;},remove:async()=>{}}},permissions:{request:async p=>{window.granted.push(p);return true;},getAll:async()=>({origins:[]})},runtime:{sendMessage:async m=>{
   window.messages.push(m);
   if(m.type==='MODELS')return {ok:true,models:['model-A','exact Model ID']};
   if(m.type==='PARSE_RESUME')return {ok:true,profile:{basic:{fullName:'Demo Applicant',email:'demo@example.com'},skills:['Engineering']}};
  }}};
 });
 await page.goto(origin+'/options.html');await page.locator('#profile').waitFor();
 await page.locator('#baseUrl').fill('http://example.com/v1');await page.locator('#apiKey').fill('test-key');
 await page.locator('#loadModels').click();await page.waitForFunction(()=>document.querySelector('#modelStatus').textContent.includes('2'));
 await page.locator('#model').selectOption('exact Model ID');
 await page.locator('#import').setInputFiles({name:'synthetic-resume.pdf',mimeType:'application/pdf',buffer:fixturePdf()});
 await page.locator('#parsePdf').waitFor({state:'visible'});
 assert.match(await page.locator('#pdfText').inputValue(),/Demo Applicant/);
 await page.locator('#parsePdf').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('识别完成'));
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已保存'));
 const saved=await page.evaluate(()=>window.savedData);assert.equal(saved.config.baseUrl,'http://example.com/v1');assert.equal(saved.config.model,'exact Model ID');assert.equal(saved.profile.basic.fullName,'Demo Applicant');
 const messages=await page.evaluate(()=>window.messages);assert.equal(messages[0].type,'MODELS');assert.match(messages[1].text,/demo@example.com/);
 await page.locator('#manualModel').fill('custom-model');await page.locator('#save').click();await page.waitForFunction(()=>window.savedData.config.model==='custom-model');
 assert.deepEqual(errors,[]);
 await fs.mkdir('dist',{recursive:true});await page.screenshot({path:'dist/settings-preview.png',fullPage:true});
 console.log('Settings browser checks passed: HTTP config, models, real PDF worker text extraction, AI import, save, manual model. API and Chrome permissions mocked.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
