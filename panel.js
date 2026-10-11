const $=id=>document.getElementById(id);
let scan=null,busy=false,stopped=false,invalid=false;
const rows=new Map();
const status=t=>$('status').textContent=t;
function lock(value){
  busy=value;
  for(const id of ['scan','scope'])$(id).disabled=value;
  for(const id of ['plan','analyze'])$(id).disabled=value||!scan||invalid||!scan.fields.some(f=>!f.protected);
  for(const id of ['fill','selectAll','selectNone'])$(id).disabled=value||invalid||![...rows.values()].some(row=>row.action);
  $('overwrite').disabled=value;
  for(const row of rows.values())row.check.disabled=value||!row.action||invalid;
}
function render(){
  rows.clear();$('actions').replaceChildren();
  scan.fields.forEach((field,index)=>{
    const box=document.createElement('article');box.className='field';
    const heading=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.className='chosen';check.disabled=true;
    heading.append(check,document.createTextNode(`${index+1}. ${field.section?field.section+' / ':''}${field.label}${field.required?' *':''}`));
    const locate=document.createElement('button');locate.textContent='定位网页';locate.onclick=async()=>{if(busy)return;try{await pageMessage({type:'LOCATE',fieldId:field.id});}catch(e){status(e.message);}};
    const current=document.createElement('p');current.className='reason';current.textContent='当前：'+display(field,field.currentValue,false);
    const suggestion=document.createElement('p');suggestion.className='value';suggestion.textContent=field.manualReason||'待 AI 分析';
    const result=document.createElement('p');result.className='result';
    box.append(heading,locate,current,suggestion,result);$('actions').append(box);
    rows.set(field.id,{box,check,current,suggestion,result,field,action:null});
  });
}
function display(f,value,planned){if(f.kind==='select'&&planned)return f.options?.find(o=>o.id===value)?.label||String(value);if(typeof value==='boolean')return value?'已选中':'未选中';return value===''||value==null?'（空）':String(value);}
async function pageMessage(m){
  if(!scan||invalid)throw new Error('页面已变化，请重新扫描');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id!==scan.tabId||tab.url!==scan.url){invalid=true;throw new Error('活动标签页或地址已变化，请重新扫描');}
  const r=await chrome.tabs.sendMessage(scan.tabId,{...m,token:scan.token,url:scan.url});if(!r?.ok)throw new Error(r?.error||'页面无响应，请刷新网页后扫描');return r;
}
async function api(m){const r=await chrome.runtime.sendMessage(m);if(!r?.ok)throw new Error(r?.error||'后台未响应');return r;}
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
$('scan').onclick=async()=>{
  lock(true);scan=null;invalid=false;rows.clear();$('actions').replaceChildren();$('questions').replaceChildren();$('snapshot').textContent='';
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:/.test(tab.url||''))throw new Error('请打开 HTTP/HTTPS 招聘表单页');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    const r=await chrome.tabs.sendMessage(tab.id,{type:'SCAN',scope:$('scope').value});if(!r?.ok)throw new Error(r?.error||'扫描失败');
    scan={...r,tabId:tab.id};render();$('snapshot').textContent=JSON.stringify(r.fields,null,2);
    status(`发现 ${r.fields.length} 项，${r.fields.filter(f=>!f.protected).length} 项可自动填写。`+(r.warnings||[]).join('；'));
  }catch(e){status('扫描失败：'+e.message);}finally{lock(false);}
};
async function generate(analysisOnly){
  if(!scan||busy)return;lock(true);status(analysisOnly?'正在分析简历缺项…':'正在生成填写计划…');
  try{
    await pageMessage({type:'VERIFY',fieldIds:[]});
    const {plan}=await api({type:'PLAN',fields:scan.fields});
    await pageMessage({type:'VERIFY',fieldIds:[]});
    $('questions').replaceChildren();
    for(const item of plan.missing||[]){const field=rows.get(item.fieldId)?.field;if(!field)continue;const p=document.createElement('p');p.textContent='建议补充【'+field.label+'】：'+item.reason;$('questions').append(p);}
    for(const q of plan.questions){const p=document.createElement('p');p.textContent=q;$('questions').append(p);}
    if(analysisOnly){status('缺项分析完成；可到设置补充简历，或继续生成计划。');return;}
    for(const row of rows.values()){
      row.action=plan.actions.find(a=>a.fieldId===row.field.id)||null;row.check.checked=!!row.action;row.result.textContent='';
      row.suggestion.textContent=row.action?'建议：'+display(row.field,row.action.value,true)+'\n依据：'+row.action.reason:row.field.manualReason||(plan.missing||[]).find(m=>m.fieldId===row.field.id)?.reason||'需补充信息';
    }
    status(`计划就绪：${plan.actions.length} 项默认全选；${plan.missing?.length||0} 项待补充。`);
  }catch(e){status('分析失败：'+e.message);}finally{lock(false);}
}
$('plan').onclick=()=>generate(false);$('analyze').onclick=()=>generate(true);
$('selectAll').onclick=()=>{for(const row of rows.values())row.check.checked=!!row.action;};
$('selectNone').onclick=()=>{for(const row of rows.values())row.check.checked=false;};
$('stop').onclick=()=>{stopped=true;status('已请求停止，当前页面动作结束后不再填写下一项。');};
$('fill').onclick=async()=>{
  if(busy||!scan)return;
  const selected=[...rows.values()].filter(row=>row.action&&row.check.checked);if(!selected.length){status('请选择可填项');return;}
  const overwrite=$('overwrite').checked;stopped=false;lock(true);$('stop').disabled=false;const completed=[];
  try{
    for(const [index,row] of selected.entries()){
      if(stopped)break;
      status(`正在填写 ${index+1}/${selected.length}：${row.field.label}`);
      try{
        let action={...row.action,overwrite};
        if(['select','custom-select'].includes(row.field.kind)){
          const options=await pageMessage({type:'OPEN_OPTIONS',fieldId:row.field.id});
          const {selection}=await api({type:'SELECT_OPTION',field:row.field,options:options.options});
          if(stopped)break;
          if(!selection.optionId)throw new Error('简历不足以确定下拉选项，请补充或手动选择');
          action={...action,value:selection.optionId,sessionId:options.sessionId};
          row.suggestion.textContent='实际选项：'+options.options.find(o=>o.id===selection.optionId).label;
        }
        if(stopped)break;
        const r=await pageMessage({type:'FILL',actions:[action]});const result=r.results[0];
        row.result.textContent=result.ok?'已填写并校验':result.error;
        if(result.ok){row.current.textContent='当前：'+display(row.field,result.value,false);completed.push(row.field.id);}
      }catch(e){row.result.textContent=e.message;if(invalid)break;}
    }
    if(completed.length&&!invalid){const r=await pageMessage({type:'VERIFY',fieldIds:completed});for(const result of r.results)if(!result.ok)rows.get(result.fieldId).result.textContent=result.error;}
    const success=selected.filter(row=>row.result.textContent==='已填写并校验').length;
    status((stopped?'已停止。':'执行结束。')+`已校验 ${success}/${selected.length} 项；其余请查看逐项提示。未提交申请。`);
  }catch(e){status(e.message);}finally{$('stop').disabled=true;lock(false);}
};
function invalidate(){if(scan){invalid=true;stopped=true;status('页面切换或加载更新，旧计划已失效，请重新扫描。');if(!busy)lock(false);}}
chrome.tabs.onActivated.addListener(invalidate);
chrome.tabs.onUpdated.addListener((id,change)=>{if(scan?.tabId===id&&(change.url||change.status==='loading'))invalidate();});
