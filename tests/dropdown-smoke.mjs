import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true,timeout:20000});
try{
 const page=await browser.newPage();
 await page.setContent(`<section><h2>教育背景</h2>
 <div class="row"><div class="cell"><div class="caption">* 学校</div><div class="ivu-select"><input placeholder="请输入学校" aria-controls="schools" role="combobox"></div></div>
 <div class="cell"><div class="caption">* 学院名称</div><div><input id="college" placeholder="请输入"></div></div></div>
 <div class="row"><div class="cell"><div class="caption">* 学历</div><div class="ivu-select" id="degree"><span class="ivu-select-selected-value"></span></div></div>
 <div class="cell"><div class="caption">* 绩点</div><div><input id="gpa" placeholder="请输入"></div></div></div>
 <label>原生<select id="native"><option value="">请选择</option><option value="b">本科</option><option value="m" disabled>硕士</option></select></label>
 <div role="listbox" id="unrelated"><div role="option">不可使用的导航</div></div>
 </section>`);
 await page.evaluate(()=>{
  let sequence=0;Object.defineProperty(crypto,'randomUUID',{value:()=> 'test-'+(++sequence)});
  window.chrome={runtime:{id:'test',onMessage:{addListener:fn=>{window.listener=fn;}}}};
  window.send=m=>new Promise(resolve=>window.listener(m,{id:'test'},resolve));
  const search=document.querySelector('input[role=combobox]');
  search.onclick=()=>{search.setAttribute('aria-expanded','true');if(!document.querySelector('#schools')){const popup=document.createElement('div');popup.id='schools';popup.role='listbox';document.body.append(popup);}};
  search.oninput=()=>{setTimeout(()=>{const popup=document.querySelector('#schools');if(!popup)return;popup.replaceChildren();if(search.value==='中南大学'){const o=document.createElement('div');o.role='option';o.textContent='中南大学';o.onclick=()=>{search.value=o.textContent;popup.remove();search.setAttribute('aria-expanded','false');};popup.append(o);}},150);};
  search.onkeydown=e=>{if(e.key==='Escape'){document.querySelector('#schools')?.remove();search.setAttribute('aria-expanded','false');}};
  const degree=document.querySelector('#degree');degree.onclick=()=>{if(document.querySelector('#degrees'))return;const popup=document.createElement('div');popup.id='degrees';popup.className='ivu-select-dropdown';for(const label of ['本科','硕士']){const o=document.createElement('div');o.className='ivu-select-item';o.textContent=label;o.onclick=()=>{degree.querySelector('span').textContent=label;popup.remove();};popup.append(o);}document.body.append(popup);};
  degree.onkeydown=e=>{if(e.key==='Escape')document.querySelector('#degrees')?.remove();};
 });
 await page.addScriptTag({content:await readFile('content.js','utf8')});
 const scan=await page.evaluate(()=>send({type:'SCAN'}));
 assert.equal(scan.ok,true,scan.error);
 assert.equal(scan.fields.length,5);
 for(const name of ['学校','学院名称','学历','绩点'])assert.ok(scan.fields.some(f=>f.label.includes(name)),name);
 const school=scan.fields.find(f=>f.label.includes('学校')),degree=scan.fields.find(f=>f.label.includes('学历'));
 assert.equal(school.kind,'custom-select');assert.equal(degree.kind,'custom-select');
 const base={token:scan.token,url:scan.url};
 let opened=await page.evaluate(m=>send(m),{...base,type:'OPEN_OPTIONS',fieldId:school.id});
 assert.equal(opened.searchable,true);assert.equal(opened.options.length,0);
 opened=await page.evaluate(m=>send(m),{...base,type:'OPEN_OPTIONS',fieldId:school.id,query:'中南大学'});
 assert.deepEqual(opened.options.map(o=>o.label),['中南大学']);
 await page.evaluate(m=>send(m),{...base,type:'CLOSE_OPTIONS',fieldId:school.id,sessionId:opened.sessionId});
 assert.equal(await page.locator('input[role=combobox]').inputValue(),'');
 opened=await page.evaluate(m=>send(m),{...base,type:'OPEN_OPTIONS',fieldId:school.id,query:'中南大学'});
 const filled=await page.evaluate(m=>send(m),{...base,type:'FILL',actions:[{fieldId:school.id,value:opened.options[0].id,sessionId:opened.sessionId,overwrite:true}]});
 assert.equal(filled.results[0].ok,true);
 assert.equal(await page.locator('input[role=combobox]').inputValue(),'中南大学');
 opened=await page.evaluate(m=>send(m),{...base,type:'OPEN_OPTIONS',fieldId:degree.id});
 assert.deepEqual(opened.options.map(o=>o.label),['本科','硕士']);
 const result=await page.evaluate(m=>send(m),{...base,type:'FILL',actions:[{fieldId:degree.id,value:opened.options[0].id,sessionId:opened.sessionId,overwrite:true}]});
 assert.equal(result.results[0].ok,true);
 const native=scan.fields.find(f=>f.kind==='select');
 opened=await page.evaluate(m=>send(m),{...base,type:'OPEN_OPTIONS',fieldId:native.id});
 assert.deepEqual(opened.options.map(o=>o.label),['本科']);
 console.log('PASS: adjacent labels, iView dropdowns, school search, async options, no navigation options, preview search restored, real option clicks and native placeholder filtering.');
}finally{await browser.close();}
