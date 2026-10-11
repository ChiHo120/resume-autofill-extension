(() => {
  const VERSION = '0.5.6';
  if (globalThis.__resumeFill?.version === VERSION) return;
  if (globalThis.__resumeFill?.listener) chrome.runtime.onMessage.removeListener(globalThis.__resumeFill.listener);
  let token = '', scanUrl = '', entries = new Map(), session = null, running = false;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const text = e => clean(e?.innerText || e?.textContent).slice(0, 250);
  const widgetSelector = '[role="combobox"],[aria-haspopup="listbox"],.ant-select,.semi-select,.el-select,.arco-select,.ivu-select,.rc-select,.select2-container,.v-select,.n-select,.ant-cascader,.el-cascader,[class*="select"],[class*="Select"]';
  const popupSelector = '[role="listbox"],.ant-select-dropdown,.semi-select-option-list,.el-select-dropdown,.arco-select-popup,.ivu-select-dropdown,.rc-virtual-list,.select2-dropdown,.vs__dropdown-menu,.n-base-select-menu,[class*="options"],[class*="Options"],[class*="dropdown"],[class*="Dropdown"]';
  const optionSelector = '[role="option"],.ant-select-item-option,.semi-select-option,.el-select-dropdown__item,.arco-select-option,.ivu-select-item,.select2-results__option,.vs__dropdown-option,.n-base-select-option,[class*="option"],[class*="Option"]';
  const itemSelector = '.ant-form-item,.semi-form-field,.el-form-item,.arco-form-item,.ivu-form-item,.form-item,[data-field],fieldset';
  const labelSelector = '.ant-form-item-label,.semi-form-field-label,.el-form-item__label,.arco-form-item-label,.ivu-form-item-label,.form-item-label,[data-field-label],legend';
  function visible(e) {
    return !!e?.isConnected && !e.closest('[hidden],[aria-hidden="true"],[inert]') && e.getClientRects().length > 0 && !['hidden','collapse'].includes(getComputedStyle(e).visibility);
  }
  function itemLabel(e) {
    const box = e.closest(itemSelector);
    if (box) {const found=text(box.querySelector(labelSelector) || box.querySelector('label'));if(found)return found;}
    let branch=e;
    for(let depth=0;branch?.parentElement && depth<4;depth++,branch=branch.parentElement){
      for(let sibling=branch.previousElementSibling,steps=0;sibling&&steps<3;sibling=sibling.previousElementSibling,steps++){
        if(sibling.querySelector('input,select,textarea,'+widgetSelector))continue;
        const candidate=text(sibling.querySelector('label,'+labelSelector) || sibling);
        if(candidate&&candidate.length<80&&!/^(请输入|请选择|选择|输入)$/.test(candidate))return candidate;
      }
      if(branch.parentElement.matches('body,form'))break;
    }
    // Only examine a bounded local container; do not take arbitrary body text.
    let parent = e.parentElement;
    for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
      if (parent.matches('body,form') || parent.querySelectorAll('input,textarea,select,'+widgetSelector).length > 4) break;
      const l = parent.querySelector('label,'+labelSelector);
      if (l && !l.contains(e)) return text(l);
    }
    return '';
  }
  function label(e) {
    const refs = clean(e.getAttribute('aria-labelledby')).split(' ').map(id => text(document.getElementById(id))).join(' ').trim();
    const own = Array.from(e.labels || []).map(text).join(' ') || e.getAttribute('aria-label') || refs;
    const context = itemLabel(e);
    if (['radio','checkbox'].includes(e.type) && context && own && context !== own) return context+' / '+own;
    const generic = /^(请输入|请选择|请选择.*日期|输入|选择)(.*)?$/.test(clean(own));
    return clean((generic?context:own) || context || e.placeholder || e.name).slice(0,250);
  }
  const protectedLabel = str => /同意|隐私|条款|协议|声明|承诺|consent|agree|terms|privacy|declaration|authorize|certify/i.test(str);
  function read(entry) {
    const e = entry.e;
    if (entry.kind === 'custom-select') {
      const selected = e.querySelector('.ant-select-selection-item,.semi-select-selection,.el-select__selected-item:not(.is-placeholder),.arco-select-view-value,.ivu-select-selected-value,.select2-selection__rendered,.vs__selected,.n-base-selection-label,[class*="selected"],[class*="Selected"],[class*="value"],[class*="Value"]');
      if (selected) return text(selected);
      const input = e.matches('input') ? e : e.querySelector('input');
      return clean(input?.value || e.getAttribute('data-value') || (e.matches('[role="combobox"]') ? e.innerText : ''));
    }
    if (['radio','checkbox'].includes(e.type)) return e.checked;
    return e.isContentEditable ? e.innerText : e.value || '';
  }
  function manualReason(e, kind, name) {
    if (protectedLabel(name) && ['checkbox','radio','custom-select','select'].includes(kind)) return '请在网页手动确认声明或条款';
    if (e.matches(':disabled') || e.getAttribute('aria-disabled') === 'true' || e.closest('.ant-select-disabled,.semi-select-disabled,.is-disabled')) return '网页已禁用此项';
    if (kind === 'file') return '附件需在网页手动上传';
    if (e.multiple || e.matches('.ant-select-multiple,.semi-select-multiple,.is-multiple,.ant-cascader,.el-cascader') || e.getAttribute('aria-multiselectable') === 'true') return '多选或级联控件需手动填写';
    if (e.readOnly && kind !== 'custom-select') return '网页只读字段';
    return '';
  }
  function collect(scope) {
    const candidates = Array.from(document.querySelectorAll('input,textarea,select,[contenteditable="true"],'+widgetSelector));
    const nodes = new Set();
    for (const candidate of candidates) {
      if (candidate.closest(popupSelector)) continue;
      let e = candidate.closest(widgetSelector) || candidate;
      // A component wrapper and its inner ARIA combobox are one logical field.
      const wrapper = e.parentElement?.closest(widgetSelector);
      if (wrapper) e = wrapper;
      if (e.matches('input') && ['hidden','password','button','submit','reset','image'].includes(e.type)) continue;
      if (!visible(e)) continue;
      if (scope === 'viewport') { const r = e.getBoundingClientRect(); if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue; }
      nodes.add(e);
    }
    return [...nodes].sort((a,b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }
  async function revealPage() {
    const originalX=scrollX, originalY=scrollY;
    const height=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0);
    const step=Math.max(300,Math.floor(innerHeight*.85));
    for(let y=0;y<=height;y+=step){window.scrollTo(0,y);window.dispatchEvent(new Event('scroll'));await wait(25);}
    window.scrollTo(originalX,originalY);await wait(25);
  }
  async function scan(m) {
    if(m.scope!=='viewport')await revealPage();
    token = crypto.randomUUID(); scanUrl = location.href; entries = new Map(); session = null;
    const nodes = collect(m.scope); const fields = [];
    for (const e of nodes.slice(0,200)) {
      const kind = e.tagName === 'SELECT' ? 'select' : e.matches(widgetSelector) ? 'custom-select' : ['radio','checkbox','file'].includes(e.type) ? e.type : 'text';
      const entry = {e,kind}; const name = label(e) || '未标注字段'; const reason = manualReason(e,kind,name);
      const container = e.closest('section,fieldset,[data-section]');
      const f = {id:'f'+fields.length,kind,label:name,inputType:e.type || e.getAttribute('role') || 'text',required:!!e.required || e.getAttribute('aria-required')==='true' || /\*/.test(itemLabel(e)),currentValue:read(entry),group:e.name || '',section:text(container?.querySelector('legend,h2,h3,[data-section-title]')),manualReason:reason,protected:!!reason,options:kind==='select'?Array.from(e.options).map((o,i)=>({id:'o'+i,label:text(o),disabled:o.disabled||!!o.closest('optgroup:disabled')})).filter(o=>!o.disabled):undefined};
      entry.f=f;entries.set(f.id,entry);fields.push(f);
    }
    return {ok:true,token,url:scanUrl,fields,warnings:[...(nodes.length>200?['字段超过 200 项，请分段扫描或减少页面中的重复字段']:[]),...(document.querySelector('iframe')?['页面包含 iframe；本次仅扫描顶层页面']:[])]};
  }
  function checked(m, id) {
    if (m.token !== token || location.href !== scanUrl || m.url !== scanUrl) throw new Error('页面或扫描已变化，请重新扫描');
    const entry = entries.get(id); if (!entry || !visible(entry.e)) throw new Error('字段已移除或隐藏，请重新扫描');
    if ((label(entry.e)||'未标注字段') !== entry.f.label) throw new Error('字段标签已变化，请重新扫描');
    return entry;
  }
  function editable(entry) {
    const reason = manualReason(entry.e,entry.kind,label(entry.e));
    if (reason) throw new Error(reason);
  }
  function focus(entry) { entry.e.scrollIntoView({block:'center',behavior:'instant'}); entry.e.focus({preventScroll:true}); }
  function ownedPopup(entry, before) {
    const control = entry.e.matches('[aria-controls],[aria-owns]') ? entry.e : entry.e.querySelector('[aria-controls],[aria-owns]');
    const ids = clean(control?.getAttribute('aria-controls') || control?.getAttribute('aria-owns')).split(' ');
    for (const id of ids) { const node = document.getElementById(id); if (node && visible(node)) return node; }
    const fresh = Array.from(document.querySelectorAll(popupSelector)).filter(e=>visible(e) && !before.has(e));
    // Common component wrappers contain the ARIA listbox. Choose the unique outer popup.
    const roots = fresh.filter(e=>!fresh.some(other=>other!==e && other.contains(e)));
    if (roots.length === 1) return roots[0];
    if(entry.popup?.isConnected&&visible(entry.popup))return entry.popup;
    return null;
  }
  async function openOptions(m) {
    const entry = checked(m,m.fieldId);editable(entry);focus(entry);
    if (!['select','custom-select'].includes(entry.kind)) throw new Error('该字段不是下拉框');
    const optionNodes = [];
    if (entry.kind === 'select') {
      // Native select options already exist in the DOM; showing the OS popup is unnecessary.
      for (const node of entry.e.options) if (!node.disabled && !node.closest('optgroup:disabled') && node.value.trim() && !/^(请选择|请选择.*|Select|Choose)$/i.test(text(node))) optionNodes.push(node);
    } else {
      const before = new Set(Array.from(document.querySelectorAll(popupSelector)).filter(visible));
      const trigger = entry.e.matches('input,[role="combobox"],button,[role="button"]') ? entry.e : entry.e.querySelector('input[role="combobox"],[role="combobox"],input,button,[role="button"],.ant-select-selector,.semi-select-selection,.el-select__wrapper,.el-input__wrapper,.ivu-select-selection') || entry.e;
      if (trigger.getAttribute('aria-expanded') !== 'true') {trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));trigger.click();}
      const searchInput=entry.e.matches('input:not([readonly])')?entry.e:entry.e.querySelector('input:not([readonly])');
      const previousSearchValue=session?.fieldId===m.fieldId ? session.previousSearchValue : searchInput?.value || '';
      if(m.query && searchInput){
        if(typeof m.query!=='string'||m.query.length>100)throw new Error('搜索词无效');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(searchInput,m.query);
        searchInput.dispatchEvent(new Event('input',{bubbles:true}));
        searchInput.dispatchEvent(new Event('change',{bubbles:true}));
      }
      let popup;
      for (let retry=0;retry<20;retry++) {
        await wait(100);checked(m,m.fieldId);popup=ownedPopup(entry,before);
        if (popup && popup.querySelector(optionSelector) && (!m.query || retry>=4)) break;
      }
      if (!popup && !searchInput) throw new Error('无法确认此下拉框的选项区域，请手动选择');
      entry.popup=popup;
      for (const node of popup?.querySelectorAll(optionSelector) || []) {
        if (visible(node) && text(node) && node.getAttribute('aria-disabled')!=='true' && !node.matches('.is-disabled,.ant-select-item-option-disabled,.semi-select-option-disabled,.arco-select-option-disabled')) optionNodes.push(node);
      }
      session={id:crypto.randomUUID(),fieldId:m.fieldId,nodes:optionNodes,labels:optionNodes.map(text),searchInput,previousSearchValue};
    }
    if(entry.kind==='select')session={id:crypto.randomUUID(),fieldId:m.fieldId,nodes:optionNodes,labels:optionNodes.map(text)};
    if(optionNodes.length>100)return {ok:true,sessionId:session.id,searchable:!!session.searchInput,options:[],error:'选项超过 100 项，请先搜索或手动选择'};
    return {ok:true,sessionId:session.id,searchable:!!session.searchInput,options:session.labels.map((label,i)=>({id:'o'+i,label}))};
  }
  function closeOptions(m){
    if(m.token!==token || m.url!==scanUrl || location.href!==scanUrl)return {ok:true};
    if(session?.fieldId!==m.fieldId || session.id!==m.sessionId)return {ok:true};
    const input=session.searchInput;
    if(input?.isConnected && input.value!==session.previousSearchValue){
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,session.previousSearchValue);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    const e=entries.get(m.fieldId)?.e;
    e?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    e?.querySelector('[role="combobox"]')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    input?.blur();
    session=null;return {ok:true};
  }
  function assign(e, value) {
    if (e.isContentEditable) e.textContent=value;
    else {
      const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);
    }
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new FocusEvent('blur',{bubbles:true}));
  }
  async function fill(m) {
    if (m.token !== token || m.url !== scanUrl || location.href !== scanUrl) throw new Error('页面或扫描已变化，请重新扫描');
    if (!Array.isArray(m.actions)||m.actions.length>entries.size) throw new Error('无效计划');
    const results=[];
    for (const action of m.actions) {
      try {
        const entry=checked(m,action.fieldId);editable(entry);const {e,f,kind}=entry;focus(entry);
        if (!action.overwrite && read(entry)!=='' && read(entry)!==false) throw new Error('已有值，未允许覆盖');
        let expected=action.value;
        if (kind==='custom-select' || action.sessionId) {
          if (!session || action.sessionId!==session.id || session.fieldId!==f.id) throw new Error('下拉选项已失效，请重试');
          const index=/^o\d+$/.test(action.value)?Number(action.value.slice(1)):-1;
          const node=session.nodes[index], chosen=session.labels[index];
          if (!node?.isConnected || text(node)!==chosen || node.disabled || node.getAttribute('aria-disabled')==='true') throw new Error('下拉选项已改变');
          if (kind==='select') { if(node.parentElement!==e && !e.contains(node))throw new Error('选项已移位');expected=node.value;assign(e,expected); }
          else { if(!visible(node))throw new Error('选项已关闭');node.click();expected=chosen; }
          session=null;
        } else if(kind==='select') {
          const original=f.options.find(o=>o.id===action.value), node=original&&e.options[Number(action.value.slice(1))];
          if(!node || node.disabled || text(node)!==original.label)throw new Error('下拉选项已改变');expected=node.value;assign(e,expected);
        } else if(['radio','checkbox'].includes(kind)) {
          if(typeof expected!=='boolean')throw new Error('布尔字段类型错误');
          if(e.checked!==expected){if(kind==='radio'&&!expected)throw new Error('请选择同组另一个选项');e.click();}
        } else {
          if(typeof expected!=='string'||expected.length>10000)throw new Error('填写值无效');assign(e,expected);
        }
        await wait(200);
        if (!e.isConnected || (kind==='custom-select' ? clean(read(entry))!==clean(expected) : read(entry)!==expected)) throw new Error('未验证到网页保留填写值，请检查控件');
        if(e.validity&&!e.validity.valid)throw new Error('已填写，但格式校验未通过');
        entry.expected=expected;results.push({fieldId:f.id,ok:true,value:read(entry)});
      }catch(error){results.push({fieldId:action.fieldId,ok:false,error:error.message});}
    }
    return {ok:true,results};
  }
  async function handle(m) {
    if(m.type==='SCAN')return await scan(m);
    if(m.type==='OPEN_OPTIONS')return await openOptions(m);
    if(m.type==='CLOSE_OPTIONS')return closeOptions(m);
    if(m.type==='FILL')return await fill(m);
    if(m.type==='LOCATE'){focus(checked(m,m.fieldId));return {ok:true};}
    if(m.type==='VERIFY'){
      if(m.token!==token || m.url!==scanUrl || location.href!==scanUrl)throw new Error('原页面或扫描已变化，请重新扫描');
      return {ok:true,results:m.fieldIds.map(id=>{try{const entry=checked(m,id);return {fieldId:id,ok:read(entry)===entry.expected,value:read(entry),error:'后续操作改变了字段值'};}catch(e){return {fieldId:id,ok:false,error:e.message};}})};
    }
  }
  const listener=(m,s,reply)=>{
    if(s.id!==chrome.runtime.id || !['SCAN','OPEN_OPTIONS','CLOSE_OPTIONS','FILL','LOCATE','VERIFY'].includes(m?.type))return;
    if(running){reply({ok:false,error:'页面正在执行其他动作'});return;}
    running=true;handle(m).then(reply).catch(e=>reply({ok:false,error:e.message})).finally(()=>{running=false;});return true;
  };
  globalThis.__resumeFill={version:VERSION,listener};chrome.runtime.onMessage.addListener(listener);
})();
