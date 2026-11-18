# 架构与实现边界

## 执行链

```text
renderer（React / 中文桌面界面）
    ↓ contextBridge 暴露的有限 API
preload → 项目级 IPC
    ↓
ApiCollabManager.forProject(projectId)
    ├─ Provider Adapter → 用户选择的 OpenAI 兼容 API
    ├─ ResearchRuntime → 有轮数限制的模型—工具循环
    ├─ ResearchWorkspaceStore → 四盒 / 代码快照 / 权限 / 原子写入
    ├─ ResearchMemory → 版本化证据索引与词法检索
    ├─ ResearchBenchmark → 独立题目、断言、轨迹与成本状态
    ├─ ResearchExperiments → 可校验归档、多 seed 与回收核验
    ├─ ResearchSshTransport → 人工批准的非 root SSH / Docker
    └─ ResearchJournal → checkpoint / 工具意图与回执
```

## 关键文件

| 位置 | 责任 |
| --- | --- |
| `src/main/storagePaths.ts` | 启动前设置 D 盘应用数据、缓存与临时目录 |
| `src/main/apiCollab.ts` | 连接、项目 Agent、消息路由、并发与项目隔离 |
| `src/main/researchWorkspace.ts` | baseline 版本、私人三盒、方案、授权、修改、核查与发布 |
| `src/main/researchRuntime.ts` / `researchProvider.ts` | 受限工具循环与中转请求 |
| `src/main/researchSources.ts` | 公开来源检索、HTTPS 读取与网络边界 |
| `src/main/researchMemory.ts` | 证据绑定、失效与按身份检索 |
| `src/main/researchBenchmark.ts` / `researchBenchmarkCases.ts` | 6 类基础合成题与执行评分 |
| `src/main/researchExperiments.ts` / `experimentRunner.ts` | 实验归档、Python runner 与结果核验 |
| `src/main/researchSsh.ts` | 指纹校验、远程运行锁、状态与白名单回收 |
| `src/main/researchJournal.ts` | 工具回执、恢复条件与幂等性核对 |
| `src/shared/research*.ts` | 前后端共享结构 |
| `src/renderer/src/ResearchWorkspace.tsx` / `ResearchTools.tsx` | 四盒、方案、评测、证据、实验与续跑入口 |

## 权限和数据

- 新项目不自动继承 Agent、任务、消息、方案、事实或外观；中转连接与密钥可手动复用。
- 公共原始版本对 Agent 工具只读。实施者只改本轮授权的私人副本，修改前核对哈希并备份。
- 私人三盒默认仅本人可用。会议授权的是某份方案及其允许的附件，不是开放整个私人目录。
- 检查者绑定本次采纳清单和实际代码哈希；实施后的文件发生变化会使核查过期。
- 未经人工确认的实验不进入事实盒；发布保留公共历史，旧分支不能覆盖较新的公共版本。
- 科研状态主要使用项目内 JSON、JSONL、文件快照和原子重命名。上游 SQLite 模块仍保留，不能将全部科研数据笼统描述为“存储在 SQLite 中”。

## 四项能力的实际含义

**能力评测：**合成小题观察工具能力，保留中转／模型／参数快照与断言。离线自检只检查评分器。真实评测逐次批准；缺 usage 或价格时成本未知，请求限制不等于账单硬上限。

**证据记忆：**从真实读取的片段与文件哈希连到方案、代码、核查、实验和确认观察。文件变化时标记相关证据过期。当前为中英词法检索和文件索引，不使用向量数据库或图数据库。

**可复现实验：**固定代码清单、归档、依赖、划分文件哈希、镜像 digest、参数、seed 与资源条件。对照不满足条件时拒绝直接计算归因性差值。哈希、人工确认与多个 seed 都不能单独证明无泄漏、指标真实或统计显著。

**安全续跑：**记录模型上下文、待执行工具和回执。已执行并有落盘回执的工具不重放；配置、权限、公共版或代码变化时拒绝过期恢复。不确定副作用停下核对；再次请求模型可能再次计费。

## 当前限制

- 本地 PDF / DOCX 每个最多 30 MB；PDF 来源最多提取前 200 页，扫描 PDF 暂无 OCR。文本按段读取，不宣称无限上下文。
- 科研工具不提供通用终端或任意目录写入，也不直接导出排版论文 PDF / Word。
- 公开论文检索主要读取 Crossref 最近六个月元数据和可取得的正文，GitHub 检索提供仓库元数据；不保证论文收录完整，也不以仓库更新时间代替发表时间。
- 远程 runner 需要用户自备 Linux / Python3 / Docker / 固定 digest 镜像；禁网、只读根、非 root、cap-drop、进程数、CPU、内存与时限限制不构成绝对沙箱。没有自动设置服务器磁盘配额。
- 仓库保留上游 CLI、办公场景和配套测试；当前公开桌面入口与验证重点是本地 API 科研协作。未验收的历史功能不作为发布承诺。
- 所有模型回答都可能出错。系统保留证据、权限与人工关口来降低风险，不保证零幻觉、创新性、提分或论文被接收。
