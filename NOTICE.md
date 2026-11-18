# 来源与第三方声明

星枢 XingShu 1.0.0 的科研工作流和桌面设计评审技能由本项目设计、实现；仓库同时保留以下第三方代码和资源。本项目不是上游或模型厂商的官方发行版。

## 从 Munder Difflin 复用的基础代码

- 上游：https://github.com/HarnessMD/munder-difflin
- 原作者：Chaitanya Giri
- 许可：MIT，完整原许可保留于根目录 `LICENSE`。
- 本地接收的源码没有携带上游 Git 历史，无法可靠还原基础提交，故不编造 commit。公开仓库以整理后的 1.0.0 为起点。

保留的基础代码包括 `src/main/db.ts` 等状态管理模块、部分 CLI 兼容模块及其回归夹具，原版权、注释和许可仍在。保留这些模块不代表当前版本已验收上游的全部功能。

四盒权限、方案核查、证据记忆、实验包和工具断点恢复的代码定位见 [星枢架构](docs/ARCHITECTURE.md#关键文件)。星枢新增代码和 [桌面产品设计评审技能](.agents/skills/desktop-design-critic/SKILL.md) 按 [MIT](LICENSE) 提供。技能参考文档保留公开资料来源，不打包外部产品截图或角色素材。

## 界面、美术与字体

| 资源 | 来源 | 许可与说明 |
| --- | --- | --- |
| NextChat SCSS / 图标 | ChatGPTNextWeb/NextChat | `src/renderer/src/vendor/nextchat/` 的 LICENSE 与 NOTICE.md |
| Q 版头像与小伙伴 | fywdy/chatgpt-chibi-pets | CC BY-NC 4.0；完整许可、同人声明与修改说明在 `src/renderer/src/vendor/chibi-pets/` |
| 内置字体 | 各字体原作者 | SIL OFL 1.1；`src/renderer/src/assets/fonts/LICENSE.txt` |
| 星枢应用图标 | 本项目设计的 SVG 图形 | `src/renderer/src/assets/xingshu.svg`，随新增代码使用 MIT |

角色 PNG 为上游图集的静态帧和裁剪图，不是模型厂商官方头像。商业使用前需替换或另行取得这些美术的商业授权，并核实其他素材权利。

依赖包遵循其各自许可，依赖清单见 `package.json` 与锁文件。MIT 不授予商标、模型服务或上游美术的额外权利。
