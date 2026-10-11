export const RESUME_KEYS = ['config','profile','resumeSource','supplements','pendingFields','infoSummary'];

export function parseSupplementLines(text) {
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(!lines.length)throw new Error('请填写补充内容，例如：年龄：22');
  if(lines.length>200)throw new Error('一次最多添加 200 项');
  return lines.map((line,index)=>{
    const match=line.match(/^([^：:]+)[：:]\s*(.+)$/);
    if(!match||!match[1].trim()||match[1].trim().length>300||match[2].length>10000)throw new Error(`第 ${index+1} 行请使用“项目名称：内容”格式`);
    return {label:match[1].trim(),value:match[2].trim()};
  });
}

export function validateSupplements(items = []) {
  if (!Array.isArray(items) || items.length > 200 || JSON.stringify(items).length > 200000) throw new Error('补充项过多或内容过长');
  const seen = new Set();
  return items.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 2000 || seen.has(item.id) ||
        typeof item.label !== 'string' || !item.label.trim() || item.label.length > 300 ||
        typeof item.value !== 'string' || item.value.length > 10000 ||
        (item.section != null && (typeof item.section !== 'string' || item.section.length > 300)) ||
        (item.reason != null && (typeof item.reason !== 'string' || item.reason.length > 1000))) throw new Error('补充项格式无效');
    seen.add(item.id);
    return {id:item.id,label:item.label.trim(),section:item.section || '',reason:item.reason || '',value:item.value.trim()};
  });
}

// Stable across scans; repeated fields retain their section and occurrence.
export function missingSupplements(fields, missing) {
  const reasons = new Map(missing.map(item => [item.fieldId,item.reason]));
  const counts = new Map();
  return fields.flatMap(field => {
    if (field.protected) return [];
    const label = String(field.label || '未标注字段').slice(0,300);
    const section = String(field.section || '').slice(0,280);
    const identity = JSON.stringify([section,label]);
    const index = (counts.get(identity) || 0) + 1; counts.set(identity,index);
    if (!reasons.has(field.id)) return [];
    return [{id:JSON.stringify([section,label,index]),label,section:section+(index>1?`（第 ${index} 项）`:''),reason:String(reasons.get(field.id)).slice(0,1000),value:''}];
  });
}

export function mergePending(existing, incoming) {
  const items = new Map(validateSupplements(existing).map(item=>[item.id,item]));
  for (const item of validateSupplements(incoming)) items.set(item.id,item);
  // Keep the most recent suggestions if many different forms have been analyzed.
  return [...items.values()].slice(-200);
}

const labels = {basic:'基本信息',fullName:'姓名',email:'邮箱',phone:'电话',city:'城市',education:'教育经历',experience:'工作经历',projects:'项目经历',skills:'技能',additionalAnswers:'其他信息',school:'学校',degree:'学历',major:'专业',company:'公司',title:'职位',description:'描述',startDate:'开始时间',endDate:'结束时间'};
function readable(value, path = [], depth = 0) {
  if (depth > 40) return [`${path.join(' / ')}：${JSON.stringify(value)}`];
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((item,i)=>readable(item,[...path,String(i+1)],depth+1));
  if (typeof value === 'object') return Object.entries(value).flatMap(([key,item])=>readable(item,[...path,labels[key] || key],depth+1));
  return [`${path.join(' / ')}：${String(value)}`];
}

export function informationSummary(profile, source, supplements = []) {
  const parts = [];
  const answers = validateSupplements(supplements).filter(item=>item.value);
  if (answers.length) parts.push('已提交补充信息（同项冲突时优先使用）\n'+answers.map(item=>`${item.section?item.section+' / ':''}${item.label}：${item.value}`).join('\n'));
  if (source?.text?.trim()) parts.push('PDF 简历信息\n'+source.text.trim());
  const legacy = readable(profile);
  if (legacy.length) parts.push('已导入 / 识别的简历资料\n'+legacy.join('\n'));
  return parts.join('\n\n');
}
