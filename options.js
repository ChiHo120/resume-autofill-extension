import { normalizeBaseUrl, permissionOrigin, validateConfig, validateProfile } from './shared/api.js';
import { extractPdfText } from './shared/pdf.js';
const $ = id => document.getElementById(id);
const example = {basic:{fullName:'',email:''},education:[],experience:[],projects:[],skills:[]};
let pdfText = ''; let busy = false;
const status = text => $('status').textContent = text;
function lock(value) {
  busy = value;
  for (const id of ['baseUrl','apiKey','model','manualModel','loadModels','parsePdf','import','save','clear']) $(id).disabled = value;
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
const saved = await chrome.storage.local.get(['config','profile']);
$('baseUrl').value = saved.config?.baseUrl || '';
$('apiKey').value = saved.config?.apiKey || '';
$('manualModel').value = saved.config?.model || '';
populateModels([]);
$('profile').value = JSON.stringify(saved.profile || example,null,2);
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
  pdfText='';$('parsePdf').hidden=true;$('pdfPreview').hidden=true;$('pdfText').value='';
  const file=$('import').files[0]; if(!file)return;
  lock(true);
  try {
    if(file.name.toLowerCase().endsWith('.pdf')) {
      const result=await extractPdfText(file,(page,total)=>status('正在本地提取 PDF：'+page+'/'+total+' 页'));
      pdfText=result.text;$('pdfText').value=pdfText;$('pdfPreview').hidden=false;$('parsePdf').hidden=false;
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
    await chrome.storage.local.set({config,profile});$('baseUrl').value=normalizeBaseUrl(config.baseUrl);
    status('已保存 API 配置和简历，可回到招聘页面开始填充。');
  }catch(e){status(e.message);}finally{lock(false);}
};
$('clear').onclick=async()=>{
  if(busy||!confirm('删除本机保存的 API 密钥和简历？'))return;
  lock(true);
  try {
    await chrome.storage.local.remove(['config','profile']);
    const p=await chrome.permissions.getAll();if(p.origins?.length)await chrome.permissions.remove({origins:p.origins});
    for(const id of ['apiKey','baseUrl','manualModel','pdfText','import'])$(id).value='';
    populateModels([]);pdfText='';$('parsePdf').hidden=true;$('pdfPreview').hidden=true;
    $('profile').value=JSON.stringify(example,null,2);$('modelStatus').textContent='';status('已删除本地数据与 API 域名权限');
  }catch(e){status(e.message);}finally{lock(false);}
};
