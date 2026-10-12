// 自有实现：适配器只提供页面识别能力；AI、任务锁、校验和禁止提交仍由公共流程负责。
// 在 generic.js 后加载站点适配器，并在 tasks.js 的注入列表登记，不允许网页提供执行代码。
(() => {
  const adapters = new Map();
  globalThis.__resumeAdapters = {
    register(adapter) {
      if (!adapter.id || typeof adapter.matches !== 'function' || typeof adapter.identify !== 'function' || typeof adapter.all !== 'function') throw new Error('无效适配器');
      adapters.set(adapter.id, adapter);
    },
    resolve(url) {
      return [...adapters.values()].reverse().find(adapter => adapter.matches(url));
    }
  };
})();
