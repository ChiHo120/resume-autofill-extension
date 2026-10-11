export function normalizeBaseUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('请输入完整 API 地址，例如 http://example.com/v1'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API 地址必须使用 HTTP 或 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能含账号、密码、查询参数或片段');
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '');
  return url.origin + path;
}
export function permissionOrigin(baseUrl) {
  const url = new URL(normalizeBaseUrl(baseUrl));
  return url.protocol + '//' + url.hostname + '/*';
}
export function validateConfig(config, requireModel = true) {
  const result = { baseUrl: normalizeBaseUrl(config?.baseUrl), apiKey: String(config?.apiKey || '').trim(), model: String(config?.model || '').trim() };
  if (!result.apiKey) throw new Error('请先填写 API Key');
  if (requireModel && !result.model) throw new Error('请选择或手动输入模型名');
  return result;
}
export function parseModels(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('服务未返回标准模型列表（需要 data 数组）');
  const ids = payload.data.map(item => item?.id).filter(id => typeof id === 'string' && id.trim() && id.length < 500);
  return [...new Set(ids)].sort((a,b) => a.localeCompare(b));
}
export function parseJsonResponse(text) {
  if (typeof text !== 'string' || text.length > 200000) throw new Error('模型响应为空或过大');
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { throw new Error('模型没有返回有效 JSON，请重试或更换模型'); }
}
export function validateProfile(profile) {
  if (!profile || Array.isArray(profile) || typeof profile !== 'object' || typeof profile.basic?.fullName !== 'string' || !profile.basic.fullName.trim()) {
    throw new Error('简历需要 basic.fullName（姓名）。请核对识别结果后填写');
  }
  if (JSON.stringify(profile).length > 100000) throw new Error('简历内容过大');
  return profile;
}
// PDF text is a complete resume source; structured JSON is optional in that case.
export function validateResume(profile, source) {
  if (source != null && (typeof source.text !== 'string' || source.text.length > 80000 || typeof source.name !== 'string' || source.name.length > 500 || (source.data && (typeof source.data !== 'string' || source.data.length > 22*1024*1024 || !/^data:application\/pdf;base64,[A-Za-z0-9+/]*={0,2}$/.test(source.data))))) {
    throw new Error('PDF 数据无效');
  }
  if (profile != null && (typeof profile !== 'object' || Array.isArray(profile) || JSON.stringify(profile).length > 100000)) {
    throw new Error('简历 JSON 必须是对象且不能超过 100 KB');
  }
  const pdfText = source?.text.trim() || '';
  if (!pdfText) validateProfile(profile);
  return {profile:profile ?? null,pdfText};
}
export async function requestApi(config, endpoint, body, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(config.baseUrl + endpoint, {
      method: body ? 'POST' : 'GET', redirect: 'error', credentials: 'omit',
      signal: AbortSignal.timeout(90000),
      headers: { Authorization: 'Bearer ' + config.apiKey, ...(body ? {'Content-Type':'application/json'} : {}) },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
  } catch (error) {
    if (['TimeoutError','AbortError'].includes(error.name)) throw new Error('API 请求超时，请重试或换模型');
    throw new Error('无法连接 API，请检查地址、网络和域名授权（不自动跟随重定向）');
  }
  if (!response.ok) {
    const hint = {401:'Key 无效或已过期',403:'Key 无权访问此接口或模型',404:'接口或模型不存在，请检查 Base URL',429:'请求限流或余额不足'}[response.status];
    throw new Error('API HTTP ' + response.status + (hint ? '：' + hint : '，请检查服务端状态'));
  }
  try { return await response.json(); } catch { throw new Error('API 没有返回 JSON，请检查 Base URL'); }
}
export async function chatJson(config, messages, fetcher = fetch) {
  const data = await requestApi(config, '/chat/completions', {model:config.model,messages}, fetcher);
  return parseJsonResponse(data.choices?.[0]?.message?.content);
}
