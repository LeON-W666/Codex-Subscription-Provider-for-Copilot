# Codex Subscription Provider (Unofficial)

这是一个非官方 VS Code Language Model Provider。它把本机 Codex 的 ChatGPT
订阅模型暴露给 GitHub Copilot Chat，同时仍由 Copilot Agent 负责执行 VS Code
工具、MCP 工具以及虚拟文件编辑。

它不需要 OpenAI API Key，也不会把请求切换到 OpenAI API 独立计费。模型请求由
用户选择的本机 Codex Runtime 使用当前 ChatGPT/Codex 订阅处理。

> This is an independent project and is not endorsed by OpenAI, Microsoft, or
> GitHub.

## 0.5.2 SDK Compatibility and Icon

Codex SDK 现在作为原生 ESM 小运行时随 VSIX 提供，避免 CommonJS 打包破坏
`import.meta.url`。本版同时加入正式 Marketplace 图标。

## 0.5.1 Runtime Discovery Hotfix

Thin 版现在会自动查找官方 `openai.chatgpt` VS Code 扩展内的 Codex Runtime，
因此不再要求 VS Code Extension Host 必须继承 Codex App 的 `PATH`。

## 0.5.0 Distribution

| Distribution | Target | Codex Runtime | Use case |
| --- | --- | --- | --- |
| Thin | Marketplace / cross-platform | Official Codex app or CLI installed by the user | Recommended |
| Full Win64 | GitHub Release / Windows x64 | Bundled official Codex Runtime | Standalone installation |

Thin 包只有几 MB，不包含原生 Codex Runtime。Full Win64 包较大，用于无法从
`PATH` 找到 Codex 的 Windows x64 环境。

## 工作方式

```text
GitHub Copilot Agent
  -> conversation, images, model selection, available tools
Codex Subscription Provider
  -> local Codex Runtime
  -> ChatGPT/Codex subscription
Codex
  -> text response or structured tool-call decision
Provider
  -> response returned to Copilot Agent
Copilot Agent
  -> executes VS Code/MCP tools and virtual-file edits
```

Provider 不直接注册或执行 SAP/MCP 工具，只传递 Copilot 本次提供的工具。若
Copilot 没有提供保存、激活或测试能力，Codex 不能绕过 Copilot 自行执行。

## 前置条件

- VS Code `1.109.0` 或更新版本。
- GitHub Copilot Chat，并使用 Agent 模式。
- Codex 已通过 **Sign in with ChatGPT** 登录。
- Thin 版需要安装官方 Codex App/CLI，并让 `codex` 可通过 `PATH` 找到；也可以
  显式配置 executable 路径。

## 安装与使用

1. 安装对应 VSIX 并执行 `Developer: Reload Window`。
2. 运行 `Codex Subscription Provider: Check Codex Runtime`。
3. 运行 `Codex Subscription Provider: Refresh Models`。
4. 打开 Copilot Chat 并切换到 Agent 模式。
5. 在模型选择器中选择一个明确的 `Codex Subscription | ...` 模型。
6. 正常要求 Copilot 读取、修改、检查或测试工作区内容。

## Runtime 选择

`copilotCodexProvider.runtimeMode` 支持：

- `auto`：用户指定路径 -> 系统 `PATH` -> 官方 OpenAI VS Code 扩展 -> Full 包内置 Runtime。
- `external`：允许用户指定路径、系统 `PATH` 或官方 OpenAI VS Code 扩展，适合 Marketplace Thin 包。
- `bundled`：只允许 Full 包内置 Runtime。

用户可以设置：

```json
{
  "copilotCodexProvider.runtimeMode": "auto",
  "copilotCodexProvider.codexExecutablePath": "",
  "copilotCodexProvider.modelSource": "discovered",
  "copilotCodexProvider.enabledModels": [],
  "copilotCodexProvider.reasoningEffort": "model-default"
}
```

## 模型与智能程度

扩展通过本地 `codex app-server` 的 `model/list` 获取当前订阅可见模型，每个模型
会作为 Copilot 模型选择器中的独立选项。用户选择的模型 ID 会被严格传给 Codex，
不会静默回退。

`copilotCodexProvider.reasoningEffort` 支持 `model-default`、`minimal`、`low`、
`medium`、`high`、`xhigh`、`max` 和 `ultra`。若模型不支持所选等级，请求会明确
失败，而不是自动降级。

## 图像输入

Copilot 传入的图片通过 Codex SDK 的本地图像通道发送给所选模型：

- 单次请求最多 20 张、总计 50 MiB。
- 重复图片按 SHA-256 去重。
- 临时文件在请求完成后删除。
- 模型未声明图像能力时会拒绝请求。

## 认证与隐私

扩展检查 `~/.codex/auth.json` 或 `CODEX_HOME/auth.json`，并要求 ChatGPT 登录模式。
启动 Codex 子进程前会移除常见 API Key 和自定义 OpenAI Base URL 环境变量，避免
静默切换到 API 计费。

请求内容由本机 Codex Runtime 按 OpenAI 的服务条款处理。完整说明见包内
`PRIVACY.md`，第三方组件见 `THIRD_PARTY_NOTICES.md`。

## 诊断命令

- `Codex Subscription Provider: Manage`
- `Codex Subscription Provider: Check Codex Runtime`
- `Codex Subscription Provider: Refresh Models`
- `Codex Subscription Provider: Show Available Models`
- `Codex Subscription Provider: Show Last Request Details`

日志不会记录提示词、源代码、图片内容、认证信息、工具参数或工具结果。

## 构建与发布

```powershell
npm ci
npm run package:all
```

生成：

- `copilot-codex-provider-0.5.2-thin.vsix`
- `copilot-codex-provider-0.5.2-win32-x64-full.vsix`

Marketplace 只发布 Thin 包；Full Win64 包作为 GitHub Release 附件。详细步骤见
包内 `PUBLISHING.md`。

## License

Extension source code is licensed under the MIT License. OpenAI Codex components
retain their original Apache-2.0 license.
