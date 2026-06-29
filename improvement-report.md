# LLM Wiki 项目改进报告

**生成日期**：2026-06-29\
**项目版本**：v0.4.24\
**报告范围**：2026年6月17日至2026年6月29日期间的改进内容

***

## 一、项目概述

LLM Wiki 是一款基于 AI 的本地知识库管理应用，采用 React 19 + TypeScript + Vite 8 前端技术栈，Rust + LanceDB 后端技术栈，通过 Tauri 2 框架构建桌面应用。本次改进周期内，项目在功能增强、性能优化、Bug修复和配置优化等方面取得了显著进展。

### 核心改进统计

| 类别    | 改进数量 | 涉及文件数 |
| ----- | ---- | ----- |
| 功能增强  | 3项   | 20+   |
| Bug修复 | 3项   | 15+   |
| 配置优化  | 2项   | 5+    |
| 代码质量  | 1项   | 3+    |

***

## 二、LLM 配置优化

### 2.1 分层 LLM 策略

为降低使用成本并提升性能，项目采用了"主LLM + 辅助LLM"的分层策略：

| 任务类型        | 推荐模型                | 模型用途           |
| ----------- | ------------------- | -------------- |
| **文档分析与聊天** | DeepSeek (高性能)      | 核心业务任务，需要高质量输出 |
| **图像字幕生成**  | 智谱 glm-4v-plus      | 辅助任务，需要视觉理解能力  |
| **嵌入向量生成**  | 智谱 text-embedding-3 | 辅助任务，需要高质量向量表示 |

### 2.2 配置实现

**关键约束**：

- 图像字幕任务必须使用视觉模型，不能使用纯文本模型（如 GLM-4-Flash）
- 嵌入向量任务使用专用嵌入模型，不使用主LLM
- 辅助LLM选择免费或低成本模型，降低运行成本

**配置文件路径**：

- 设置界面：[src/components/settings/settings-view.tsx](src/components/settings/settings-view.tsx)
- 嵌入配置：[src/components/settings/sections/embedding-section.tsx](src/components/settings/sections/embedding-section.tsx)
- 图像字幕配置：[src/components/settings/sections/multimodal-section.tsx](src/components/settings/sections/multimodal-section.tsx)

### 2.3 效果评估

```
配置前：
├── 主LLM: DeepSeek (高性能)
└── 辅助任务: 未配置，使用主LLM处理

配置后：
├── 主LLM: DeepSeek (高性能) → 核心任务
├── 图像字幕: 智谱 glm-4v-plus → 低成本视觉任务
└── 嵌入向量: 智谱 text-embedding-3 → 免费嵌入任务
```

***

## 三、深度研究功能修复

### 3.1 问题描述

**问题**：用户勾选免费外部信息源（Wikipedia/arXiv/Academic）后，执行深度研究时弹出"信息源未配置"的提示框，导致功能无法正常使用。

**影响范围**：所有使用免费信息源进行深度研究的用户场景。

### 3.2 根因分析

原 `hasConfiguredDeepResearchSources` 函数仅检查了 Web Search 和 AnyTXT 两种付费/配置型信息源，未包含免费外部信息源（`deepResearchExternalSources`）的判断逻辑。

### 3.3 修复方案

修改 [src/lib/web-search.ts](src/lib/web-search.ts) 文件，扩展判断逻辑以包含免费外部信息源：

```typescript
export function hasConfiguredDeepResearchSources(config: SearchApiConfig): boolean {
  const resolved = resolveSearchConfig(config)
  const source = resolved.deepResearchSource ?? "web"
  const webConfigured = hasConfiguredSearchProvider(resolved)
  const anyTxtConfigured = hasConfiguredAnyTxt(resolved.anyTxt)
  
  const externalSourcesConfigured = (resolved.deepResearchExternalSources?.length ?? 0) > 0

  if (source === "web") return webConfigured || externalSourcesConfigured
  if (source === "anytxt") return anyTxtConfigured || externalSourcesConfigured
  return webConfigured || anyTxtConfigured || externalSourcesConfigured
}
```

