import {createRequire} from 'node:module';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=process.cwd(),profile=await mkdtemp(path.join(os.tmpdir(),'resume-workflow-'));
const context=await chromium.launchPersistentContext(profile,{channel:process.env.PLAYWRIGHT_CHANNEL||'chromium',headless:true,timeout:20000,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});const extensionId=worker.url().split('/')[2];
 const target=await context.newPage();
 await target.route('https://recruitment.example.test/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>.ant-form-item{margin:10px;padding:10px}.ant-select{border:1px solid;padding:10px;width:200px}.ant-select-dropdown{border:1px solid;padding:10px;position:fixed;top:60px;left:250px;background:white}[role=option]{padding:10px}</style>
 <section><h2>基本信息</h2><div class="ant-form-item"><div class="ant-form-item-label">姓名 *</div><input id="name" value="Old Name"></div>
 <div class="ant-form-item"><div class="ant-form-item-label">所在地 *</div><div class="ant-select"><span class="ant-select-selection-item"></span><input id="city" role="combobox" readonly aria-controls="cities" aria-expanded="false"></div></div>
 <label>学历<select id="degree"><option value="">请选择</option><option value="bs">本科</option><option value="ms">硕士</option></select></label>
 <label>年龄<input id="age"></label><label>电话<input value="fixed" readonly></label><label><input type="checkbox" id="consent">同意隐私条款</label>
 <div style="margin-top:1500px"><label>项目描述<textarea id="description"></textarea></label></div></section>
 <ul><li>Unrelated navigation</li></ul><input hidden value="secret">
 <script>
 document.querySelector('#city').onclick=()=>{if(document.querySelector('#cities'))return;const popup=document.createElement('div');popup.id='cities';popup.role='listbox';popup.className='ant-select-dropdown';popup.innerHTML='<div role="option">上海</div><div role="option">北京</div>';document.body.append(popup);document.querySelector('#city').setAttribute('aria-expanded','true');popup.onclick=e=>{if(e.target.role!=='option')return;document.querySelector('.ant-select-selection-item').textContent=e.target.textContent;document.querySelector('#city').setAttribute('aria-expanded','false');popup.remove();};};
 </script>`}));
 await target.goto('https://recruitment.example.test/apply');
 const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://recruitment.example.test/*'}))[0].id);
 await worker.evaluate(async()=>{
   await chrome.storage.local.set({config:{baseUrl:'https://api.example.test/v1',apiKey:'synthetic',model:'mock'},profile:{basic:{fullName:'Demo Name',city:'上海'},education:[{degree:'本科'}],projects:[{description:'Built robot'}]},resumeSource:{name:'synthetic.pdf',text:'Demo Name — 上海 — 本科 — Built robot'}});
   globalThis.optionCalls=[];
   globalThis.fetch=async(url,options)=>{
     const body=JSON.parse(options.body), data=JSON.parse(body.messages[1].content);let response;
     {
       const age=data.resume.supplements?.find(item=>item.label==='年龄')?.value;
       response={actions:data.fields.filter(f=>!f.protected&&(!f.label.includes('年龄')||age)).map(f=>({fieldId:f.id,value:f.label.includes('年龄')?age:f.label.includes('姓名')?'Demo Name':'Built robot',reason:'saved resume'})),missing:data.fields.filter(f=>f.label.includes('年龄')&&!age).map(f=>({fieldId:f.id,reason:'请在简历补充出生日期或年龄'})),questions:[]};
     }
     return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(response)}}]})};
   };
 });
 const settings=await context.newPage();await settings.goto(`chrome-extension://${extensionId}/options.html`);
 await settings.locator('#infoSummary').waitFor();
 let panel=await context.newPage();const errors=[];panel.on('pageerror',e=>errors.push(e.message));
 settings.on('pageerror',e=>errors.push(e.message));
 await panel.addInitScript(id=>{const realQuery=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async query=>query.active?[await chrome.tabs.get(id)]:realQuery(query);},tabId);
 await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
 await panel.locator('#scope').selectOption('viewport');await panel.locator('#scan').click();await panel.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('发现'));
 assert.equal(await panel.locator('.field').count(),6);
 await panel.locator('#scope').selectOption('page');await panel.locator('#scan').click();await panel.waitForFunction(()=>document.querySelectorAll('.field').length===7);
 assert.match(await panel.locator('.field').nth(1).innerText(),/所在地/);
 // Analyze without actions; the panel may close and another tab become active meanwhile.
 await worker.evaluate(()=>{const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{
   const body=JSON.parse(options.body);
   if(body.messages[0].content.startsWith('Analyze missing')){
     await new Promise(resolve=>setTimeout(resolve,1000));
     const data=JSON.parse(body.messages[1].content);
     return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({missing:data.fields.filter(f=>f.label.includes('年龄')).map(f=>({fieldId:f.id,reason:'请补充出生日期或年龄'})),questions:[]})}}]})};
   }
   return original(url,options);
 };});
 await panel.locator('#analyze').click();await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('正在分析'));
 await panel.close();await settings.bringToFront();
 await settings.locator('#supplementFields textarea').waitFor();
 panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));
 await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
 await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('缺项分析完成'));
 assert.match(await panel.locator('#questions').innerText(),/出生日期/);
 await settings.locator('#supplementFields textarea').waitFor();
 assert.match(await settings.locator('#supplementFields').innerText(),/待补充：年龄/);
 await settings.locator('#supplementFields').getByRole('button',{name:'移除此项'}).click();
 await settings.waitForFunction(()=>!document.querySelector('#supplementFields textarea'));
 await panel.locator('#analyze').click();
 await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('正在分析'));
 await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('缺项分析完成'));
 assert.equal(await settings.locator('#supplementFields textarea').count(),0);
 await settings.locator('#restoreDismissed').click();
 await settings.waitForFunction(()=>document.querySelector('#restoreDismissed').hidden);
 await panel.locator('#analyze').click();
 await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('正在分析'));
 await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('缺项分析完成'));
 await settings.locator('#supplementFields textarea').waitFor();
 await panel.locator('#plan').click();await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('计划就绪'));
 assert.match(await panel.locator('.field').nth(1).innerText(),/下拉框暂不自动填写，请手动选择/);
 assert.match(await panel.locator('.field').nth(2).innerText(),/下拉框暂不自动填写，请手动选择/);
 assert.equal((await worker.evaluate(()=>globalThis.optionCalls)).length,0);
 assert.equal(await target.locator('.ant-select-selection-item').innerText(),'');
 assert.equal(await target.locator('#degree').inputValue(),'');
 assert.equal(await panel.locator('.chosen:checked').count(),2);assert.equal(await panel.locator('#overwrite').isChecked(),true);
 await panel.locator('#selectNone').click();assert.equal(await panel.locator('.chosen:checked').count(),0);
 await panel.locator('#selectAll').click();assert.equal(await panel.locator('.chosen:checked').count(),2);
 await panel.locator('#fill').click();await panel.waitForFunction(()=>document.querySelector('#scan').disabled);
 await panel.close();await settings.bringToFront();
 panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));
 await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
 await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('执行结束'));
 assert.equal(await target.locator('#name').inputValue(),'Demo Name');
 assert.equal(await target.locator('.ant-select-selection-item').innerText(),'');
 assert.equal(await target.locator('#degree').inputValue(),'');assert.equal(await target.locator('#description').inputValue(),'Built robot');
 assert.equal(await target.locator('#consent').isChecked(),false);assert.equal(await target.locator('#age').inputValue(),'');
 assert.match(await panel.locator('#status').innerText(),/2\/2/);
 const calls=await worker.evaluate(()=>globalThis.optionCalls);assert.equal(calls.length,0);
 await settings.locator('#supplementFields textarea').fill('22');
 await settings.locator('#submitSupplements').click();
 await settings.waitForFunction(()=>document.querySelector('#infoSummary').value.includes('年龄：22'));
 assert.match(await settings.locator('#infoSummary').inputValue(),/PDF 简历信息/);
 await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('旧计划已失效'));
 assert.equal(await panel.locator('#fill').isDisabled(),true);
 await panel.locator('#scan').click();await panel.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('发现'));
 await panel.locator('#plan').click();await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('计划就绪'));
 assert.equal(await panel.locator('.chosen:checked').count(),3);
 await panel.locator('#fill').click();await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('执行结束'));
 assert.equal(await target.locator('#age').inputValue(),'22');
 assert.equal(await target.locator('#consent').isChecked(),false);
 await settings.reload();await settings.waitForFunction(()=>document.querySelector('#infoSummary').value.includes('年龄：22'));
 assert.equal(await settings.locator('#supplementFields textarea').inputValue(),'22');
 // Separate tab keeps its own scan while the first tab's result survives reopening.
 const other=await context.newPage();await other.route('https://recruitment.example.test/**',route=>route.fulfill({contentType:'text/html',body:'<label>Name<input id="other-name"></label>'}));await other.goto('https://recruitment.example.test/other');
 const otherId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://recruitment.example.test/other'}))[0].id);
 const otherPanel=await context.newPage();await otherPanel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${otherId}`);
 assert.equal(await otherPanel.locator('.field').count(),0);
 await otherPanel.locator('#scan').click();await otherPanel.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('发现'));
 await panel.reload();await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('执行结束'));
 assert.match(await panel.locator('#boundPage').getAttribute('title'),/\/apply$/);
 await target.reload();await panel.waitForFunction(()=>document.querySelector('#status').textContent.includes('重新加载或跳转'));
 assert.equal(await panel.locator('#fill').isDisabled(),true);
 assert.equal(await panel.locator('#scan').isEnabled(),true);
 assert.match(await otherPanel.locator('#status').innerText(),/发现/);
 assert.deepEqual(errors,[]);
 await mkdir('dist',{recursive:true});await panel.screenshot({path:'dist/workflow-preview.png',fullPage:true});
 console.log('PASS: tab-bound analysis and filling survive panel reopening and tab switching; missing suggestion dismissal persists across analysis and can be restored; supplement summary, age fill and consent protection. Mock model and synthetic resume only.');
}finally{await context.close();}
