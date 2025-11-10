# HaE-Lite 🕵️‍♂️

> 轻量级 Chrome 扩展：在 DevTools 中实时高亮敏感信息，支持自定义正则与多规则管理。

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://developer.chrome.com/docs/extensions/mv3/intro/platform-vision/)
[![License](https://img.shields.io/badge/License-MIT-orange)](LICENSE)

[English](README.en.md)

## 📖 项目描述

HaE-Lite（Highlighter & Extractor Lite）是基于著名 BurpSuite 插件 [HaE](https://github.com/gh0stkey/HaE) 的 Chrome 扩展版本。它实现了原版 HaE 的核心功能，将敏感信息高亮与提取能力带到 Chrome DevTools 环境中。

本项目利用 Chrome Debugger Protocol 实时捕获网络请求与响应正文，并通过用户自定义的正则规则进行匹配与高亮，帮助安全测试、渗透测试、开发调试等场景快速发现敏感信息。当前版本内部使用简化字段存储并专注核心匹配功能，同时支持原版 HaE 的 YAML 规则文件导入/导出（字段自动映射）。

### 核心特性

- **零依赖运行**：纯前端实现，无需额外抓包软件，打开 DevTools 即可使用。
- **实时捕获**：基于 Chrome Debugger Protocol，自动附加到 HTTP(S) 标签页，实时抓取请求与响应。
- **规则管理**：支持面板内单条管理，可自定义正则、分类、严重级别。
- **全局开关**：右上角一键启停，不影响浏览器性能；关闭时自动断开所有调试会话。
- **结果展示**：侧边栏展示匹配结果，支持导出、过滤、分类显示。
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

- **捕获示例**：打开任意网站，在 HaE-Lite 面板中即可看到捕获的请求与响应。
<img width="2560" height="1528" alt="image" src="https://github.com/user-attachments/assets/76dd6921-5dad-4004-9749-87be1345644a" />
- **规则示例**：默认规则包含 JWT、API Key、Bearer Token 等常见敏感信息正则。
<img width="2560" height="1528" alt="image" src="https://github.com/user-attachments/assets/47c6c739-5a17-4dee-acd0-c53f8cc067b5" />
- **过滤规则**：过滤指定后缀，域名黑白名单
<img width="2560" height="1525" alt="image" src="https://github.com/user-attachments/assets/cb8a50bf-7936-41b4-ac76-62ec8b22ed79" />


## 📦 规则管理

### 默认规则

项目内置一套默认规则，位于 `shared/rules.js`，涵盖常见敏感信息：

- JWT Token、API Key、Secret Key
- AWS Access Key、Bearer Token
- 密码、密钥等敏感信息

### 自定义规则

在面板中点击「识别规则」子标签页，可以：

- 查看规则列表：显示所有内置和自定义规则
- 启用/禁用：点击开关，即时生效
- 删除规则：点击删除按钮（仅自定义规则）
- 添加规则：在面板中直接添加新规则
- 导入/导出：支持原版 HaE 的 YAML 规则文件导入/导出

### 规则字段说明

当前版本使用简化规则格式（匹配引擎所用字段）：

| 字段        | 类型    | 说明                                                       |
| ----------- | ------- | ---------------------------------------------------------- |
| `id`        | string  | 规则唯一标识符                                             |
| `name`      | string  | 规则名称，展示用                                           |
| `pattern`   | string  | 正则表达式，匹配敏感信息（支持内联标志，如 `(?i)`）        |
| `category`  | string  | 规则分类（如 Auth、Key、Secret）                           |
| `severity`  | string  | 严重级别（low/medium/high）                                |
| `scope`     | string  | 匹配范围（如 `any`、`request header`、`response body` 等） |
| `sensitive` | boolean | 是否标记为敏感（用于列表强调）                             |
| `loaded`    | boolean | 是否默认启用（未显式为 false 时视为启用）                  |

**兼容说明**：

- 支持原版 HaE 的 YAML 规则文件导入/导出，字段会自动映射：
  - `f_regex` → `pattern`
  - `color` → `severity`（red/orange→high，yellow/green→medium，其余→low）
  - `scope` 会转换为对应的简化范围枚举（如 `request header`、`response body` 等）
  - `loaded` 用于控制规则启用状态
- 为保持兼容，导入时会保留 `s_regex`、`format`、`engine` 等字段并在导出时写回，但当前匹配引擎不使用这些复杂字段（仅使用上表中的简化字段进行匹配）。

示例规则（当前格式）：

```javascript
{
  id: 'api-key',
  name: 'API Key',
  pattern: '(?i)(api[_-]?key|x-api-key)[=:\s"\']?([A-Za-z0-9\-]{16,})',
  category: 'Key',
  severity: 'high',
  loaded: true
}
```

## ⚙️ 设置选项

在面板「基础配置」子标签页中，可以配置：

- 全局开关：右上角总开关，一键启停所有捕获
- 静态文件过滤（后缀）：忽略以指定后缀结尾的请求（如 `.js`, `.css`, `.png`），支持批量与 Chip 轻量编辑
- 域名白名单：启用后仅匹配白名单中的域名（支持通配符，如 `*.example.com`）
- 域名黑名单：启用后排除黑名单中的域名（支持通配符）
- 默认规则：当前版本默认禁用内置规则；你可在规则列表中逐条启用，或后续版本提供集中开关

## 💾 数据存储

- 使用浏览器本地 IndexedDB 存储规则与历史数据
- 自动清理 7 天前的历史记录，节省空间
- 支持手动导出历史数据
- 无云同步：当前版本不支持 Google 账号同步或任何云端同步功能

## 🔧 开发指南

### 与原版 HaE 的差异

| 特性         | 原版 HaE (BurpSuite) | HaE-Lite (Chrome)                   |
| ------------ | -------------------- | ----------------------------------- |
| **运行环境** | Java + BurpSuite API | JavaScript + Chrome Extension API   |
| **捕获方式** | Burp Proxy 拦截      | Chrome Debugger Protocol 实时捕获   |
| **规则格式** | YAML (复杂字段支持)  | 内部简化字段 + 支持 YAML 导入/导出  |
| **部署方式** | Jar 包安装           | 扩展程序加载                        |
| **使用场景** | 专业安全测试         | 日常开发调试 + 轻量安全测试         |
| **性能影响** | 中等                 | 轻量                                |
| **规则导入** | 完整支持             | 支持 YAML 导入/导出（字段自动映射） |

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
```

### 扩展权限说明

| 权限               | 用途                                   |
| ------------------ | -------------------------------------- |
| `debugger`         | 捕获网络请求与响应正文                 |
| `storage`          | 保存规则与历史数据                     |
| `tabs`             | 监听标签页变化，自动附加调试器         |
| `host_permissions` | 访问所有 HTTP/HTTPS 网站以捕获网络流量 |

## 📋 已知限制

- 仅支持 HTTP/HTTPS 协议，无法捕获 `chrome://`、`file://` 等页面
- 部分场景下调试器可能无法获取完整响应正文（取决于页面与浏览器状态）
- 调试器同时只能被一个扩展附加，若其他扩展占用则无法使用
- 暂不支持颜色高亮的复杂 UI 效果
- 原版复杂字段（如 `s_regex`、`format`、`engine`）会在导入/导出时保留，但匹配引擎暂不使用这些字段
- 大量规则或高频率匹配可能影响性能，建议合理配置规则数量

## 🔐 隐私声明

- 所有数据保存在本地浏览器 IndexedDB，不会上传到任何服务器
- 不会收集用户个人信息、浏览历史等隐私数据
- 扩展仅在用户主动打开 DevTools 面板时激活，后台无持续运行脚本
- 无云同步功能，数据完全本地存储
- 开源透明，代码可审计，欢迎提交 Issue 或 PR

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

- 提交 Issue：请描述问题、复现步骤、期望行为
- 提交 PR：请确保通过代码质量检查，添加必要注释
- 新增规则：欢迎提交常用敏感信息正则，请附带测试用例

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](https://github.com/kingjly/HaE-Lite/blob/main/LICENSE)文件

---

如果本项目帮到你，欢迎点个 ⭐ Star 支持！