**关键改动**：新增 `externalSourcesConfigured` 变量，通过检查 `deepResearchExternalSources` 数组长度是否大于0来判断是否配置了免费外部信息源（如 Wikipedia、arXiv、Academic），并在各分支判断中加入该条件。

<br />

## 四、飞书导入功能

### 4.1 功能概述

新增飞书云文档导入功能，支持将飞书文档批量导入到 LLM Wiki 知识库中，实现跨平台文档迁移和知识整合。

### 4.2 实现架构

```
飞书导入流程：
┌──────────────┐    API调用    ┌──────────────┐    解析转换    ┌──────────────┐
│  飞书云文档   │ ──────────────> │  飞书API客户端  │ ──────────────> │  LLM Wiki    │
│  (Doc/Sheet) │                │  (feishu.rs)  │                │  知识库存储   │
└──────────────┘                └──────────────┘                └──────────────┘
```

### 4.3 涉及文件

| 文件路径                                                                                                                     | 职责说明             |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [scripts/feishu\_import.py](scripts/feishu_import.py)                                                                    | Python 辅助导入脚本    |
| [src-tauri/src/commands/feishu.rs](src-tauri/src/commands/feishu.rs)                                                     | Rust 后端飞书 API 调用 |
| [src/components/settings/sections/feishu-import-section.tsx](src/components/settings/sections/feishu-import-section.tsx) | 前端设置界面           |

### 4.4 功能特点

- 支持飞书文档（Docx）和电子表格（Sheet）导入
- 批量导入支持，可一次性导入多个文档
- 自动格式转换，将飞书格式转换为 Markdown
- 保留文档结构和层级关系

***

## 五、轻量 LLM 设置

### 5.1 功能概述

新增轻量 LLM 设置功能，允许用户配置独立的轻量级模型用于低优先级任务，进一步降低使用成本。

### 5.2 实现方式

通过新增设置面板 [src/components/settings/sections/light-llm-section.tsx](src/components/settings/sections/light-llm-section.tsx)，用户可以：

1. 启用/禁用轻量 LLM
2. 配置轻量 LLM 的 API 端点和模型
3. 设置轻量 LLM 的上下文大小
4. 指定哪些任务使用轻量 LLM

### 5.3 使用场景

| 场景     | 推荐模型            | 成本效益 |
| ------ | --------------- | ---- |
| 文档摘要生成 | 智谱 GLM-4-Flash  | 低    |
| 简单问答   | 智谱 GLM-4-Flash  | 低    |
| 内容分类   | 智谱 GLM-4-Flash  | 低    |
| 复杂分析   | DeepSeek (主LLM) | 高    |

***

## 六、外部资源管理和 Web 搜索增强

### 6.1 功能增强

通过提交 `6054bac` 实现了以下增强：

| 增强项      | 涉及文件                                                                     | 说明             |
| -------- | ------------------------------------------------------------------------ | -------------- |
| 外部资源管理优化 | [src/lib/external-sources.ts](src/lib/external-sources.ts)               | 完善外部信息源配置和管理逻辑 |
| Web 搜索增强 | [src/lib/web-search.ts](src/lib/web-search.ts)                           | 增强搜索结果处理和过滤能力  |
| 深度研究流程优化 | [src/lib/deep-research.ts](src/lib/deep-research.ts)                     | 优化研究流程和结果整合    |
| 聊天输入增强   | [src/components/chat/chat-input.tsx](src/components/chat/chat-input.tsx) | 改进聊天输入体验       |

### 6.2 Web 搜索配置

新增 [src/components/settings/sections/web-search-section.tsx](src/components/settings/sections/web-search-section.tsx) 设置面板，支持：

- 配置 Web Search API 密钥
- 设置搜索结果数量
- 配置搜索区域和语言
- 启用/禁用安全搜索

***

## 七、Bug 修复

### 7.1 一键修复 Lint 问题

**问题**：Lint 检查结果无法一键修复，用户需要手动逐个处理。

**修复**：改进 [src/components/lint/lint-view.tsx](src/components/lint/lint-view.tsx) 组件，添加批量修复功能。

### 7.2 修复打开编辑无响应

