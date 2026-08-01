# Skill Context Gateway 与 Skill Policy 架构复审报告

> 项目：Codex Subscription Provider for Copilot
> 仓库：`LeON-W666/Codex-Subscription-Provider-for-Copilot`
> 审核对象：`Codex_Skill_Warning_and_Skill_Policy_Final_Implementation_Plan_v2.0.md`
> 复审日期：2026-08-01
> 文档状态：v2.0 最终复审版

---

## 1. 最终结论

新版方案已经从“直接实现完整 SCG”调整为：

```text
先采集运行时证据
    ↓
修复 Warning 误判
    ↓
验证 Runtime 隔离能力
    ↓
有条件提供 Skill Policy
    ↓
用数据决定是否重新立项完整 SCG
```

总体方向正确。v2.0 没有新的 P0 阻塞问题，可以作为正式实施依据；开始执行前仍需完成
本报告第 15 节列出的 P1/P2 文档修订。

```text
新版方案评分：9.4/10

完整 SCG：
不实施

Phase 0A 运行时证据采集：
批准

Phase 0B Warning Classifier：
条件批准

Phase 0C SDK/Runtime 兼容性检查：
批准

Phase 1 Skill Isolation Capability Spike：
批准研究

Phase 2 Skill Policy：
继续阻塞，等待 Capability Spike

Embedding / Description Compressor / Fixed Token Budget：
继续延期
```

v2.0 已经落实上一轮要求的：

- Warning Classifier 运行时证据门槛；
- 纯 TypeScript 验证边界；
- Phase 0 只放行 `SKILL_DESCRIPTIONS_SHORTENED`；
- Skill Omission 保持 fatal；
- Runtime 原始消息脱敏；
- `logger.warn()` 设计；
- 150+ Skills 隔离测试环境；
- Capability Spike 三态决策；
- Allowlist Skill Identity；
- 修订后的任务依赖顺序；
- Patch 与 Minor 分阶段发布。

这份方案可以分两层解决问题：

1. Phase 0 解决“Codex 可恢复告警被 Provider 当成致命错误”的直接故障。
2. Phase 1/2 在 Runtime 确实支持会话级隔离时，减少不需要的 Skill 元数据和冲突。

但是，Phase 0B 是否能真正恢复截图中的请求，必须先由 Phase 0A 证明：

```text
已知 Skill warning
+
非空 finalResponse
+
finalResponse 结构验证成功
+
无其他 fatal error
```

如果 Runtime 在该告警场景下没有返回可用 `finalResponse`，Warning Classifier 只能改善
错误分类，不能恢复回答。

---

## 2. 已确认的当前故障

当前 Provider 在 `thread.run()` 返回后执行：

```ts
const result = await thread.run(codexInput, {
  outputSchema: buildBridgeOutputSchema(configuration.maxToolCalls),
  signal: controller.signal
});

assertNoCodexSideEffects(result.items);

const response = parseBridgeResponse(
  result.finalResponse,
  allowedTools,
  configuration.maxToolCalls
);
```

而 `assertNoCodexSideEffects()` 当前包含：

```ts
if (item.type === "error") {
  throw new Error(`Codex reported an error: ${item.message}`);
}
```

因此：

1. 所有 Runtime `error` item 都被视为致命错误；
2. 可恢复告警没有独立分类；
3. 即使 `finalResponse` 有效，也会在解析前被丢弃；
4. 截图中的 `Codex reported an error:` 与 Provider 的异常前缀完全一致。

静态证据非常强，但仍应通过 Phase 0A 确认运行时并存语义，不能只靠错误文字推断。

---

## 3. 官方能力边界

OpenAI 官方文档说明 Codex 已对 Skills 使用 progressive disclosure：

- 初始加载 `name` 和 `description`；
- Skill 被选择后加载完整 `SKILL.md`；
- references 和 scripts 仅在需要时读取或执行。

因此，完整 SCG 中的 Lazy Loading 和 Skill 正文延迟加载与 Runtime 现有能力明显重叠。

Codex App Server 当前提供：

- `skills/list`；
- `skills/changed`；
- `skills/config/write`；
- `turn/start` 的显式 `skill` input item；
- `$<skill-name>` 显式调用。

公开配置还提供按路径的：

```text
skills.config
skills.config.<index>.path
skills.config.<index>.enabled
```

