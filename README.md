# AI 简历自动填充浏览器扩展

这是一个 Chrome/Edge Manifest V3 初版：扫描当前页面标准表单，把字段摘要和本地简历发送到可配置的 OpenAI-compatible API，展示结构化填写计划，用户逐项确认后才填入页面。不会自动点击提交按钮。

## 加载

在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，选择本项目目录（其中包含 `manifest.json`）。点击扩展图标打开侧边栏，先在“设置”保存 API Base URL、模型、密钥和简历 JSON，再扫描招聘表单。测试 `demo-form.html` 时，可用本地 HTTP 服务打开它；直接访问 `file://` 页面需要在扩展详情中开启“允许访问文件网址”。

## 设计原则

- AI 只做语义匹配和草拟计划；扩展只执行已扫描字段 ID，拒绝 CSS 选择器、脚本和未知字段。
- 已填值默认跳过；覆盖需要用户勾选。模型缺少事实时提问，不虚构学历、时间、薪资、授权或同意声明。
- 页面变化后计划失效，必须重新扫描；执行后重新读取并校验控件值。
- API 密钥与简历放在 `chrome.storage.local`，不注入网页、不写日志。浏览器扩展存储并非加密保险库。
- 首版支持标准 input、textarea、select、radio、checkbox；iframe、Shadow DOM、自定义控件、文件上传和动态经历区块通过站点适配器逐步加入。

## 目录规划

```text
manifest.json              扩展权限和入口
background.js               API 调用、权限和模型响应校验
content.js                  页面扫描、受约束填写、结果验证
panel.html/js/css           扫描、预览、人工确认、执行
options.html/js             API 与简历配置
shared/plan.js              计划运行时校验
demo-form.html              本地测试表单
tests/                      计划契约测试
```

下一步需要确定首个目标招聘网站和 API 协议；之后增加动态教育/工作经历、站点适配、PDF/DOCX 导入和开放题草稿。

## API 与简历

设置页可导入 `resume.example.json`，修改为自己的资料后保存。该文件是虚构测试资料，不会自动代表你的真实简历。

API 需要支持 Chat Completions 协议及 `response_format: {"type":"json_object"}`。Base URL 填写到版本路径，例如 `https://api.example.com/v1`，扩展会追加 `/chat/completions`；模型名称填写服务商提供的准确名称。密钥只在扩展设置中输入，无需放入源码。

操作顺序：打开求职表单 → 点击扩展图标 → 扫描页面 → AI 生成计划 → 核对并勾选字段 → 填充已勾选项。默认不覆盖已有值；如需要覆盖，在对应项目勾选“允许覆盖已有值”。同意条款类控件需在网站上手工确认。



## 导入浏览器

开发版使用解压目录加载：在扩展管理页开启开发者模式，选择本项目目录。发布 ZIP 解压后也按相同方式加载；Chrome/Edge 不允许直接把 ZIP 作为未打包扩展安装。
