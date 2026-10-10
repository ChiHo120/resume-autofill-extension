const $=id=>document.getElementById(id);let scan=null;
const status=t=>$('status').textContent=t;
function lock(b){$('scan').disabled=b;$('plan').disabled=b||!scan;$('fill').disabled=b||!$('actions').children.length;}
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
$('scan').onclick=async()=>{lock(true);scan=null;$('actions').replaceChildren();$('questions').replaceChildren();try{
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
 const r=await chrome.tabs.sendMessage(tab.id,{type:'SCAN'});if(!r?.ok)throw new Error('扫描失败');
 scan={...r,tabId:tab.id};$('snapshot').textContent=JSON.stringify(r.fields,null,2);status('发现 '+r.fields.length+' 个字段');
}catch(e){
 const message=e.message||String(e);
 const restricted=/Cannot access contents|permission|Receiving end does not exist|No tab with id/i.test(message);
 status(restricted?'当前页面未授予扩展访问权限。请在扩展管理页刷新本扩展，重新打开小米招聘页面后再扫描；chrome://、扩展页和浏览器内置 PDF 页面无法扫描。':message+'。请打开普通网页并重试。');
}finally{lock(false);}};
$('plan').onclick=async()=>{lock(true);$('actions').replaceChildren();$('questions').replaceChildren();status('正在请求 API…');try{
 const r=await chrome.runtime.sendMessage({type:'PLAN',fields:scan.fields});if(!r?.ok)throw new Error(r?.error||'后台无响应');
 for(const q of r.plan.questions){const p=document.createElement('p');p.textContent='待补充：'+q;$('questions').append(p);}
 for(const a of r.plan.actions){const f=scan.fields.find(f=>f.id===a.fieldId),row=document.createElement('div');row.className='field';row.action=a;
 const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.className='chosen';l.append(c,document.createTextNode(f.label||f.id));
 const p=document.createElement('p');p.textContent='当前：'+String(f.currentValue)+'\n建议：'+(f.kind==='select'?f.options.find(o=>o.id===a.value).label:String(a.value))+'\n依据：'+a.reason;
 const ol=document.createElement('label'),o=document.createElement('input');o.type='checkbox';o.className='overwrite';ol.append(o,document.createTextNode('允许覆盖已有值'));
 const result=document.createElement('p');result.className='result';row.append(l,p,ol,result);$('actions').append(row);}
 status('请逐项核对并勾选建议');
}catch(e){status('生成失败：'+e.message);}finally{lock(false);}};
$('fill').onclick=async()=>{const rows=Array.from($('actions').children).filter(r=>r.querySelector('.chosen').checked);if(!rows.length){status('请先勾选项目');return;}lock(true);try{
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab.id!==scan.tabId)throw new Error('已切换页面，请重新扫描');
 const r=await chrome.tabs.sendMessage(scan.tabId,{type:'FILL',token:scan.token,url:scan.url,actions:rows.map(row=>({...row.action,overwrite:row.querySelector('.overwrite').checked}))});if(!r?.ok)throw new Error(r?.error||'填写失败');
 for(const item of r.results){const row=rows.find(row=>row.action.fieldId===item.fieldId);row.querySelector('.result').textContent=item.ok?'已填写并校验':item.error;if(item.ok)row.querySelector('.chosen').checked=false;}
 status('完成 '+r.results.filter(r=>r.ok).length+' 项，请在网页核对');
}catch(e){status(e.message);}finally{lock(false);}};
