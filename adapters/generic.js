(() => {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const text = node => clean(node?.textContent);
  const controls = 'input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="combobox"]';
  const labels = 'label,legend,[data-field-label],.ant-form-item-label,.semi-form-field-label,.el-form-item__label,.arco-form-item-label,.ivu-form-item-label,.form-item-label';
  const meaningful = value => {
    const s = clean(value).replace(/^[*＊\s]+|[:：*＊\s]+$/g, '');
    return s.length > 0 && s.length <= 250 && !/^(请输入|请选择|输入|选择|请填写|填写|未标注字段|未识别字段|无|type here|enter|select|please select|please enter|input|field\d*|question\d*)[.。…\s]*$/i.test(s)
      && !/^[\d\W_]+$/u.test(s.replace(/[\p{L}]/gu, 'A'));
  };
  const parent = node => node.parentElement || node.getRootNode()?.host;
  // 开放 Shadow DOM 可遍历；关闭 Shadow DOM 和跨域 iframe 不假装支持。
  function all(selector, root = document) {
    const found = [];
    function visit(scope) {
      for (const node of scope.querySelectorAll('*')) {
        if (node.matches(selector)) found.push(node);
        if (node.shadowRoot) visit(node.shadowRoot);
      }
    }
    visit(root);
    return found;
  }
  function identify(element) {
    const root = element.getRootNode();
    const refs = clean(element.getAttribute('aria-labelledby')).split(' ').filter(Boolean).map(id => text(root.getElementById?.(id))).join(' ');
    const explicit = [
      ['label', Array.from(element.labels || []).map(text).join(' ')],
      ['aria-labelledby', refs], ['aria-label', element.getAttribute('aria-label')]
    ];
    if (element.id) explicit.push(['label-for', text(root.querySelector('label[for="' + CSS.escape(element.id) + '"]'))]);
    for (const [source, value] of explicit) if (meaningful(value)) return {label:clean(value), source, status:'recognized'};
    let branch = element;
    for (let depth = 0; depth < 5; depth++) {
      const box = parent(branch);
      if (!box || box.matches('body,form,html')) break;
      // 一旦容器含有另一个独立输入，就不能借用里面的第一个标签。
      const others = all(controls, box).filter(node => node !== element && !element.contains(node) && !node.contains(element));
      if (others.length) break;
      const candidate = box.querySelector(labels);
      if (candidate && !candidate.contains(element) && meaningful(text(candidate))) return {label:text(candidate), source:'local-label', status:'recognized'};
      const previous = branch.previousElementSibling;
      if (previous && !previous.matches(controls) && !previous.querySelector(controls) && meaningful(text(previous)) && text(previous).length < 80) {
        return {label:text(previous), source:'adjacent-text', status:'recognized'};
      }
      branch = box;
    }
    const placeholder = clean(element.getAttribute('placeholder'));
    if (meaningful(placeholder)) return {label:placeholder, source:'placeholder', status:'recognized'};
    // 随机 name/id 并不说明字段语义；仅使用明确白名单作为末级证据。
    const names = {fullname:'姓名',firstname:'名',lastname:'姓',email:'邮箱',phone:'电话',mobile:'手机',age:'年龄',school:'学校',college:'学院',major:'专业',gpa:'绩点'};
    const name = names[clean(element.name).toLowerCase().replace(/[-_]/g, '')];
    if (name) return {label:name, source:'semantic-name', status:'recognized'};
    return {label:'未识别字段', source:'none', status:'unrecognized'};
  }
  globalThis.__resumeAdapters.register({id:'generic', matches:() => true, all, identify});
})();
