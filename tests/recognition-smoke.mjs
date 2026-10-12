import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true,timeout:20000});
try{
 const page=await browser.newPage();
 await page.setContent(`<section><div class="row"><label for="school">学校</label><input id="school"><input id="mystery" placeholder="请输入"></div><div><span>年龄</span><input id="age" placeholder="请输入"></div><div id="host"></div><label>学历<select id="degree"><option value="">请选择</option><option>本科</option></select></label></section>`);
 await page.evaluate(()=>{
  if(!crypto.randomUUID)crypto.randomUUID=()=>String(Math.random());
  const root=document.querySelector('#host').attachShadow({mode:'open'});
  root.innerHTML='<label for="nickname">昵称</label><input id="nickname">';
  window.chrome={runtime:{id:'test',onMessage:{addListener:fn=>{window.listener=fn}}}};
  window.send=m=>new Promise(resolve=>window.listener(m,{id:'test'},resolve));
 });
 for(const file of ['adapters/registry.js','adapters/generic.js','content.js'])await page.addScriptTag({content:await readFile(file,'utf8')});
 const scanned=await page.evaluate(()=>send({type:'SCAN'}));
 assert.equal(scanned.ok,true,scanned.error);
 const fields=scanned.fields;
 assert.equal(fields.find(f=>f.element.placeholder==='请输入'&&f.element.tag==='input'&&f.recognition.status==='unrecognized')?.label,'未识别字段');
 assert.equal(fields.find(f=>f.label==='年龄')?.recognition.status,'recognized');
 assert.equal(fields.find(f=>f.label==='昵称')?.recognition.status,'recognized');
 assert.equal(fields.find(f=>f.kind==='select')?.ignoredReason,'下拉框暂不自动填写，请手动选择');
 console.log('PASS: adjacent ambiguous field stays unrecognized, own context and open shadow-root label recognized.');
}finally{await browser.close();}
