# 参与开发

1. 先阅读 README、`docs/ARCHITECTURE.md` 和 `SECURITY.md`。
2. 使用 Windows 与 D 盘环境；按 README 先设置临时与缓存目录，再安装依赖。
3. 在隔离 `MULTI_AGENT_ROOT` 中验证修改，不使用真实论文、聊天或中转配置作为夹具。
4. 提交前运行 `npm run typecheck`、`npm test`、`npm run test:release`、`npm run build`、`npm run check:public`；交互修改还需跑相应 Electron 验收并实际查看截图。
5. PR 说明具体问题、行为变化、验证结果及未验证边界。不要上传 `out/`、`dist/`、`node_modules/` 或任何项目运行数据。

请保留第三方署名。不要把未验证创新写成科研事实，不要声称零幻觉或把模拟分数包装为模型排名；不要以提示词替代路径、身份和工具权限验证。

上游完整回归包含历史界面和平台假设，单独通过 `npm run test:legacy` 运行，不在本版本科研回归全通过的声明内。
