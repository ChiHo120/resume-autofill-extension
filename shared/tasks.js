// Tab-bound jobs live in the service worker, not in the disposable side panel.
export const taskKey = tabId => 'resumeTask:'+tabId;
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
        await chrome.scripting.executeScript({target:{tabId:state.tabId},files:['content.js']});
        if(job.cancelled)throw new Error('页面已更新，请重新扫描');
        const result=await chrome.tabs.sendMessage(state.tabId,{type:'SCAN',scope:request.scope==='viewport'?'viewport':'page'});
        if(!result?.ok)throw new Error(result?.error || '扫描失败');
        if(job.cancelled)throw new Error('页面已更新，请重新扫描');
        state.scan={...result,tabId:state.tabId,title:tab.title || tab.url};
        state.plan=null;state.analysis=null;state.results=[];
        state.status=`发现 ${result.fields.length} 项，${result.fields.filter(f=>!f.protected).length} 项可自动填写。`+(result.warnings||[]).join('；');
      } else if(['PLAN','ANALYZE'].includes(request.action)) {
        await page(job,{type:'VERIFY',fieldIds:[]});
        const result=await callApi({type:request.action,fields:state.scan.fields});
        await page(job,{type:'VERIFY',fieldIds:[]});
        state.analysis=result.plan;
        if(request.action==='PLAN'){state.plan=result.plan;state.results=[];}
        state.status=request.action==='ANALYZE'
          ? `缺项分析完成：${result.plan.missing.length} 项建议已同步到设置页的补充列表。`
          : `计划就绪：${result.plan.actions.length} 项默认全选；${result.plan.missing.length} 项待补充。`;
      } else if(request.action==='FILL') {
        const chosen=new Set(request.chosen || []);
        const actions=state.plan.actions.filter(a=>chosen.has(a.fieldId));
        if(!actions.length)throw new Error('请选择可填项');
        state.results=[];
        for(const [index,planned] of actions.entries()) {
          if(job.cancelled || job.stopped)break;
          const field=state.scan.fields.find(f=>f.id===planned.fieldId);
          state.status=`正在填写 ${index+1}/${actions.length}：${field.label}`;await saveJob(job);
          try {
            let action={...planned,overwrite:request.overwrite===true};
            if(['select','custom-select'].includes(field.kind)){
              const options=await page(job,{type:'OPEN_OPTIONS',fieldId:field.id});
              const {selection}=await callApi({type:'SELECT_OPTION',field,options:options.options});
              if(job.stopped || job.cancelled)break;
              if(!selection.optionId)throw new Error('资料不足以确定下拉选项，请补充或手动选择');
              action={...action,value:selection.optionId,sessionId:options.sessionId};
            }
            if(job.stopped || job.cancelled)break;
            const result=await page(job,{type:'FILL',actions:[action]});
            state.results.push(result.results[0]);
          }catch(error){state.results.push({fieldId:field.id,ok:false,error:error.message});}
          await saveJob(job);
        }
        const completed=state.results.filter(r=>r.ok).map(r=>r.fieldId);
        if(completed.length&&!job.cancelled){
          const verified=await page(job,{type:'VERIFY',fieldIds:completed});
          for(const result of verified.results)if(!result.ok){const index=state.results.findIndex(r=>r.fieldId===result.fieldId);state.results[index]=result;}
        }
        state.status=(job.stopped?'已停止。':'执行结束。')+`已校验 ${state.results.filter(r=>r.ok).length}/${actions.length} 项；未提交申请。`;
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
    if(!['SCAN','PLAN','ANALYZE','FILL'].includes(request.action))throw new Error('未知操作');
    // Reserve the slot before storage awaits so double clicks cannot start two jobs.
    const job={state:initial(tabId),cancelled:false,stopped:false};jobs.set(tabId,job);
    try{
      const saved=(await chrome.storage.session.get(taskKey(tabId)))[taskKey(tabId)];
      job.state=saved || job.state;
      const state=job.state;
      if(request.action!=='SCAN' && (!state.scan || state.invalid))throw new Error('请先扫描原招聘页面');
      if(request.action==='FILL'&&!state.plan)throw new Error('请先生成填写计划');
      if(request.action==='SCAN'){state.invalid=false;state.scan=null;state.plan=null;state.analysis=null;state.results=[];}
      if(request.action==='PLAN')state.plan=null;
      state.busy=true;state.operation=request.action;
      state.status={SCAN:'正在扫描原页面…',PLAN:'正在生成填写计划…',ANALYZE:'正在分析简历缺项…',FILL:'正在原页面填写…'}[request.action];
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
