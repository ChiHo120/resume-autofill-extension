import {taskKey} from './shared/tasks.js';
const $=id=>document.getElementById(id);
let tabId=null,state=null,lastPlan=null;
const selected=new Map();
const status=text=>$('status').textContent=text;
async function send(message){const result=await chrome.runtime.sendMessage({...message,tabId});if(!result?.ok)throw new Error(result?.error || '后台未响应，请重新加载扩展');return result;}
function display(field,value){if(typeof value==='boolean')return value?'已选中':'未选中';return value===''||value==null?'（空）':String(value);}
function render(next) {
  state=next;
  const planSignature=JSON.stringify(state.plan);
  if(planSignature!==lastPlan){selected.clear();for(const action of state.plan?.actions||[])selected.set(action.fieldId,true);lastPlan=planSignature;}
  $('boundPage').textContent='绑定页面：'+(state.scan?.title || '标签页 '+tabId);
  $('boundPage').title=state.scan?.url || '';
  status(state.status);
  const busy=state.busy,scan=state.scan;
  for(const id of ['scan','scope'])$(id).disabled=busy;
  for(const id of ['plan','analyze'])$(id).disabled=busy||state.invalid||!scan?.fields.some(f=>!f.protected&&f.kind==='text');
  $('fill').disabled=busy||state.invalid||!scan?.fields.some(f=>!f.protected&&f.kind==='text')||!!(state.plan&&!state.plan.actions.length);
  for(const id of ['selectAll','selectNone'])$(id).disabled=busy||state.invalid||!state.plan?.actions.length;
  $('overwrite').disabled=busy;$('stop').disabled=!busy||state.operation!=='FILL';
  $('questions').replaceChildren();
  for(const item of state.analysis?.missing||[]){const field=scan.fields.find(f=>f.id===item.fieldId);if(!field)continue;const p=document.createElement('p');p.textContent='建议补充【'+field.label+'】：'+item.reason;$('questions').append(p);}
  for(const text of state.analysis?.questions||[]){const p=document.createElement('p');p.textContent=text;$('questions').append(p);}
  $('actions').replaceChildren();
  for(const [index,field] of (scan?.fields||[]).entries()){
    const action=state.plan?.actions.find(a=>a.fieldId===field.id),result=state.results.find(r=>r.fieldId===field.id);
    const box=document.createElement('article');box.className='field';
    const heading=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.className='chosen';check.checked=!!selected.get(field.id);check.disabled=busy||state.invalid||!action;
    check.onchange=()=>selected.set(field.id,check.checked);
    heading.append(check,document.createTextNode(`${index+1}. ${field.section?field.section+' / ':''}${field.label}${field.required?' *':''}`));
    const locate=document.createElement('button');locate.textContent='定位原页面';locate.disabled=busy||state.invalid;locate.onclick=()=>send({type:'TAB_LOCATE',fieldId:field.id}).catch(e=>status(e.message));
    const current=document.createElement('p');current.className='reason';current.textContent='当前：'+display(field,result?.ok?result.value:field.currentValue);
    const suggestion=document.createElement('p');suggestion.className='value';
    suggestion.textContent=action?'计划填充：'+(action.optionLabel || (field.kind==='select'?field.options?.find(o=>o.id===action.value)?.label:undefined) || display(field,action.value))+'\n依据：'+action.reason:field.ignoredReason||field.manualReason||state.analysis?.missing.find(m=>m.fieldId===field.id)?.reason||'待 AI 分析';
    const feedback=document.createElement('p');feedback.className='result';feedback.textContent=result?(result.ok?'已填写并校验':result.error):'';
    box.append(heading,locate,current,suggestion,feedback);$('actions').append(box);
  }
  $('snapshot').textContent=scan?JSON.stringify(scan.fields,null,2):'';
}
async function start(action){
  if(tabId===null)return;
  try{await send({type:'TAB_TASK',action,scope:$('scope').value,chosen:[...selected].filter(([,value])=>value).map(([id])=>id),overwrite:$('overwrite').checked});}
  catch(e){status(e.message);}
}
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
$('scan').onclick=()=>start('SCAN');$('plan').onclick=()=>start('PLAN');$('analyze').onclick=()=>start('ANALYZE');$('fill').onclick=()=>start('FILL');
$('stop').onclick=()=>send({type:'TAB_STOP'}).catch(e=>status(e.message));
$('selectAll').onclick=()=>{for(const action of state.plan.actions)selected.set(action.fieldId,true);render(state);};
$('selectNone').onclick=()=>{selected.clear();render(state);};
$('returnPage').onclick=()=>chrome.tabs.update(tabId,{active:true}).catch(e=>status(e.message));
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&tabId!==null&&changes[taskKey(tabId)]?.newValue)render(changes[taskKey(tabId)].newValue);});
try{
  const value=new URL(location.href).searchParams.get('tabId');
  if(value!==null){if(!/^\d+$/.test(value))throw new Error('绑定标签页无效');tabId=Number(value);}
  else{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!/^https?:/.test(tab.url||''))throw new Error('请从招聘页面打开扩展');tabId=tab.id;}
  render((await send({type:'TAB_STATE'})).state);
}catch(e){status(e.message);for(const id of ['scan','plan','analyze','fill'])$(id).disabled=true;}
