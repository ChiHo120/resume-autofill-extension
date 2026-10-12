# 页面识别适配器

0.5.9 将页面字段识别从 content.js 拆出。当前仅包含 generic 通用适配器，没有宣称支持任何真实招聘站点。全部代码为本项目实现。

加载顺序：registry.js → generic.js → 可选站点适配器 → content.js。新增文件须登记 shared/tasks.js 的 executeScript.files；构建脚本会复制整个 adapters 目录。后注册且 matches(url) 为真的适配器优先。

适配器契约：

- id：唯一名称；扫描快照记录该名称。
- matches(url)：判断适用网址，不进行网络访问。
- all(selector, root=document)：返回 DOM 顺序的匹配元素，可遍历开放 Shadow DOM。
- identify(element)：返回 {label, source, status}，status 为 recognized 或 unrecognized。没有可靠语义时返回未识别，不能拿“请输入”或其他输入框的标签充数。

站点适配器可先 resolve(location.href) 取得通用实现，再用展开语法继承 all 和 identify，对确有 DOM 证据的页面结构补充规则。不要依赖截图坐标、页面提供的脚本或用户的私人简历。

任务锁、页面绑定、AI 计划校验、写入和回读验证仍由公共流程负责。下拉框、附件、声明不因注册适配器就自动开放填写；改变这一策略需要独立评审及真实组件回归。

贡献时添加脱敏 HTML fixture，覆盖相邻字段串标签、重复区块、空占位文字、Shadow DOM 和页面更新；同时运行 tests/recognition-smoke.mjs、tests/browser-smoke.mjs、tests/workflow-smoke.mjs 及单元测试。记录测试站点、控件类型、版本和未解决限制，不能把模型给出答案等同于网页真正接收了值。
