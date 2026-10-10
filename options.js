const $=id=>document.getElementById(id);
const example={basic:{fullName:'测试姓名',email:'demo@example.com'},education:[],experience:[],skills:[]};
const saved=await chrome.storage.local.get(['config','profile']);
for(const id of ['baseUrl','model','apiKey'])$(id).value=saved.config?.[id]||'';
$('profile').value=JSON.stringify(saved.profile||example,null,2);
$('baseUrl').oninput=()=>{$('apiKey').value='';};
$('import').onchange=async()=>{
 try {
  const file=$('import').files[0];if(!file)return;
  if(file.size>100000)throw new Error('简历文件过大');
  const profile=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
  if(typeof profile?.basic?.fullName!=='string')throw new Error('需要 basic.fullName');
  $('profile').value=JSON.stringify(profile,null,2);
  $('status').textContent='已导入，请检查内容后保存';
 }catch(e){$('status').textContent=e.message;}
};
$('form').onsubmit=async e=>{e.preventDefault();try{
 const url=new URL($('baseUrl').value.trim());
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('需要 HTTPS 或 localhost');
 if(url.username||url.password||url.search||url.hash)throw new Error('地址不能含凭证、查询参数或片段');
 const profile=JSON.parse($('profile').value);if(typeof profile?.basic?.fullName!=='string')throw new Error('需要 basic.fullName');
 if($('profile').value.length>100000)throw new Error('简历过大');
 if(!await chrome.permissions.request({origins:[url.origin+'/*']}))throw new Error('未授权 API 域名');
 const config={baseUrl:url.href.replace(/\/$/,''),model:$('model').value.trim(),apiKey:$('apiKey').value.trim()};
 if(!config.model||!config.apiKey)throw new Error('模型和密钥不能为空');
 await chrome.storage.local.set({config,profile});$('status').textContent='已保存';
}catch(err){$('status').textContent=err.message;}};
$('clear').onclick=async()=>{if(!confirm('删除 API 密钥和简历？'))return;await chrome.storage.local.remove(['config','profile']);const p=await chrome.permissions.getAll();if(p.origins?.length)await chrome.permissions.remove({origins:p.origins});$('apiKey').value='';$('profile').value=JSON.stringify(example,null,2);$('status').textContent='已删除';};
