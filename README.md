# 简历智能填充浏览器扩展 0.3.0

Chrome / Edge Manifest V3 扩展：扫描招聘表单，调用自行配置的 OpenAI-compatible API 生成填写建议，由用户核对后填写。不会自动提交申请。

## 安装 / 更新

1. 下载项目 ZIP 并解压，或使用发布包解压目录；文件夹根目录必须有 `manifest.json`。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式，点击“加载已解压的扩展程序”，选择该目录。
3. 更新现有扩展时，将新版覆盖到原加载目录，再点击扩展卡片的刷新按钮，关闭旧设置页并重新打开。相同加载目录一般能保留本地配置；加载另一个目录可能被当作另一个扩展。
4. 本次新增普通 HTTP API 域名权限，浏览器可能要求重新授权。只在点击获取模型、识别 PDF 或保存时申请所填服务的域名权限。

## 配置 API

设置页依次填写 **API Base URL → API Key → 获取模型列表 → 选择模型**。

- 支持 HTTP、HTTPS 及带端口地址，例如 `http://example.com/v1`。HTTP 不加密传输 Key 和简历内容；建议服务支持时优先使用 HTTPS。
- 按服务商要求填写完整版本路径。若误粘贴 `/chat/completions` 或 `/models`，扩展会移除接口后缀，再追加所需接口。
- 获取模型列表调用带该 Key 的 `GET /models`，读取 `data[].id`。列表不保证每个模型均支持聊天或当前 Key 均能成功调用。
- 服务不支持模型列表时可手动填写模型 ID；手动输入优先于下拉框，重新选择下拉项会清空手动输入。
- 填写计划及 PDF 识别调用 `POST /chat/completions`。不强制发送 `response_format`，兼容未实现此参数的服务；返回 JSON 仍经过代码验证。
- 改变 API 地址会清空当前 Key，避免把旧服务密钥误发给另一个服务。
- Key 与简历仅保存在 `chrome.storage.local`，不写入源码、日志或 Git；本地存储并非加密保险库。页面脚本不能读取存储中的 Key。

## PDF 简历导入

1. 在设置页选择 PDF（可选择文字的 PDF，最多 15 MB / 30 页）。
2. 扩展使用随包附带的 PDF.js 在本地提取文字，展示可编辑预览。此阶段不向 API 上传文件。
3. 检查提取文字后，点击 **识别 PDF**，将文字发送到配置的 API，由选定模型整理成简历 JSON。
4. 核对姓名、联系方式、教育及工作经历，修改缺漏，再点击 **保存**。

扫描图片型 PDF 尚未提供 OCR；完全无文字时提示先做 OCR，部分页面无文字时提示具体页码。加密、损坏或过大的 PDF 会报错，不覆盖已有简历。JSON 导入保留；`resume.example.json` 仅是虚构示例。简历 PDF 用来创建填表资料，不会自动上传到招聘网站的附件控件。

## 填写

打开招聘表单 → 点击扩展图标 → 扫描页面 → AI 生成计划 → 逐项核对勾选 → 填充已勾选项。

- 默认保留已有内容，覆盖需单独勾选。
- 同意/隐私条款类复选框由用户手动处理。
- 仅支持顶层页面标准 input / textarea / select / radio / checkbox。自定义控件、iframe、Shadow DOM、动态增加经历和附件上传尚未支持。
- 模型输出只允许使用本次扫描的字段 ID；填写后重新读取控件值校验。导航或字段变化时需要重新扫描。

## 开发与打包

```sh
npm ci
npm run check
npm test
npm run vendor
npm run build
```

`npm run vendor` 从锁定版本 `pdfjs-dist` 复制浏览器运行文件、CMap、标准字体和许可到 `vendor/`。这些文件已纳入仓库，下载源码即可加载，无需安装 Node。`npm run build` 输出 `dist/unpacked`，ZIP 可用 PowerShell `Compress-Archive` 生成。

浏览器测试使用 Playwright（自行安装或通过 `PLAYWRIGHT_PATH` 指定已有模块路径）及 Edge：

```sh
node tests/browser-smoke.mjs
node tests/settings-smoke.mjs
```

安装 Playwright Chromium 后，还可运行 `node tests/extension-smoke.mjs`，检查真实扩展加载及 PDF Worker 在扩展 CSP 下工作。

设置页测试实际运行 PDF.js 及 Worker，但 API 和 Chrome 权限使用模拟值，不代表真实 Key、服务商或真实招聘网站已验证。

PDF.js 6.4.299 及其许可保存在 `vendor/`；标准字体附带各自许可。`dist/`、`node_modules/`、本地密钥和私人简历不纳入版本控制。
