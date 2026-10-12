// Tab-bound jobs live in the service worker, not in the disposable side panel.
import {isFillable as isManuallyFillable} from './fields.js';
export const taskKey = tabId => 'resumeTask:'+tabId;
// 当前产品策略：只让 AI 处理可直接输入的文字字段。下拉框的选项、事件模型和
// 组件实现高度依赖具体招聘网站，自动猜测容易误选，因此下拉框只做提示并交给用户手动选择。
// OPEN_OPTIONS/SELECT_OPTION 协议仍保留在底层，供未来贡献者实现站点专用适配器时复用，默认流程不会调用它们。
const isDropdown = field => ['select','custom-select'].includes(field?.kind);
export function createTasks(chrome, callApi) {
  const jobs = new Map();
  const initial = tabId=>({tabId,scan:null,plan:null,analysis:null,results:[],busy:false,invalid:false,status:'扫描后将按网页顺序列出字段。'});
  const write = state=>jobs.get(state.tabId)?.closed?Promise.resolve():chrome.storage.session.set({[taskKey(state.tabId)]:state});
  const saveJob=job=>jobs.get(job.state.tabId)===job&&!job.closed?write(job.state):Promise.resolve();
  async function read(tabId) {
    if(jobs.has(tabId))return jobs.get(tabId).state;
    const state=(await chrome.storage.session.get(taskKey(tabId)))[taskKey(tabId)] || initial(tabId);
    if(state.busy){state.busy=false;state.status='后台任务已中断，可重新扫描或重试。';await write(state);}
    return state;
  }
  async function page(job,message) {
    const {state}=job;
    if(job.cancelled || state.invalid)throw new Error('原页面或资料已更新，请重新扫描');
    const tab=await chrome.tabs.get(state.tabId);
    if(job.cancelled || state.invalid)throw new Error('原页面或资料已更新，请重新扫描');
    if(tab.url!==state.scan.url)throw new Error('原页面地址已变化，请重新扫描');
    const result=await chrome.tabs.sendMessage(state.tabId,{...message,token:state.scan.token,url:state.scan.url});
    if(!result?.ok)throw new Error(result?.error || '原页面无响应，请重新扫描');
    return result;
  }
  async function run(job,request) {
    const {state}=job;
    try {
      if(request.action==='SCAN') {
        const tab=await chrome.tabs.get(state.tabId);
        if(!/^https?:/.test(tab.url||''))throw new Error('请在 HTTP/HTTPS 招聘页面打开扩展');
        await chrome.scripting.executeScript({target:{tabId:state.tabId},files:['adapters/registry.js','adapters/generic.js','content.js']});
        if(job.cancelled)throw new Error('页面已更新，请重新扫描');
        const result=await chrome.tabs.sendMessage(state.tabId,{type:'SCAN',scope:request.scope==='viewport'?'viewport':'page'});
        if(!result?.ok)throw new Error(result?.error || '扫描失败');
        if(job.cancelled)throw new Error('页面已更新，请重新扫描');
        state.scan={...result,tabId:state.tabId,title:tab.title || tab.url};
        state.plan=null;state.analysis=null;state.results=[];
        state.status=`发现 ${result.fields.length} 项，${result.fields.filter(isManuallyFillable).length} 项可自动填写；已跳过 ${result.dropdownCount||0} 个下拉框（请手动选择）。`+(result.warnings||[]).join('；');
        state.status+=` ${result.fields.filter(f=>f.recognition?.status==='unrecognized').length} 项字段未识别（不会添加到补充资料）。`;
      } else if(['PLAN','ANALYZE'].includes(request.action)) {
        await page(job,{type:'VERIFY',fieldIds:[]});
        if(request.action==='ANALYZE'){
          const fields=state.scan.fields.filter(isManuallyFillable);
          const result=fields.length?await callApi({type:'ANALYZE',fields}):{plan:{actions:[],missing:[],questions:[]}};
          await page(job,{type:'VERIFY',fieldIds:[]});
          state.analysis=result.plan;
          state.status=`缺项分析完成：${result.plan.missing.length} 项建议已同步到设置页的补充列表；已跳过 ${state.scan.fields.filter(isDropdown).length} 个下拉框。`;
        }else{
          const dropdowns=state.scan.fields.filter(isDropdown);
          const fillableFields=state.scan.fields.filter(isManuallyFillable);
          const result=fillableFields.length?await callApi({type:'PLAN',fields:fillableFields}):{plan:{actions:[],missing:[],questions:[]}};
          const plan=result.plan;
          await page(job,{type:'VERIFY',fieldIds:[]});
          if(plan.missing.length)await callApi({type:'SYNC_MISSING',fields:fillableFields,missing:plan.missing});
          state.plan=plan;state.analysis=plan;state.results=[];
          state.status=`计划就绪：${plan.actions.length} 项可手填字段默认全选；已跳过 ${dropdowns.length} 个下拉框（请手动选择）；${plan.missing.length} 项待补充。`;
        }
      } else if(request.action==='PLAN_ONE') {
        const field=state.scan.fields.find(f=>f.id===request.fieldId);
        if(!isManuallyFillable(field))throw new Error('该字段未识别或不支持自动填写');
        await page(job,{type:'VERIFY',fieldIds:[]});
        const {plan}=await callApi({type:'PLAN',fields:[field]});
        await page(job,{type:'VERIFY',fieldIds:[]});
        const merge=old=>({actions:[...(old?.actions||[]).filter(a=>a.fieldId!==field.id),...plan.actions],missing:[...(old?.missing||[]).filter(a=>a.fieldId!==field.id),...plan.missing],questions:old?.questions||[]});
        state.plan=merge(state.plan);state.analysis=merge(state.analysis);
        state.results=state.results.filter(r=>r.fieldId!==field.id);
        state.status=plan.actions.length?'单项计划已生成，请核对后点击“填写此项”。':'资料缺失：此项已同步到设置页；其他字段保持不变。';
      } else if(['FILL','FILL_ONE'].includes(request.action)) {
        const single=request.action==='FILL_ONE';
        if(single&&!isManuallyFillable(state.scan.fields.find(f=>f.id===request.fieldId)))throw new Error('该字段未识别或不支持自动填写');
        const autoPlan=!state.plan;
        if(single&&autoPlan)throw new Error('请先生成此项计划');
        if(autoPlan){
          state.status='正在为文字字段生成填写内容…';await saveJob(job);
          const fields=state.scan.fields.filter(isManuallyFillable);
          if(!fields.length)throw new Error('没有已识别的可填文字字段');
          const result=await callApi({type:'PLAN',fields});
          await page(job,{type:'VERIFY',fieldIds:[]});
          state.plan=result.plan;state.analysis=result.plan;state.results=[];
        }
        const chosen=single?new Set([request.fieldId]):autoPlan?null:new Set(request.chosen || []);
        const actions=chosen?state.plan.actions.filter(a=>chosen.has(a.fieldId)):state.plan.actions;
        if(!actions.length)throw new Error('请选择可填项');
        state.results=single?state.results.filter(r=>r.fieldId!==request.fieldId):[];
        for(const [index,planned] of actions.entries()) {
          if(job.cancelled || job.stopped)break;
          const field=state.scan.fields.find(f=>f.id===planned.fieldId);
          state.status=`正在填写 ${index+1}/${actions.length}：${field?.label||'未识别字段'}`;await saveJob(job);
          try {
            let action={...planned,overwrite:request.overwrite===true};
            // 防御性保护：旧缓存或第三方调用即使带入下拉框，也绝不打开或选择选项。
            if(!isManuallyFillable(field))throw new Error('该字段未识别或不支持自动填写');
            if(job.stopped || job.cancelled)break;
            const result=await page(job,{type:'FILL',actions:[action]});
            state.results.push(result.results[0]);
          }catch(error){state.results.push({fieldId:planned.fieldId,ok:false,error:error.message});}
          await saveJob(job);
        }
        const completed=state.results.filter(r=>r.ok).map(r=>r.fieldId);
        if(completed.length&&!job.cancelled){
          const verified=await page(job,{type:'VERIFY',fieldIds:completed});
          for(const result of verified.results)if(!result.ok){const index=state.results.findIndex(r=>r.fieldId===result.fieldId);state.results[index]=result;}
        }
        state.status=(job.stopped?'已停止。':'执行结束。')+`已校验 ${state.results.filter(r=>r.ok&&actions.some(a=>a.fieldId===r.fieldId)).length}/${actions.length} 项；计划中另有 ${state.plan.missing?.length||0} 项资料缺失；未提交申请。`;
      }
    }catch(error){state.status='操作失败：'+error.message;}
    finally{
      if(job.cancelled)state.status=job.cancelReason;
      state.busy=false;
      await saveJob(job);
      if(jobs.get(state.tabId)===job)jobs.delete(state.tabId);
    }
  }
  async function start(tabId,request) {
    if(jobs.has(tabId))throw new Error('原页面任务仍在运行，请稍候');
    if(!['SCAN','PLAN','ANALYZE','FILL','PLAN_ONE','FILL_ONE'].includes(request.action))throw new Error('未知操作');
    // Reserve the slot before storage awaits so double clicks cannot start two jobs.
    const job={state:initial(tabId),cancelled:false,stopped:false};jobs.set(tabId,job);
    try{
      const saved=(await chrome.storage.session.get(taskKey(tabId)))[taskKey(tabId)];
      job.state=saved || job.state;
      const state=job.state;
      if(request.action!=='SCAN' && (!state.scan || state.invalid))throw new Error('请先扫描原招聘页面');
      if(['PLAN_ONE','FILL_ONE'].includes(request.action)&&!isManuallyFillable(state.scan.fields.find(f=>f.id===request.fieldId)))throw new Error('该字段未识别或不支持自动填写');
      if(request.action==='SCAN'){state.invalid=false;state.scan=null;state.plan=null;state.analysis=null;state.results=[];}
      if(request.action==='PLAN')state.plan=null;
      state.busy=true;state.operation=request.action;
      state.status={SCAN:'正在扫描原页面…',PLAN:'正在生成填写计划…',ANALYZE:'正在分析简历缺项…',FILL:'正在原页面填写…',PLAN_ONE:'正在生成此项计划…',FILL_ONE:'正在填写此项…'}[request.action];
      await write(state);
      void run(job,request).catch(async error=>{state.busy=false;state.status='任务保存失败：'+error.message;await saveJob(job).catch(()=>{});if(jobs.get(tabId)===job)jobs.delete(tabId);});
      return state;
    }catch(error){jobs.delete(tabId);throw error;}
  }
  async function invalidate(tabId,reason) {
    const job=jobs.get(tabId);
    if(job){job.cancelled=true;job.cancelReason=reason;job.stopped=true;}
    const state=job?.state || (await chrome.storage.session.get(taskKey(tabId)))[taskKey(tabId)];
    if(!state)return;
    state.invalid=true;state.plan=null;state.status=reason;state.busy=false;
    if(job)jobs.delete(tabId);
    await write(state);
  }
  async function invalidateAll() {
    const saved=await chrome.storage.session.get(null);
    const ids=new Set([...jobs.keys(),...Object.keys(saved).filter(key=>key.startsWith('resumeTask:')).map(key=>Number(key.split(':')[1]))]);
    await Promise.all([...ids].map(id=>invalidate(id,'简历或补充信息已更新，旧计划已失效，请重新扫描并生成计划。')));
  }
  return {read,start,invalidate,invalidateAll,
    async stop(tabId){const job=jobs.get(tabId);if(job){job.stopped=true;job.state.status='已请求停止，当前操作结束后停止后续填写。';await write(job.state);}},
    async locate(tabId,fieldId){const state=await read(tabId);if(state.busy)throw new Error('页面任务正在运行');return page({state},{type:'LOCATE',fieldId});},
    async remove(tabId){const job=jobs.get(tabId);if(job){job.cancelled=true;job.closed=true;job.cancelReason='原标签页已关闭';jobs.delete(tabId);}await chrome.storage.session.remove(taskKey(tabId));}
  };
}
