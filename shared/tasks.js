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
        state.status=`发现 ${result.fields.length} 项，${result.fields.filter(f=>!f.protected).length} 项可自动填写；识别到 ${result.dropdownCount||0} 个下拉框。`+(result.warnings||[]).join('；');
      } else if(['PLAN','ANALYZE'].includes(request.action)) {
        await page(job,{type:'VERIFY',fieldIds:[]});
        if(request.action==='ANALYZE'){
          const result=await callApi({type:'ANALYZE',fields:state.scan.fields});
          await page(job,{type:'VERIFY',fieldIds:[]});
          state.analysis=result.plan;
          state.status=`缺项分析完成：${result.plan.missing.length} 项建议已同步到设置页的补充列表。`;
        }else{
          const dropdowns=state.scan.fields.filter(f=>!f.protected&&['select','custom-select'].includes(f.kind));
          const otherFields=state.scan.fields.filter(f=>!dropdowns.includes(f));
          const result=otherFields.some(f=>!f.protected)?await callApi({type:'PLAN',fields:otherFields}):{plan:{actions:[],missing:[],questions:[]}};
          const plan=result.plan;
          for(const [index,field] of dropdowns.entries()){
            if(job.cancelled || job.stopped)break;
            state.status=`正在分析下拉框 ${index+1}/${dropdowns.length}：${field.label}`;await saveJob(job);
            let opened=null;
            try{
              opened=await page(job,{type:'OPEN_OPTIONS',fieldId:field.id});
              let searchQuery='';
              if(!opened.options.length&&opened.searchable){
                const {query}=await callApi({type:'SUGGEST_QUERY',field});
                if(query){
                  searchQuery=query;
                  opened=await page(job,{type:'OPEN_OPTIONS',fieldId:field.id,query});
                }
              }
              if(!opened.options.length)throw new Error('未显示可确认选项；若需搜索，请先在网页展开或输入关键字后重试');
              const {selection}=await callApi({type:'SELECT_OPTION',field,options:opened.options});
              const option=opened.options.find(o=>o.id===selection.optionId);
              if(!option)throw new Error('简历资料不足以确定选项，请手动选择或补充信息');
              plan.actions.push({fieldId:field.id,value:option.id,optionLabel:option.label,searchQuery,reason:selection.reason||'依据简历与页面实际选项'});
            }catch(error){
              if(job.cancelled)break;
              plan.missing.push({fieldId:field.id,reason:'下拉框【'+field.label+'】未确认：'+error.message});
            }finally{
              if(opened?.sessionId)await page(job,{type:'CLOSE_OPTIONS',fieldId:field.id,sessionId:opened.sessionId}).catch(()=>{});
            }
          }
          await page(job,{type:'VERIFY',fieldIds:[]});
          if(plan.missing.length)await callApi({type:'SYNC_MISSING',fields:state.scan.fields,missing:plan.missing});
          state.plan=plan;state.analysis=plan;state.results=[];
          const checkedDropdowns=plan.actions.filter(action=>dropdowns.some(field=>field.id===action.fieldId)).length;
          state.status=`计划就绪：${plan.actions.length} 项默认全选；已逐个检查 ${dropdowns.length} 个下拉框，其中 ${checkedDropdowns} 个进入填充，${dropdowns.length-checkedDropdowns} 个未确认；${plan.missing.length} 项待补充。`;
        }
      } else if(request.action==='FILL') {
        const autoPlan=!state.plan;
        if(autoPlan){
          const dropdowns=state.scan.fields.filter(f=>!f.protected&&['select','custom-select'].includes(f.kind));
          if(dropdowns.length)throw new Error('页面包含下拉框，请先点击“AI 生成计划”逐个确认下拉选项');
          state.status='正在为文字字段生成填写内容…';await saveJob(job);
          const result=await callApi({type:'PLAN',fields:state.scan.fields.filter(f=>!f.protected)});
          state.plan=result.plan;state.analysis=result.plan;state.results=[];
        }
        const chosen=autoPlan?null:new Set(request.chosen || []);
        const actions=chosen?state.plan.actions.filter(a=>chosen.has(a.fieldId)):state.plan.actions;
        if(!actions.length)throw new Error('请选择可填项');
        state.results=[];
        for(const [index,planned] of actions.entries()) {
          if(job.cancelled || job.stopped)break;
          const field=state.scan.fields.find(f=>f.id===planned.fieldId);
          state.status=`正在填写 ${index+1}/${actions.length}：${field.label}`;await saveJob(job);
          let openedOptions=null;
          try {
            let action={...planned,overwrite:request.overwrite===true};
            if(['select','custom-select'].includes(field.kind)){
              const options=await page(job,{type:'OPEN_OPTIONS',fieldId:field.id,query:planned.searchQuery||''});openedOptions=options;
              if(job.stopped || job.cancelled)break;
              const matches=options.options.filter(o=>o.label===planned.optionLabel);
              if(matches.length!==1)throw new Error('计划中的下拉选项已变化或存在重名，请重新生成计划或手动选择');
              const option=matches[0];
              action={...action,value:option.id,sessionId:options.sessionId};
            }
            if(job.stopped || job.cancelled)break;
            const result=await page(job,{type:'FILL',actions:[action]});
            state.results.push(result.results[0]);
          }catch(error){state.results.push({fieldId:field.id,ok:false,error:error.message});}
          finally{if(openedOptions?.sessionId)await page(job,{type:'CLOSE_OPTIONS',fieldId:field.id,sessionId:openedOptions.sessionId}).catch(()=>{});}
          await saveJob(job);
        }
        const completed=state.results.filter(r=>r.ok).map(r=>r.fieldId);
        if(completed.length&&!job.cancelled){
          const verified=await page(job,{type:'VERIFY',fieldIds:completed});
          for(const result of verified.results)if(!result.ok){const index=state.results.findIndex(r=>r.fieldId===result.fieldId);state.results[index]=result;}
        }
        state.status=(job.stopped?'已停止。':'执行结束。')+`已校验 ${state.results.filter(r=>r.ok).length}/${actions.length} 项；计划中另有 ${state.plan.missing?.length||0} 项未确认；未提交申请。`;
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