**问题**：在某些情况下，打开文档编辑器时界面无响应，且语义lint的page字段误用LLM标题而非affectedPages路径，导致打开编辑指向错误路径。

**修复**：

- [src/components/lint/lint-view.tsx](src/components/lint/lint-view.tsx)：修复语义lint的page字段误用问题，打开编辑不再指向错误路径
- [src/components/review/review-view.tsx](src/components/review/review-view.tsx)：修复 open 分支在文件未找到时掉入 actionLooksLikeCreate 导致静默失败，添加 error fallback
- [src/stores/wiki-store.ts](src/stores/wiki-store.ts)：新增 previousView 状态追踪

### 7.3 修复预览返回按钮

**问题**：文档预览页面的返回按钮功能异常，无法正确返回上一页。

**修复**：

- [src/stores/wiki-store.ts](src/stores/wiki-store.ts)：新增 previousView 状态追踪，openFileInPreview 时记录来源视图
- [src/components/layout/preview-panel.tsx](src/components/layout/preview-panel.tsx)：从 review/lint 跳转到预览时显示←返回按钮，点击回到来源面板

***

## 八、代码质量与文档改进

### 8.1 项目分析报告

生成了详细的项目分析报告 [project-analysis.md](project-analysis.md)，涵盖：

- 技术栈分析（React 19、TypeScript、Vite 8、Tauri 2、Rust、LanceDB）
- 项目结构详解
- 核心模块功能说明
- 代码质量评估
- 扩展建议

### 8.2 配置文件更新

同步更新了 `.gitignore`、`package-lock.json` 等配置文件，确保项目构建和依赖管理的一致性。

***

## 九、国际化支持

### 9.1 多语言支持

项目支持中英文双语界面，通过以下文件实现：

| 文件路径                                 | 语言      | 说明   |
| ------------------------------------ | ------- | ---- |
| [src/i18n/en.json](src/i18n/en.json) | English | 英文翻译 |
| [src/i18n/zh.json](src/i18n/zh.json) | 中文      | 中文翻译 |

### 9.2 新增翻译内容

本次改进周期内，新增了以下功能的翻译支持：

- 飞书导入相关界面
- 轻量 LLM 设置界面
- Web 搜索设置界面
- 外部资源管理界面

***

## 十、当前状态

### 10.1 服务运行状态

| 服务          | 地址                              | 状态    |
| ----------- | ------------------------------- | ----- |
| Vite 开发服务器  | <http://localhost:1420/>        | ✅ 运行中 |
| Clip Server | <http://127.0.0.1:19827>        | ✅ 运行中 |
| API Server  | <http://127.0.0.1:19828/api/v1> | ✅ 运行中 |

### 10.2 代码提交状态

```
最新提交: 6054bac feat: 添加外部资源管理和Web搜索增强功能
分支: main
远程同步: ✅ 已推送到 https://github.com/cloudy1144/llm_wiki.git
```

### 10.3 待办事项

| 优先级 | 事项                  | 状态  |
| --- | ------------------- | --- |
| 高   | 飞书导入功能完善和测试         | 进行中 |
| 中   | Web Search API 配置完善 | 待处理 |
| 中   | 性能优化（知识库查询速度）       | 待处理 |
| 低   | 移动端适配               | 待评估 |

***

## 十一、总结

本次改进周期（2026年6月17日至2026年6月29日）内，LLM Wiki 项目取得了以下主要成果：

1. **LLM 配置优化**：建立了分层策略，图像字幕使用智谱 glm-4v-plus，嵌入向量使用智谱 text-embedding-3，显著降低使用成本。
2. **功能增强**：
   - 新增飞书导入功能，支持跨平台文档迁移
   - 新增轻量 LLM 设置，进一步优化成本控制
   - 增强外部资源管理和 Web 搜索功能
3. **Bug 修复**：
   - 修复深度研究免费信息源配置判断问题
   - 修复 Lint 一键修复功能
   - 修复编辑器无响应和预览返回按钮问题
4. **代码质量**：生成了项目分析报告，更新了配置文件和文档。

项目当前运行稳定，所有服务正常启动，代码已同步到 GitHub 远程仓库。
