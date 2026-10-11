import { normalizeBaseUrl, permissionOrigin, validateConfig, validateProfile, validateResume } from './shared/api.js';
import { extractPdfText } from './shared/pdf.js';
import { RESUME_KEYS, validateSupplements, validateDismissed, informationSummary, parseSupplementLines } from './shared/resume.js';
const $ = id => document.getElementById(id);
let profile = null, supplements = [], pendingFields = [], dismissedFields = [];
const drafts = new Map();
const supplementInputs = new Map();
let pdfText = ''; let pdfFileName = ''; let pdfData = '';  let busy = false;
const status = text => $('status').textContent = text;
function lock(value) {
  busy = value;
  for (const id of ['baseUrl','apiKey','model','manualModel','loadModels','parsePdf','import','save','backup','restore','clear','submitSupplements','addSupplement','customLabel','pdfText','bulkSupplements','addBulk','refreshMissing','clearPending','restoreDismissed']) $(id).disabled = value;
  for (const input of supplementInputs.values()) input.disabled = value;
}
function captureDrafts() {
  for (const [id,input] of supplementInputs) drafts.get(id).value = input.value;
}
function renderSupplements() {
  captureDrafts();
  for(const id of dismissedFields)drafts.delete(id);
  for (const item of [...supplements,...pendingFields]) if (!dismissedFields.includes(item.id) && !drafts.has(item.id) && drafts.size<200) drafts.set(item.id,{...item});
  $('supplementFields').replaceChildren(); supplementInputs.clear();
  for (const item of drafts.values()) {
    const box = document.createElement('div'); box.className='supplement-item';
    const label = document.createElement('label');
    label.append(document.createTextNode((item.value.trim()?'补充项：':'待补充：')+item.label+(item.section?' · '+item.section:'')));
    const input = document.createElement('textarea');input.value=item.value;input.maxLength=10000;input.placeholder='请填写真实信息；不确定可留空';input.disabled=busy;
    input.setAttribute('aria-label',(item.section?item.section+' / ':'')+item.label);
    input.oninput=()=>{item.value=input.value;$('summaryStatus').textContent='补充内容尚未提交，请点击“提交补充并更新汇总”。';};
    label.append(input);box.append(label);
    if(item.reason){const reason=document.createElement('p');reason.className='notice';reason.textContent=item.reason;box.append(reason);}
    if(pendingFields.some(field=>field.id===item.id) || item.reason || item.id.startsWith('custom:')){
      const remove=document.createElement('button');remove.type='button';remove.textContent='移除此项';
      remove.onclick=()=>{
        if(busy)return;
        if(pendingFields.some(field=>field.id===item.id) || item.reason){void dismissSuggestions([item.id]);return;}
        captureDrafts();supplementInputs.delete(item.id);drafts.delete(item.id);supplements=supplements.filter(s=>s.id!==item.id);
        renderSupplements();$('summaryStatus').textContent='已移除草稿中的自定义补充项，提交后生效。';
      };box.append(remove);
    }
    $('supplementFields').append(box);supplementInputs.set(item.id,input);
  }
  $('supplementStatus').textContent=drafts.size?`共 ${drafts.size} 项，可填写或修改后统一提交。`+(drafts.size===200?'已达到 200 项上限，更多建议请参看侧栏。':''):'暂无待补充项。可先在右侧分析缺项，或自行添加。';
}
function formSupplements() {captureDrafts();return validateSupplements([...drafts.values()]);}
function currentSource() {return pdfText?{name:pdfFileName || 'resume.pdf',text:$('pdfText').value,data:pdfData,savedAt:new Date().toISOString()}:null;}
function refreshSummary() { $('infoSummary').value=informationSummary(profile,currentSource(),supplements); }
function resetSupplements(data) {
  supplements=validateSupplements(data.supplements);pendingFields=validateSupplements(data.pendingFields);dismissedFields=validateDismissed(data.dismissedFields);
  drafts.clear();supplementInputs.clear();renderSupplements();
  $('restoreDismissed').hidden=!dismissedFields.length;
}
async function dismissSuggestions(ids) {
  if(busy||!ids.length)return;
  if(ids.some(id=>supplements.some(item=>item.id===id&&item.value))&&!confirm('此操作也会删除对应的已提交补充信息。确定移除吗？'))return;
  captureDrafts();lock(true);
  try{
    const result=await send({type:'DISMISS_SUGGESTIONS',ids});
    pendingFields=validateSupplements(result.pendingFields);dismissedFields=validateDismissed(result.dismissedFields);
    supplements=validateSupplements(result.supplements);
    for(const id of ids){drafts.delete(id);supplementInputs.delete(id);}
    renderSupplements();$('restoreDismissed').hidden=!dismissedFields.length;
    refreshSummary();
    status(`已移除 ${ids.length} 条建议，后续分析不会再次添加。`);
  }catch(e){status(e.message);}finally{lock(false);}
}
function selectedModel() { return $('manualModel').value.trim() || $('model').value; }
function configFromForm(requireModel = true) {
  return validateConfig({baseUrl:$('baseUrl').value,apiKey:$('apiKey').value,model:selectedModel()},requireModel);
}
function populateModels(models, selected = '') {
  $('model').replaceChildren(new Option('请选择模型（也可在下方手动输入）',''));
  for (const id of models) $('model').add(new Option(id,id));
  $('model').value = models.includes(selected) ? selected : '';
}
// Called directly from a click/submit handler to retain Chrome's user gesture.
function authorize(config) { return chrome.permissions.request({origins:[permissionOrigin(config.baseUrl)]}); }
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || '扩展后台未响应，请重新加载扩展');
  return result;
}
const saved = await chrome.storage.local.get(RESUME_KEYS);
$('baseUrl').value = saved.config?.baseUrl || '';
$('apiKey').value = saved.config?.apiKey || '';
$('manualModel').value = saved.config?.model || '';
populateModels([]);
profile=saved.profile || null;resetSupplements(saved);
if (saved.resumeSource?.text) {
  pdfText = saved.resumeSource.text; pdfFileName = saved.resumeSource.name || 'resume.pdf'; pdfData = saved.resumeSource.data || ''; 
  $('pdfText').value = pdfText; $('pdfPreview').hidden = false; $('parsePdf').hidden = false;
  status('已恢复上次保存的 PDF 提取文字：'+pdfFileName+'。');
}
refreshSummary();
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local' && (changes.pendingFields||changes.dismissedFields)){
    try{if(changes.pendingFields)pendingFields=validateSupplements(changes.pendingFields.newValue);if(changes.dismissedFields)dismissedFields=validateDismissed(changes.dismissedFields.newValue);renderSupplements();$('restoreDismissed').hidden=!dismissedFields.length;}catch(e){status(e.message);}
  }
});
$('addSupplement').onclick=()=>{
  if(busy)return;const label=$('customLabel').value.trim();if(!label){status('请先填写补充项名称，例如年龄');return;}
  if(drafts.size>=200){status('最多添加 200 个补充项');return;}
  const existing=[...drafts.values()].find(item=>item.label===label&&!item.section);
  if(existing){supplementInputs.get(existing.id).focus();return;}
  const id='custom:'+crypto.randomUUID();drafts.set(id,{id,label,section:'',reason:'',value:''});
  $('customLabel').value='';renderSupplements();supplementInputs.get(id).focus();
};
$('refreshMissing').onclick=async()=>{
  if(busy)return;
  try{const data=await chrome.storage.local.get(['pendingFields']);pendingFields=validateSupplements(data.pendingFields);renderSupplements();status('已同步待补充项，正在填写的内容已保留。');}catch(e){status(e.message);}
};
$('clearPending').onclick=async()=>{
  if(busy)return;captureDrafts();
  const candidates=new Map([...pendingFields,...supplements.filter(item=>item.reason)].map(item=>[item.id,item]));
  const ids=[...candidates.values()].filter(item=>!drafts.get(item.id)?.value.trim()&&!supplements.some(saved=>saved.id===item.id&&saved.value)).map(item=>item.id);
  if(!ids.length){status('没有未填写的待补充建议。');return;}
  await dismissSuggestions(ids);
};
$('restoreDismissed').onclick=async()=>{
  if(busy||!dismissedFields.length)return;
  try{const result=await send({type:'DISMISS_SUGGESTIONS',reset:true});dismissedFields=validateDismissed(result.dismissedFields);$('restoreDismissed').hidden=true;status('已恢复移除记录；新的 AI 分析可以再次生成建议。');}catch(e){status(e.message);}
};
$('addBulk').onclick=()=>{
  if(busy)return;
  try{
    const items=parseSupplementLines($('bulkSupplements').value);captureDrafts();
    const next=new Map([...drafts].map(([id,item])=>[id,{...item}]));
    for(const item of items){
      const matches=[...next.values()].filter(existing=>existing.label===item.label);
      if(matches.length>1)throw new Error('“'+item.label+'”有多个栏目，请在上方对应输入框分别填写');
      if(matches.length)matches[0].value=item.value;
      else{const id='custom:'+crypto.randomUUID();next.set(id,{id,...item,section:'',reason:''});}
    }
    validateSupplements([...next.values()]);
    drafts.clear();supplementInputs.clear();for(const [id,item] of next)drafts.set(id,item);
    renderSupplements();$('bulkSupplements').value='';$('summaryStatus').textContent='多行补充已加入列表，请点击“提交补充并更新汇总”。';
  }catch(e){status(e.message);}
};
$('baseUrl').addEventListener('input',()=>{
  $('apiKey').value = ''; populateModels([]); $('manualModel').value=''; $('modelStatus').textContent='';
});
$('apiKey').addEventListener('input',()=>{populateModels([]);$('modelStatus').textContent='';});
$('model').addEventListener('change',()=>{if($('model').value)$('manualModel').value='';});
$('loadModels').onclick = async () => {
  if (busy) return;
  try {
    const config=configFromForm(false); const permission=authorize(config);
    lock(true); $('modelStatus').textContent='正在获取…';
    if(!await permission) throw new Error('未授权 API 域名访问');
    const {models}=await send({type:'MODELS',config});
    populateModels(models,config.model);
    if(models.includes(config.model))$('manualModel').value='';
    $('modelStatus').textContent=models.length ? '获取到 '+models.length+' 个模型' : '服务返回空列表，可手动输入模型名';
    status('列表由服务商返回，实际可用性取决于 Key 权限和模型接口支持。');
  } catch(e) { $('modelStatus').textContent=e.message; }
  finally {lock(false);}
};
$('import').onchange=async()=>{
  const file=$('import').files[0]; if(!file)return;
  lock(true);
  try {
    if(file.name.toLowerCase().endsWith('.pdf')) {
      const result=await extractPdfText(file,(page,total)=>status('正在本地提取 PDF：'+page+'/'+total+' 页'));
      pdfData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('PDF 读取失败'));reader.readAsDataURL(file);}); pdfText=result.text; pdfFileName=file.name; $('pdfText').value=pdfText;$('pdfPreview').hidden=false;$('parsePdf').hidden=false;
      profile=null;refreshSummary();$('summaryStatus').textContent='新 PDF 尚未保存，请检查后保存或提交补充。';
      status('已提取 '+result.pages+' 页、'+pdfText.length+' 个字符。可直接保存，或填写补充项后提交。'+(result.emptyPages.length?'第 '+result.emptyPages.join('、')+' 页没有提取到文字，可能需要 OCR。':''));
    } else if(file.name.toLowerCase().endsWith('.json')) {
      if(file.size>100000)throw new Error('简历 JSON 不能超过 100 KB');
      profile=validateProfile(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));
      refreshSummary();status('已导入旧 JSON 资料，请检查信息汇总后保存');
    } else throw new Error('请选择 PDF 或 JSON 文件');
  } catch(e){status(e.message);}
  finally{lock(false);}
};
$('parsePdf').onclick=async()=>{
  if(busy)return;
  try {
    const text=$('pdfText').value.trim();if(!text||text.length>80000)throw new Error('提取文字为空或超过 8 万字符');
    const config=configFromForm();const permission=authorize(config);lock(true);
    if(!await permission)throw new Error('未授权 API 域名访问');
    status('正在将已预览的文字发送到 API，识别简历…');
    const result=await send({type:'PARSE_RESUME',config,text});profile=result.profile;
    refreshSummary();
    status('识别完成。请核对姓名、联系方式、日期及经历，再点击保存。');
  }catch(e){status(e.message);}finally{lock(false);}
};
$('form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  try {
    const config=configFromForm();const nextSupplements=formSupplements();
    const resumeSource = currentSource();
    validateResume(profile,resumeSource,nextSupplements);
    const permission=authorize(config);lock(true);
    if(!await permission)throw new Error('未授权 API 域名访问');
    const infoSummary=informationSummary(profile,resumeSource,nextSupplements);
    await chrome.storage.local.set({config,profile,resumeSource,supplements:nextSupplements,infoSummary});$('baseUrl').value=normalizeBaseUrl(config.baseUrl);
    supplements=nextSupplements;$('infoSummary').value=infoSummary;renderSupplements();
    $('summaryStatus').textContent='已合并并保存。后续分析和填表将使用这份资料；请重新生成填写计划。';
    status('已保存配置与信息汇总，补充项已合并。请回到招聘页面重新扫描并生成计划。');
  }catch(e){status(e.message);}finally{lock(false);}
};
$('backup').onclick=async()=>{
  try {
    const current=await chrome.storage.local.get(RESUME_KEYS);
    if(!current.config) throw new Error('请先保存 API 和简历');
    validateResume(current.profile,current.resumeSource,current.supplements);
    const blob=new Blob([JSON.stringify({version:3,exportedAt:new Date().toISOString(),...current},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='resume-autofill-backup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('已导出配置备份。备份包含 API Key，请妥善保管，不要提交到 GitHub。');
  }catch(e){status(e.message);}
};
$('restore').onclick=()=>$('backupFile').click();
$('backupFile').onchange=async()=>{
  const file=$('backupFile').files[0];if(!file)return;lock(true);
  try {
    if(file.size>23*1024*1024)throw new Error('备份文件过大');
    const data=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    const config=validateConfig(data.config);const restoredProfile=data.profile ?? null;
    if(![1,2,3].includes(data.version))throw new Error('不支持的备份版本');
    const restoredSupplements=validateSupplements(data.supplements),restoredPending=validateSupplements(data.pendingFields),restoredDismissed=validateDismissed(data.dismissedFields);
    validateResume(restoredProfile,data.resumeSource,restoredSupplements);
    const infoSummary=informationSummary(restoredProfile,data.resumeSource,restoredSupplements);
    await chrome.storage.local.set({config,profile:restoredProfile,resumeSource:data.resumeSource || null,supplements:restoredSupplements,pendingFields:restoredPending,dismissedFields:restoredDismissed,infoSummary});
    profile=restoredProfile;resetSupplements({supplements:restoredSupplements,pendingFields:restoredPending,dismissedFields:restoredDismissed});
    $('baseUrl').value=config.baseUrl;$('apiKey').value=config.apiKey;$('manualModel').value=config.model;
    populateModels([]);pdfText='';pdfFileName='';pdfData='';$('pdfText').value='';$('pdfPreview').hidden=true;$('parsePdf').hidden=true;
    if(data.resumeSource?.text){pdfData=data.resumeSource.data||'';$('parsePdf').hidden=false;pdfText=data.resumeSource.text;pdfFileName=data.resumeSource.name||'resume.pdf';$('pdfText').value=pdfText;$('pdfPreview').hidden=false;}
    refreshSummary();$('restoreDismissed').hidden=!dismissedFields.length;$('summaryStatus').textContent='已恢复保存的信息汇总和补充项。';
    status('备份已恢复。请检查 API 地址和简历后继续使用。');
  }catch(e){status('恢复失败：'+e.message);}finally{lock(false);}
};
$('clear').onclick=async()=>{
  if(busy||!confirm('删除本机保存的 API 密钥和简历？'))return;
  lock(true);
  try {
    await chrome.storage.local.remove(RESUME_KEYS);

    for(const id of ['apiKey','baseUrl','manualModel','pdfText','import','bulkSupplements'])$(id).value='';
    populateModels([]);pdfText='';$('parsePdf').hidden=true;$('pdfPreview').hidden=true;
    profile=null;resetSupplements({});refreshSummary();$('customLabel').value='';pdfFileName='';pdfData='';$('modelStatus').textContent='';$('summaryStatus').textContent='尚无保存的信息。';status('已删除本地数据');
  }catch(e){status(e.message);}finally{lock(false);}
};
