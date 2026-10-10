export function validatePlan(raw, fields) {
  if (!raw || !Array.isArray(raw.actions) || raw.actions.length > fields.length) throw new Error('Invalid action list');
  const known = new Map(fields.map(f => [f.id, f])); const seen = new Set();
  const actions = raw.actions.map(a => {
    const f = known.get(a?.fieldId); if (!f || seen.has(f.id) || f.protected) throw new Error('Unknown, duplicate, or protected field'); seen.add(f.id);
    const bool = f.kind === 'checkbox' || f.kind === 'radio';
    if (bool ? typeof a.value !== 'boolean' : typeof a.value !== 'string') throw new Error('Invalid value type');
    if (typeof a.value === 'string' && a.value.length > 10000) throw new Error('Value too long');
    if (f.kind === 'select' && !f.options.some(o => o.id === a.value)) throw new Error('Unknown option');
    return { fieldId: f.id, value: a.value, reason: String(a.reason || '').slice(0, 1000) };
  });
  return { actions, questions: Array.isArray(raw.questions) ? raw.questions.filter(q => typeof q === 'string').slice(0, 30) : [] };
}
