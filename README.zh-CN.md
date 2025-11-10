# HaE-Lite 🕵️‍♂️

> 轻量级 Chrome 扩展：在 DevTools 中实时高亮敏感信息，支持自定义正则与多规则管理。

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://developer.chrome.com/docs/extensions/mv3/intro/platform-vision/)
[![License](https://img.shields.io/badge/License-MIT-orange)](LICENSE)

[English](README.en.md) | 中文

## 📖 项目描述

HaE-Lite（Highlighter & Extractor Lite）是一款基于 Chrome DevTools 的轻量级数据提取与高亮工具。它利用 Chrome Debugger Protocol 实时捕获网络请求与响应正文，并通过用户自定义的正则规则进行匹配与高亮，帮助安全测试、渗透测试、开发调试等场景快速发现敏感信息。

### 核心特性
- **零依赖运行**：纯前端实现，无需额外抓包软件，打开 DevTools 即可使用。
- **实时捕获**：基于 Chrome Debugger Protocol，自动附加到 HTTP(S) 标签页，实时抓取请求与响应。
- **规则管理**：支持 YAML 批量导入与面板内单条管理，可自定义正则、颜色、启用状态。
- **全局开关**：右上角一键启停，不影响浏览器性能；关闭时自动断开所有调试会话。
- **结果展示**：侧边栏高亮展示匹配结果，支持一键复制、导出、快速跳转到源码位置。
- **轻量高效**：Manifest V3 架构，事件驱动，资源占用低。

## 🚀 快速开始

### 安装步骤

1. **获取源码**
   ```bash
   git clone https://github.com/kingjly/HaE-Lite.git
   cd HaE-Lite
   ```

2. **加载扩展**
   - 打开 Chrome 浏览器，地址栏输入 `chrome://extensions/`
   - 开启右上角「开发者模式」
   - 点击「加载已解压的扩展程序」，选择 `HaE-Lite` 文件夹
   - 扩展图标出现在工具栏，安装完成 ✅

3. **打开面板**
   - 打开任意网页，按 `F12` 或 `Ctrl+Shift+I` 打开 DevTools
   - 顶部找到 **HaE-Lite** 面板，点击即可使用

### 使用示例

- **捕获示例**：打开 [example.com](https://example.com)，在 HaE-Lite 面板中即可看到请求列表。
- **规则示例**：默认规则包含身份证、手机号、邮箱、JWT、API Key 等常见敏感信息正则。
- **高亮效果**：匹配结果以彩色高亮展示，方便快速定位。

## 📦 规则管理

### 默认规则

项目内置一套默认规则，位于 `Rules.yml`，涵盖常见敏感信息：
- 身份证、手机号、邮箱
- JWT、API Key、Secret Key
- 内网 IP、URL 参数
- 自定义关键词

### 自定义规则

在面板中点击「规则」子标签页，可以：
- 添加新规则：输入名称、正则、颜色、描述
- 启用/禁用：点击开关，即时生效
- 删除规则：点击删除按钮
- 导入/导出：支持 YAML 批量导入导出

### 规则字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 规则名称，展示用 |
| `regex` | string | 正则表达式，匹配敏感信息 |
| `color` | string | 高亮颜色，支持 hex/rgb/hsl |
| `enabled` | boolean | 是否启用 |
| `description` | string | 规则描述，可选 |

示例：
```yaml
- name: "API Key"
  regex: "(?i)(api[_-]?key|apikey)\\s*[:=]\\s*[\"']?([a-z0-9_\\-]{16,})[\"']?"
  color: "#ff4757"
  enabled: true
  description: "匹配 API Key"
```

## ⚙️ 设置选项

在面板「设置」子标签页中，可以配置：
- **全局开关**：右上角总开关，一键启停所有捕获
- **默认规则**：是否启用内置规则集
- **域名白名单**：仅捕获指定域名（支持通配符）
- **域名黑名单**：排除指定域名
- **扩展名过滤**：跳过静态资源（如 `.js` `.css` `.jpg`）

## 💾 数据存储

- 使用 Chrome Storage API，数据保存在浏览器本地
- 支持同步到 Google 账号（需登录并开启同步）
- 自动清理 7 天前的历史记录，节省空间
- 支持手动导出/导入规则与历史数据

## 🔧 开发指南

### 项目结构

```
HaE-Lite/
├── manifest.json          # 扩展清单
├── background.js          # 后台脚本（调试器捕获）
├── devtools/              # DevTools 面板
│   ├── devtools.html/js   # 面板入口
│   ├── panel.html/js/css  # 主界面
│   └── styles.css         # 样式
├── shared/                # 共享模块
│   ├── storage.js         # 存储封装
│   ├── ruleEngine.js      # 规则引擎
│   ├── rules.js           # 默认规则
│   └── utils.js           # 工具函数
├── scripts/               # 开发脚本
│   ├── quality-check.ps1  # 代码质量检查
│   └── dev-http.ps1       # 本地预览
├── docs/                  # 文档
└── Rules.yml              # 默认规则文件
```

### 本地开发

1. **安装依赖**（仅开发工具）
   ```bash
   npm install
   ```

2. **启动本地预览**
   ```powershell
   # PowerShell
   .\scripts\dev-http.ps1
   # 或手动
   npx http-server -p 5500
   ```
   访问 http://127.0.0.1:5500/devtools/panel.html 预览面板界面

3. **代码质量检查**
   ```powershell
   .\scripts\quality-check.ps1
   ```

### 扩展权限说明

| 权限 | 用途 |
|------|------|
| `debugger` | 捕获网络请求与响应正文 |
| `storage` | 保存规则与历史数据 |
| `tabs` | 监听标签页变化，自动附加调试器 |
| `activeTab` | 获取当前标签页信息 |

## 📋 已知限制

- 仅支持 HTTP/HTTPS 协议，无法捕获 `chrome://`、`file://` 等页面
- 由于 Chrome 安全策略，无法捕获跨域请求的响应正文（需服务端配合 CORS）
- 调试器同时只能被一个扩展附加，若其他扩展占用则无法使用
- 大量规则或高频率匹配可能影响性能，建议合理配置规则数量

## 🔐 隐私声明

- 所有数据保存在本地浏览器存储，不会上传到任何服务器
- 不会收集用户个人信息、浏览历史等隐私数据
- 扩展仅在用户主动打开 DevTools 面板时激活，后台无持续运行脚本
- 开源透明，代码可审计，欢迎提交 Issue 或 PR

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

- 提交 Issue：请描述问题、复现步骤、期望行为
- 提交 PR：请确保通过代码质量检查，添加必要注释
- 新增规则：欢迎提交常用敏感信息正则，请附带测试用例

## 📄 许可证

MIT License © 2024 [kingjly](https://github.com/kingjly)

---

如果本项目帮到你，欢迎点个 ⭐ Star 支持！