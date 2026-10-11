export function validatePlan(raw, fields) {
  if (!raw || !Array.isArray(raw.actions) || raw.actions.length > fields.length) throw new Error('无效的填写计划');
  const known = new Map(fields.map(f => [f.id,f])), seen = new Set();
  const actions = raw.actions.map(a => {
    const f=known.get(a?.fieldId);
    if(!f || seen.has(f.id) || f.protected)throw new Error('模型返回未知、重复或不可填写字段');
    seen.add(f.id);
    const boolean=['checkbox','radio'].includes(f.kind);
    if(boolean?typeof a.value!=='boolean':typeof a.value!=='string')throw new Error('填写值类型错误');
    if(typeof a.value==='string'&&a.value.length>10000)throw new Error('填写内容过长');
    if(f.kind==='select'&&!f.options?.some(o=>o.id===a.value))throw new Error('模型返回未知选项');
    return {fieldId:f.id,value:a.value,reason:String(a.reason||'').slice(0,1000)};
  });
  const reasons=new Map();
  for(const m of raw.missing||[])if(known.has(m?.fieldId))reasons.set(m.fieldId,String(m.reason||'简历未提供可确认的信息').slice(0,1000));
  const missing=fields.filter(f=>!f.protected&&!seen.has(f.id)).map(f=>({fieldId:f.id,reason:reasons.get(f.id)||'模型没有给出可确认值，请补充简历资料或手动填写'}));
  return {actions,missing,questions:Array.isArray(raw.questions)?raw.questions.filter(q=>typeof q==='string').slice(0,30):[]};
}