但官方文档没有证明当前 Provider 使用的 Codex SDK 路径能够：

- 会话级禁用全部用户 Skills；
- 替换默认 Skill roots；
- 设置独立 Skill token budget；
- 不持久化地对每个请求启停大量 Skills；
- 用 Provider 压缩描述替换 Runtime 扫描到的原始描述。

因此 Skill Isolation 必须先做 Capability Spike，不能直接作为正式功能开发。

参考：

- [OpenAI Skills 文档](https://learn.chatgpt.com/docs/customization/overview#skills)
- [Codex App Server Skills](https://learn.chatgpt.com/docs/app-server#skills)
- [Codex Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)

---

## 4. v2.0 已落实的 P0 要求

### 4.1 Phase 0A 诊断字段不足

当前计划中的诊断结构：

```ts
interface CodexResultDiagnostics {
  readonly itemTypes: readonly string[];
  readonly errorItemCount: number;
  readonly hasFinalResponse: boolean;
  readonly finalResponseLength: number;
  readonly resultItemCount: number;
}
```

只能证明“存在某种 error item”，不能证明：

- error item 是 Skill description shortening；
- 是否还有其他 fatal error；
- Turn 是否成功完成；
- 是否存在未知 error。

建议调整为：

```ts
interface CodexResultDiagnostics {
  readonly itemTypes: readonly string[];
  readonly errorItemCount: number;
  readonly fatalErrorCount: number;
  readonly recognizedIssueCodes: readonly string[];
  readonly hasSkillDescriptionShorteningWarning: boolean;
  readonly hasUnknownError: boolean;
  readonly hasFinalResponse: boolean;
  readonly finalResponseLength: number;
  readonly resultItemCount: number;
  readonly turnStatus?: string;
}
```

约束：

- 不记录原始 error message；
- 不记录 final response 内容；
- 不记录 Skill name/description；
- 不记录用户路径；
- `turnStatus` 如果 SDK 不提供，必须明确为 unavailable；
- 不能把 unavailable 写成“Turn 已完成”。

### 4.2 Phase 0B 必须以 Phase 0A 证据为门槛

Warning Classifier 的放行逻辑只有在运行时证明 warning 与可用 response 能并存时才成立。

建议增加正式进入条件：

```text
SKILL-000 已证明至少一个受支持 Runtime 中：
SKILL_DESCRIPTIONS_SHORTENED 与可验证 finalResponse 同时存在。
```

如果条件不成立：

- 不放行该 `error` item；
- 改善用户错误说明；
- 提示禁用无用 Skills/Plugins；
- 等待 Runtime 或 SDK 提供更明确的 warning 语义。

### 4.3 Phase 0 Patch 不得提前放行 Skill Omission

当前计划预定义：

```ts
type RecoverableCodexWarningCode =
  | "SKILL_DESCRIPTIONS_SHORTENED"
  | "SKILLS_OMITTED_FROM_INITIAL_LIST";
```

但两种情况的语义不同：

| 情况 | 当前证据 |
|---|---|
| Description shortened | Runtime 明确表示仍可看到所有 Skills |
| Skills omitted | 可能影响显式调用、隐式匹配和行为完整性 |

Phase 0 Patch 应只包含：

```ts
type RecoverableCodexWarningCode =
  "SKILL_DESCRIPTIONS_SHORTENED";
```

`SKILLS_OMITTED_FROM_INITIAL_LIST` 必须等待独立任务 `SKILL-005` 获取：

- 真实 Runtime 样本；
- 稳定 code 或文本特征；
- 与 final response 的并存语义；
- 对显式 Skill 调用的影响。

在此之前，Skill omission 和未知 error 都必须 fatal。

---

## 5. v2.0 已落实的 P1 要求

### 5.1 当前 Logger 没有 `warn()`

计划示例调用：

```ts
logger.warn(
  `Codex runtime warning code=${issue.code}`
);
```

当前 `ProviderLogger` 只有：

- `error()`；
- `info()`；
- `debug()`。

建议正式增加：

```ts
public warn(message: string): void {
  if (LEVELS[this.level] >= LEVELS.info) {
    this.output.warn(message);
  }
}
```

或者使用 `info()` 记录安全 code，但必须在计划中统一，不得留下无法编译的示例。

### 5.2 不得把原始 Runtime 消息直接抛给日志和 UI

计划示例：

```ts
throw new Error(fatalIssue.message);
```

当前 Provider 会进一步执行：

```ts
this.logger.error("Request failed", error);
```

而 `safeErrorMessage()` 不会脱敏。

Runtime 消息可能包含：

- 用户路径；
- Skill 名称；
- 配置文件位置；
- 插件信息；
- 环境信息；
- 请求相关片段。

建议拆分：

```ts
interface CodexRuntimeIssue {
  readonly kind: "recoverable_warning" | "fatal_error";
  readonly code: string;
  readonly publicMessage: string;
  readonly rawMessage?: string;
}
```

规则：

- 日志和 UI 默认只使用 `code` 与 `publicMessage`；
- `rawMessage` 不写日志，不返回 Copilot；
- 只有经过显式安全审核的错误类型才能显示详细文字；
- 未知错误使用稳定、脱敏的公开说明。

例如：

```text
Codex runtime failed (code=UNKNOWN_RUNTIME_ERROR).
```

### 5.3 Warning code 应在分类后记录

计划当前在 response 验证成功后才记录 warning。

这会导致：

```text
known warning + invalid finalResponse
```

只留下 response parse error，而没有 Skill warning 的安全诊断 code。

建议顺序：

```text
1. 禁止副作用检查
2. issue 分类
3. 记录安全 warning code
4. fatal/unknown error 检查
5. finalResponse 非空检查
6. structured response 验证
7. 返回响应
```

记录 warning 不代表放行；是否接受响应仍取决于后续所有验证。

### 5.4 单元测试必须保持为纯 TypeScript

当前仓库没有可直接加载真实 `vscode` 模块的 Vitest 测试基础设施，已有测试也避免直接
导入 Provider/Extension。

因此建议提取：

```text
src/
  codexResultDiagnostics.ts
  codexRuntimeIssues.ts
  codexResultValidator.ts
```

测试：

```text
test/
  codexResultDiagnostics.test.ts
  codexRuntimeIssues.test.ts
  codexResultValidator.test.ts
```

要求：

- 纯函数；
- 使用结构化 fixture；
- 不创建真实 VS Code Output Channel；
- 不启动 Extension Host；
- Provider 只保留薄集成；
- VS Code 加载验证继续由 extension smoke test 完成。

### 5.5 调整任务依赖顺序

当前计划让 `SKILL-003` 依赖 `SKILL-001`，容易先在 `provider.ts` 实现一次，再二次重构。

建议任务图：

```text
SKILL-000 运行时证据
        |
        v
SKILL-003 提取副作用检查和纯响应验证边界
        |
        v
SKILL-001 Warning Classifier
        |
        +--> SKILL-004 Warning 测试
        |
        +--> SKILL-006 多 Error Item 回归
        |
        v
SKILL-007 隔离集成复现
```

也可以把 `SKILL-001` 与 `SKILL-003` 合并为一个原子 Patch 任务。

### 5.6 150+ Skills 测试必须完全隔离

`SKILL-007` 不得向真实用户目录写入测试 Skills，也不得修改真实：

```text
~/.codex
~/.agents/skills
config.toml
plugin state
skill enablement
```

硬性要求：

- 使用临时目录；
- 使用测试专属 `CODEX_HOME`；
- 必要时使用测试专属 `HOME/USERPROFILE`；
- 测试前解析并验证所有目标路径；
- 不调用会持久化真实用户状态的 `skills/config/write`；
- 使用 `finally` 清理；
- 测试异常退出后能够识别和清理残留；
- 不复制真实凭证到测试产物；
- 如需真实 ChatGPT subscription smoke test，必须单独运行并最小化认证暴露。

---

## 6. 推荐的 Runtime Issue 设计

### 6.1 类型

```ts
export type RecoverableCodexWarningCode =
  "SKILL_DESCRIPTIONS_SHORTENED";

export type CodexRuntimeIssue =
  | {
      readonly kind: "recoverable_warning";
      readonly code: RecoverableCodexWarningCode;
      readonly publicMessage: string;
    }
  | {
      readonly kind: "fatal_error";
      readonly code: string;
      readonly publicMessage: string;
    };
```

分类接口应接收完整 `ThreadItem`：

```ts
export function classifyCodexRuntimeIssue(
  item: ThreadItem
): CodexRuntimeIssue | undefined;
```

优先级：

```text
稳定结构化 severity/code
    ↓
SDK/Runtime 专用字段
    ↓
严格文本兼容回退
    ↓
未知 error = fatal
```

### 6.2 文本兼容回退

对于 description shortening，以下片段必须同时出现：

```text
Skill descriptions were shortened
skills context budget
Codex can still see every skill
```

规则：

- 不依赖 `2%`；
- 大小写不敏感；
- 统一空白和换行；
- 设置合理消息长度上限；
- 不只匹配 `skills context budget`；
- 缺少任何一个稳定片段都不得放行；
- 未来发现结构化 code 后优先迁移。

### 6.3 推荐处理顺序

```ts
const result = await thread.run(codexInput, options);

assertNoForbiddenSideEffects(result.items);

const issues = classifyCodexRuntimeIssues(result.items);

for (const issue of issues) {
  if (issue.kind === "recoverable_warning") {
    logger.warn(`Codex runtime warning code=${issue.code}`);
  }
}

const fatalIssue = issues.find(
  issue => issue.kind === "fatal_error"
);

if (fatalIssue !== undefined) {
  throw new Error(
    `${fatalIssue.publicMessage} (code=${fatalIssue.code})`
  );
}

if (!result.finalResponse?.trim()) {
  throw new Error(
    "Codex returned no structured final response."
  );
}

const response = parseBridgeResponse(
  result.finalResponse,
  allowedTools,
  configuration.maxToolCalls
);

return response;
```

即使存在 recoverable warning，以下任一情况仍必须失败：

- command execution；
- file change；
- MCP tool call；
- Web Search；
- 空 final response；
- 非法 JSON；
- 不符合 output schema；
- 未授权 tool name；
- 非对象 tool arguments；
- 同时存在 unknown/fatal error。

---

## 7. Skill Isolation Capability Spike 复审

该阶段设计正确，应保留为 research，而不是产品功能。

必须回答：

1. Codex 构造器 `config` 是否支持会话级 Skill override？
2. override 是否只影响 Provider 创建的进程？
3. 是否写入用户 `config.toml`？
4. 是否能阻止默认 Skill roots 扫描？
5. 是否影响 ChatGPT subscription auth？
6. Thin 与 Full Runtime 是否一致？
7. Windows、Linux、macOS 行为是否明确？
8. WSL、Remote SSH、Dev Container 的环境归属如何处理？
9. 是否必须使用 App Server 才能控制 Skills？
10. `skills/extraRoots/set` 是否只能增加 roots，而不能替换默认 roots？
11. `skills/config/write` 是否持久化？
12. 是否存在 Runtime capability probe？

结果枚举：

```text
SUPPORTED
SUPPORTED_WITH_LIMITATIONS
NOT_SUPPORTED
```

正式开发 `isolated` 的最低条件：

- 不写用户全局配置；
- 不修改用户 Skill enablement；
- 不影响其他 Codex 会话；
- 崩溃后不留状态；
- ChatGPT subscription auth 正常；
- Thin 与 Full 均验证；
- 至少三平台行为明确。

处理规则：

| Spike 结果 | 产品决策 |
|---|---|
| `SUPPORTED` | 可以进入正式 Skill Policy 开发 |
| `SUPPORTED_WITH_LIMITATIONS` | 不公开正式配置，只允许开发/实验构建继续研究 |
| `NOT_SUPPORTED` | 不实现 isolated，只发布 Warning Classifier |

---

## 8. Skill Policy 复审

### 8.1 首个 Minor 默认值

首个 Minor Release 必须保持：

```json
{
  "copilotCodexProvider.codexSkillsMode": "inherit",
  "copilotCodexProvider.codexSkillAllowlist": []
}
```

不得直接把现有用户迁移到 `isolated`。

后续只有在以下条件全部满足后，才可以讨论：

```text
new installations default = isolated
```

条件：

- Capability Spike 完全通过；
- Thin/Full 验证完成；
- 不影响认证；
- 不修改用户全局状态；
- 用户可一键切回 inherit；
- Release Notes 明确说明；
- 现有用户不静默迁移。

### 8.2 Allowlist 身份必须进一步定义

不得只使用 Skill name，因为不同来源可能存在同名 Skill。

建议身份模型：

```ts
interface SkillIdentity {
  readonly source:
    | "system"
    | "user"
    | "repo"
    | "plugin"
    | "extra";
  readonly name: string;
  readonly canonicalPath: string;
}
```

授权要求：

- 优先接受 Runtime inventory 返回的 Skill；
- 对 canonical path 执行 `normalize`；
- 执行 `realpath`；
- 检查已批准 root containment；
- 使用解析后的真实路径授权；
- 防止 symlink 越界；
- Windows 使用适当的大小写比较；
- 统一路径分隔符；
- 不自行扫描任意用户目录；
- 不把 name 单独作为安全身份。

跨设备配置需要另行设计：

- 绝对路径不可移植；
- 路径 hash 同样随机器变化；
- source + name 可能冲突；
- 稳定 ID 必须由 Runtime 提供或由明确、可验证的身份元组生成。

---

## 9. 修订后的任务批准表

| ID | 任务 | 决策 | 条件 |
|---|---|---|---|
| SKILL-000 | 运行时证据采集 | 批准 | 使用增强后的安全诊断字段 |
| SKILL-001 | Warning Classifier | 条件批准 | 000 证明 warning 与有效 response 并存 |
| SKILL-002 | SDK/Runtime 结构化 Warning 检查 | 批准 | SDK 升级必须独立 PR |
| SKILL-003 | 提取副作用与响应验证 | 批准 | 应前置或与 001 合并 |
| SKILL-004 | Description Shortening 测试 | 批准 | 只覆盖已证实 recoverable 类型 |
| SKILL-005 | Skill Omission 分类 | 阻塞 | 等待独立运行时证据 |
| SKILL-006 | 多 Error Item 回归 | 批准 | unknown/fatal 始终 fail closed |
| SKILL-007 | 150+ Skills 复现 | 条件批准 | 使用完全隔离的临时环境 |
| SKILL-100 | Session-level Isolation Spike | 批准研究 | 不增加用户配置 |
| SKILL-101 | Thin/Full 验证 | 批准研究 | 记录 Runtime 版本 |
| SKILL-102 | 三平台验证 | 批准研究 | 明确实测与文档推断差异 |
| SKILL-200–301 | Skill Policy 与诊断 | 阻塞 | 仅 `SKILL-100=SUPPORTED` 后开放 |
| SKILL-400 | 性能基线 | 后续批准 | 不记录用户内容 |
| SKILL-500 | 完整 SCG | 延期 | 必须满足数据门禁 |

---

## 10. 测试计划

### 10.1 Warning Classifier

必须覆盖：

- 完整 description shortening 消息；
- 百分比变化；
- 标点变化；
- 大小写变化；
- 空白和换行变化；
- 附带额外建议；
- 三个稳定片段缺少任意一个；
- 相似但不完整消息；
- 超长消息；
- Skill omission；
- Skill 读取/解析失败；
- 认证错误；
- Runtime 崩溃；
- 未知 error。

### 10.2 Response Validator

必须覆盖：

```text
recoverable warning + valid text
recoverable warning + valid tool calls
recoverable warning + empty final response
recoverable warning + invalid JSON
recoverable warning + unauthorized tool
recoverable warning + invalid tool arguments
recoverable warning + command execution
recoverable warning + file change
recoverable warning + MCP call
recoverable warning + web search
fatal error + valid final response
known warning + unknown fatal error
multiple warnings + valid response
warning before agent message
warning after agent message
```

### 10.3 隐私测试

必须验证：

- Runtime raw message 不写日志；
- 用户路径不写日志；
- Skill name/description 不写日志；
- final response 内容不写诊断；
- prompt、源码、tool arguments/results 不写日志；
- error UI 只显示安全 code/public message；
- 诊断字段不会意外序列化整个 ThreadItem。

### 10.4 Skill Policy

正式实现后覆盖：

- `inherit` 保持当前行为；
- `isolated` 不继承用户 Skills；
- `allowlist` 只允许 inventory 中的显式项目；
- 空 allowlist；
- 非法和不存在路径；
- symlink 越界；
- 大小写绕过；
- Windows 分隔符绕过；
- 同名 Skill 冲突；
- Runtime 不支持；
- Policy Snapshot 不可变；
- 配置变化不影响进行中的请求；
- 不修改用户 `config.toml`；
- 不影响其他 Codex 会话。

---

## 11. 发布与回滚

### 11.1 Patch Release

允许包含：

- SKILL-000；
- SKILL-003；
- 满足证据门槛后的 SKILL-001；
- SKILL-004；
- SKILL-006；
- 自动化测试；
- 安全本地诊断；
- Logger warning 支持。

不得包含：

- isolated；
- allowlist；
- Skill omission 放行；
- SDK 破坏性升级；
- 用户全局配置修改。

发布标准：

- 单元测试全部通过；
- 现有测试无回归；
- build 和 smoke tests 通过；
- 150+ Skills 隔离复现通过；
- 截图场景返回有效回答；
- 真正错误不被吞掉；
- 禁止副作用检查未削弱；
- 无日志隐私泄露；
- Patch 可独立回滚。

### 11.2 Minor Release

仅在 `SKILL-100=SUPPORTED` 后包含：

- `codexSkillsMode`；
- `codexSkillAllowlist`；
- `inherit`；
- `isolated`；
- `allowlist`；
- Show Skill Status；
- 迁移说明。

首个 Minor 默认：

```text
inherit
```

### 11.3 回滚

Warning Classifier 出现误放行：

1. 立即恢复所有 error fatal；
2. 保留安全诊断；
3. 缩小分类条件；
4. 不通过扩大文本匹配修复。

Skill Policy 出现兼容问题：

```text
default = inherit
```

不得通过修改用户全局 Codex 配置完成回滚。

Allowlist 出现路径安全问题：

- 禁用 allowlist 模式；
- 保留 inherit；
- 安全测试通过后再开放。

---

## 12. Definition of Ready

任务开始前必须满足：

- 任务 ID 明确；
- 问题可复现；
- 前置证据满足；
- 修改范围明确；
- 安全边界明确；
- 日志字段完成隐私审核；
- 测试用例明确；
- 不依赖未验证 Runtime 能力；
- 有独立回滚方式。

---

## 13. Definition of Done

任务完成必须满足：

- TypeScript strict check 通过；
- 新增测试通过；
- 原有测试无回归；
- build 和 smoke tests 通过；
- 未知错误保持 fail closed；
- command/file/MCP/web side-effect 检查未削弱；
- Runtime raw message 不进入日志或 UI；
- 不修改用户全局 Codex 配置；
- 文档和 CHANGELOG 更新；
- PR 包含测试证据；
- 可独立回滚。

---

## 14. 最终实施决策

```text
立即执行：
SKILL-000
SKILL-002
SKILL-003

满足运行时证据后执行：
SKILL-001
SKILL-004
SKILL-006

使用完全隔离测试环境后执行：
SKILL-007

批准研究：
SKILL-100
SKILL-101
SKILL-102

继续阻塞：
SKILL-005
SKILL-200 至 SKILL-301

继续延期：
SKILL-500
Description Compressor
Embedding Router
Fixed Skill Token Budget
Standalone SCG Package
```

最终目标不是重复构建 Codex Runtime 的 Skill 平台，而是：

```text
正确处理 Runtime 告警
+
保持 Provider 安全边界
+
在 Runtime 能力允许时提供可选 Skill Policy
+
通过真实数据决定未来架构
```

---

## 15. v2.0 最终复审的剩余修订

本节是对 v2.0 的最终增量审核。以下问题不会推翻总体架构，但应在执行 `SKILL-000`
前写入正式实施方案。

### 15.1 P1：解除 Phase 0A 与 Warning Classifier 的循环依赖

v2.0 的 Phase 0A 诊断结构已经包含：

```ts
recognizedIssueCodes
hasSkillDescriptionShorteningWarning
fatalErrorCount
hasUnknownError
```

生成这些字段需要识别 Skill warning，但正式 Warning Classifier `SKILL-001` 又要求
Phase 0A 证据完成后才开放。

建议在 `SKILL-000` 中增加仅用于观察、绝不改变请求行为的纯函数：

```ts
export function detectRuntimeIssueForDiagnostics(
  item: ThreadItem
): DiagnosticIssueCode | "UNKNOWN_ERROR" | undefined;
```

要求：

- 只生成内部诊断 code；
- 不改变请求成功或失败结果；
- 不吞掉任何 `error` item；
- 不输出 Runtime raw message；
- `SKILL-001` 后续复用同一检测核心，避免维护两套文本匹配；
- 在证据门槛满足前，所有 `error` 仍按原行为 fatal。

### 15.2 P1：诊断性 response validation 必须不改变原行为

Phase 0A 要记录：

```ts
finalResponseValidation:
  | "not_attempted"
  | "valid"
  | "invalid";
```

为了观察 warning 与有效 response 是否并存，诊断层可能需要在原有 error 检查前尝试
解析 `finalResponse`。该尝试必须捕获自身异常，并继续执行原有请求流程。

建议：

```ts
function observeFinalResponseValidation(...):
  "not_attempted" | "valid" | "invalid" {
  try {
    parseBridgeResponse(...);
    return "valid";
  } catch {
    return "invalid";
  }
}
```

硬性约束：

- 诊断解析不向外抛出；
- 不替换原始业务异常；
- 不向日志写入 response 内容；
- 不修改 `allowedTools`；
- 不缓存 parsed response；
- 在 `SKILL-001` 开放前，原有 error item 仍然 fatal。

### 15.3 P1：修正 SKILL-007 的台账依赖

v2.0 的依赖图正确表示：

```text
SKILL-001
    ↓
SKILL-007
```

但任务台账中 `SKILL-007` 的依赖只写了“隔离环境”。应统一为：

```text
SKILL-007 dependencies:
SKILL-001 + isolated synthetic-skill environment
```

这样可以防止执行代理在 Warning Classifier 尚未完成时提前运行集成复现。

### 15.4 P1：删除“不可逆短哈希”表述

普通短哈希并不真正不可逆。用户路径和常见 Skill 目录可以通过字典枚举恢复，截短还会
增加碰撞概率。

诊断身份只允许选择以下机制：

```text
Runtime-provided stable ID
Session-scoped opaque ID
Keyed HMAC identifier
```

如果使用 HMAC：

- 使用 HMAC-SHA-256；
- 密钥必须是每安装随机秘密；
- 密钥存放在 VS Code SecretStorage 或等效安全存储；
- 不得把密钥写入设置、日志、Git 或诊断报告；
- 输出长度至少满足既定碰撞预算。

不允许：

```ts
sha256(canonicalPath).slice(0, 8)
```

如果没有安全身份机制，诊断命令应只显示会话编号，例如：

```text
skill#17
```

### 15.5 P2：将 Patch Release 定义为两个可能结果

如果 Phase 0A 没有证明 warning 与有效 response 并存，`SKILL-001` 不会开放。这时仍可
发布诊断与内部重构，但不能宣称已经修复截图问题。

建议：

```text
Patch A:
SKILL-000 + SKILL-003
只包含安全诊断和内部重构，不改变请求结果

Patch B:
SKILL-001 + SKILL-004 + SKILL-006
仅在证据门槛满足后包含恢复逻辑
```

如果证据门槛及时满足，Patch A 与 Patch B 可以合并发布；否则必须分别处理。

### 15.6 P2：收紧 Turn Status 类型

以下定义：

```ts
turnStatus: string | "unavailable";
```

没有实际类型约束，因为 `"unavailable"` 已经属于 `string`。

如果 SDK 状态集合稳定，建议：

```ts
type ObservedTurnStatus =
  | "completed"
  | "failed"
  | "interrupted"
  | "in_progress"
  | "unavailable"
  | "unknown";
```

如果不同 Runtime 的原始状态无法稳定枚举，则保留原始字符串，但额外提供：

```ts
turnCompleted: true | false | "unknown";
```

不得把未知状态推断成 completed。

### 15.7 v2.0 最终批准清单

```text
批准立即执行：
SKILL-000
SKILL-003
SKILL-002

批准研究：
SKILL-100（必须在 SKILL-002 后）
SKILL-101
SKILL-102

满足运行时证据后批准：
SKILL-001
SKILL-004
SKILL-006

满足分类器完成和完全隔离测试环境后批准：
SKILL-007

继续阻塞：
SKILL-005
SKILL-200 至 SKILL-301

继续延期：
完整 SCG
Description Compressor
Embedding Router
Fixed Skill Token Budget
Standalone SCG Package
```

完成本节六项修订后，方案无需再次进行完整架构审核；后续按任务 ID 进行实现审查即可。
