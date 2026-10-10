import { normalizeBaseUrl, permissionOrigin, validateConfig, validateProfile } from './shared/api.js';
import { extractPdfText } from './shared/pdf.js';
const $ = id => document.getElementById(id);
const example = {basic:{fullName:'',email:''},education:[],experience:[],projects:[],skills:[]};
let pdfText = ''; let pdfFileName = ''; let pdfData = '';  let busy = false;
const status = text => $('status').textContent = text;
function lock(value) {
  busy = value;
  for (const id of ['baseUrl','apiKey','model','manualModel','loadModels','parsePdf','import','save','backup','restore','clear']) $(id).disabled = value;
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
const saved = await chrome.storage.local.get(['config','profile','resumeSource']);
$('baseUrl').value = saved.config?.baseUrl || '';
$('apiKey').value = saved.config?.apiKey || '';
$('manualModel').value = saved.config?.model || '';
populateModels([]);
$('profile').value = JSON.stringify(saved.profile || example,null,2);
if (saved.resumeSource?.text) {
  pdfText = saved.resumeSource.text; pdfFileName = saved.resumeSource.name || 'resume.pdf'; pdfData = saved.resumeSource.data || ''; 
  $('pdfText').value = pdfText; $('pdfPreview').hidden = false; $('parsePdf').hidden = false;
  status('已恢复上次保存的 PDF 提取文字：'+pdfFileName+'。');
}
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
      status('已提取 '+result.pages+' 页、'+pdfText.length+' 个字符。请检查文字，再点击“识别 PDF”。'+(result.emptyPages.length?'第 '+result.emptyPages.join('、')+' 页没有提取到文字，可能需要 OCR。':''));
    } else if(file.name.toLowerCase().endsWith('.json')) {
      if(file.size>100000)throw new Error('简历 JSON 不能超过 100 KB');
      const profile=validateProfile(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));
      $('profile').value=JSON.stringify(profile,null,2);status('已导入 JSON，请检查内容后保存');
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
    const {profile}=await send({type:'PARSE_RESUME',config,text});
    $('profile').value=JSON.stringify(profile,null,2);
    status('识别完成。请核对姓名、联系方式、日期及经历，再点击保存。');
  }catch(e){status(e.message);}finally{lock(false);}
};
$('form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  try {
    const config=configFromForm();const profile=validateProfile(JSON.parse($('profile').value));
    const permission=authorize(config);lock(true);
    if(!await permission)throw new Error('未授权 API 域名访问');
    const resumeSource = pdfText ? {name:pdfFileName || 'resume.pdf', text:$('pdfText').value, data:pdfData, savedAt:new Date().toISOString()} : null;
    await chrome.storage.local.set({config,profile,resumeSource});$('baseUrl').value=normalizeBaseUrl(config.baseUrl);
    status('已保存 API 配置和简历，可回到招聘页面开始填充。');
  }catch(e){status(e.message);}finally{lock(false);}
};
$('backup').onclick=async()=>{
  try {
    const current=await chrome.storage.local.get(['config','profile','resumeSource']);
    if(!current.config||!current.profile) throw new Error('请先保存 API 和简历');
    const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),...current},null,2)],{type:'application/json'});
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
    const config=validateConfig(data.config);const profile=validateProfile(data.profile);
    if(data.version!==1)throw new Error('不支持的备份版本');
    const source=data.resumeSource;
    if(source!=null && (typeof source.text!=='string'||source.text.length>80000||typeof source.name!=='string'||source.name.length>500|| (source.data && (typeof source.data!=='string'||source.data.length>22*1024*1024||!/^data:application\/pdf;base64,[A-Za-z0-9+/]*={0,2}$/.test(source.data)))))throw new Error('备份中的 PDF 数据无效');
    await chrome.storage.local.set({config,profile,resumeSource:data.resumeSource || null});
    $('baseUrl').value=config.baseUrl;$('apiKey').value=config.apiKey;$('manualModel').value=config.model;$('profile').value=JSON.stringify(profile,null,2);
    populateModels([]);pdfText='';pdfFileName='';pdfData='';$('pdfText').value='';$('pdfPreview').hidden=true;$('parsePdf').hidden=true;
    if(data.resumeSource?.text){pdfData=data.resumeSource.data||'';$('parsePdf').hidden=false;pdfText=data.resumeSource.text;pdfFileName=data.resumeSource.name||'resume.pdf';$('pdfText').value=pdfText;$('pdfPreview').hidden=false;}
    status('备份已恢复。请检查 API 地址和简历后继续使用。');
  }catch(e){status('恢复失败：'+e.message);}finally{lock(false);}
};
$('clear').onclick=async()=>{
  if(busy||!confirm('删除本机保存的 API 密钥和简历？'))return;
  lock(true);
  try {
    await chrome.storage.local.remove(['config','profile','resumeSource']);

    for(const id of ['apiKey','baseUrl','manualModel','pdfText','import'])$(id).value='';
    populateModels([]);pdfText='';$('parsePdf').hidden=true;$('pdfPreview').hidden=true;
    $('profile').value=JSON.stringify(example,null,2);pdfFileName='';pdfData='';$('modelStatus').textContent='';status('已删除本地数据');
  }catch(e){status(e.message);}finally{lock(false);}
};
