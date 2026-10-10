(() => {
  if (globalThis.__resumeFill) return;
  globalThis.__resumeFill = true;
  let token = ''; let entries = new Map();
  const types = new Set(['text','email','tel','url','number','date','month','search','radio','checkbox']);
  const visible = e => e.isConnected && !e.disabled && !e.readOnly && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const read = e => ['checkbox','radio'].includes(e.type) ? e.checked : e.value;
  const label = e => (Array.from(e.labels || []).map(l => l.textContent).join(' ') || e.getAttribute('aria-label') || e.placeholder || e.name || '').trim().slice(0,200);
  const protectedLabel = text => /同意|隐私|条款|协议|consent|agree|terms|privacy|declaration|authorize/i.test(text || '');
  function scan() {
    token = crypto.randomUUID(); entries = new Map(); const fields = [];
    for (const e of document.querySelectorAll('input,textarea,select')) {
      if (!visible(e) || e.multiple || (e.tagName === 'INPUT' && !types.has(e.type))) continue;
      if (fields.length === 200) break;
      const kind = e.tagName === 'SELECT' ? 'select' : ['checkbox','radio'].includes(e.type) ? e.type : 'text';
      const f = { id:'f'+fields.length, kind, label:label(e), inputType:e.type, required:e.required, protected: ['checkbox','radio'].includes(e.type) && protectedLabel(label(e)), currentValue:read(e), group:e.name,
        section:e.closest('fieldset')?.querySelector('legend')?.textContent?.slice(0,200) || '',
        options:kind === 'select' ? Array.from(e.options).map((o,i) => ({id:'o'+i,label:o.textContent.trim().slice(0,200),disabled:o.disabled})).filter(o=>!o.disabled) : undefined };
      entries.set(f.id,{e,f}); fields.push(f);
    }
    return {ok:true,token,fields,url:location.href};
  }
  function assign(e, property, value) {
    const proto = e.tagName === 'SELECT' ? HTMLSelectElement.prototype : e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,property).set.call(e,value);
    e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));
  }
  async function fill(m) {
    if (m.token !== token || m.url !== location.href) throw new Error('页面已变化，请重新扫描');
    if (!Array.isArray(m.actions) || m.actions.length > entries.size) throw new Error('无效计划');
    const results = []; const expectedValues = new Map();
    for (const a of m.actions) {
      try {
        const entry = entries.get(a.fieldId); if (!entry) throw new Error('未知字段');
        const {e,f} = entry;
        if (f.protected || (['checkbox','radio'].includes(e.type) && protectedLabel(label(e)))) throw new Error('Please confirm this declaration directly on the website');
        if (!visible(e) || label(e) !== f.label || e.type !== f.inputType) throw new Error('字段已变化');
        if (!a.overwrite && read(e) !== '' && read(e) !== false) throw new Error('已有值，未允许覆盖');
        let value = a.value;
        if (f.kind === 'select') {
          const original = f.options.find(o=>o.id===a.value);
          const option = original && e.options[Number(a.value.slice(1))];
          if (!option || option.disabled || option.textContent.trim().slice(0,200)!==original.label) throw new Error('选项已变化');
          value = option.value; assign(e,'value',value);
        } else if (['checkbox','radio'].includes(f.kind)) {
          if (typeof value !== 'boolean') throw new Error('值类型错误'); assign(e,'checked',value);
        } else {
          if (typeof value !== 'string' || value.length>10000) throw new Error('值类型错误'); assign(e,'value',value);
        }
        expectedValues.set(a.fieldId,value);
        await new Promise(resolve=>setTimeout(resolve,100));
        if (!e.isConnected || read(e)!==value) throw new Error('页面未保留填写值');
        if (!e.validity.valid) throw new Error('已填写，但格式不符合要求');
        results.push({fieldId:a.fieldId,ok:true});
      } catch(error) { results.push({fieldId:a.fieldId,ok:false,error:error.message}); }
    }
    for (const r of results.filter(r=>r.ok)) {
      const e = entries.get(r.fieldId).e;
      if (!e.isConnected || read(e)!==expectedValues.get(r.fieldId)) Object.assign(r,{ok:false,error:'后续操作改变了值'});
    }
    return {ok:true,results};
  }
  chrome.runtime.onMessage.addListener((m,s,reply)=>{
    if(s.id!==chrome.runtime.id) return;
    if(m?.type==='SCAN') {reply(scan());return;}
    if(m?.type==='FILL') {fill(m).then(reply).catch(e=>reply({ok:false,error:e.message}));return true;}
  });
})();
