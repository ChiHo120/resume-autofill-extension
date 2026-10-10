import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
 const page = await browser.newPage();
 await page.setContent(fs.readFileSync('demo-form.html','utf8'));
 await page.evaluate(()=>{
   Object.defineProperty(crypto,'randomUUID',{value:()=> 'test-scan-token'});
   window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}}}};
   window.dispatchExtension=m=>new Promise(resolve=>window.listener(m,{id:'test'},resolve));
 });
 await page.addScriptTag({content:fs.readFileSync('content.js','utf8')});
 const scan=await page.evaluate(()=>window.dispatchExtension({type:'SCAN'}));
 assert.equal(scan.ok,true);
 const name=scan.fields.find(f=>f.group==='fullName');
 const consent=scan.fields.find(f=>f.group==='consent');
 const request={type:'FILL',token:scan.token,url:scan.url,actions:[{fieldId:name.id,value:'测试用户'},{fieldId:consent.id,value:true}]};
 const result=await page.evaluate(m=>window.dispatchExtension(m),request);
 assert.equal(result.results[0].ok,true);assert.equal(result.results[1].ok,false);
 assert.equal(await page.locator('[name=fullName]').inputValue(),'测试用户');
 assert.equal(await page.locator('[name=consent]').isChecked(),false);
 const overwrite=await page.evaluate(m=>window.dispatchExtension(m),{...request,actions:[{fieldId:name.id,value:'其他姓名'}]});
 assert.equal(overwrite.results[0].ok,false);
 const stale=await page.evaluate(m=>window.dispatchExtension(m),{...request,token:'stale'});assert.equal(stale.ok,false);
 console.log('Browser DOM checks passed: fill, consent exclusion, preserve value, stale plan.');
}finally{await browser.close();}
