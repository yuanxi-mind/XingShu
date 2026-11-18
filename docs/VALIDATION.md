# 验证与截图复现

先使用 README 中的 D 盘环境设置，并执行 `npm ci`。以下命令均在仓库根目录运行。

```powershell
npm run typecheck
npm test
npm run test:release
npm run build
npm run qa:research
npm run qa:intelligence
npm run qa:chat
npm run screenshots
npm run check:public
```

`npm test` 运行科研、API 协作、外观、聊天状态与项目隔离相关回归。Python 默认调用 PATH 中的 `python`（Windows）；可通过 `PYTHON` 指定解释器绝对路径。不会使用某位开发者的固定 Anaconda 路径。完整上游测试另见 `npm run test:legacy`，其中部分旧界面与平台假设不在本版本承诺范围内。

Electron 验收默认启动本仓库 `npm run build` 的输出，使用 npm 安装的 Electron 和 Playwright Core；无需另下载浏览器。也可以用 `MULTI_AGENT_QA_EXECUTABLE` 指向待检的 Windows 目录包。依次运行各套验收，避免同时启动同一单实例程序。`MULTI_AGENT_QA_OUTPUT` 可指定 D 盘报告目录。

## 检查内容

- 公共 baseline 只读、私人盒隔离、单份方案公开、动态实施与独立核查、人工确认与保留历史版本。
- 多模型连接隔离、错误处理、消息立即显示、并发先完成先呈现、多路流不串。
- 证据原文与哈希绑定、文件变化失效、按身份检索记忆。
- 真实归档清单、runner 输入、seed 隔离、错误结果拒绝、远程副作用边界。
- 上下文与工具回执持久化、暂停与重启恢复、拒绝过期续跑。
- 全部 Electron 控制的路径在 D 盘；1440、1100、760 宽度及明暗主题的相关页面无横向溢出，中文实际使用中文字体。

## 截图

`tools/capture-screenshots.cjs` 在 D 盘创建全新的演示根目录，不读取正式项目。模型响应完全拦截，研究代码仅为合成小例子，实验指标仅为固定演示数值。应用页内可见“演示”标记；截图为窗口实际渲染，不是 HTML 营销 mockup。

输出：`docs/screenshots/01-chat.png` 到 `05-benchmark.png`。反例检验卡的截图另由 `npm run qa:intelligence` 生成（验收目录下的 `08-counterexample-card.png`），README 中使用已人工检查的副本。本地报告在忽略的 D 盘验收目录。所有图片需要人工查看后再用于发布。报告包含本地绝对路径，不能随截图一起提交。

## 不能从这些检查推出什么

验收使用隔离中转响应、模拟实验与模拟 Docker 调用：不代表真实收费模型已通过科研评测，不代表真实 GPU 训练完成，也不能证明科学新颖性、指标真实性、无数据泄漏、统计显著性或零幻觉。真实服务器兼容性和研究质量需要另行批准并实测。

本地检查结果记录在 `docs/RELEASE_CHECKS.md`；机器路径和原始运行报告不进入公开仓库。
