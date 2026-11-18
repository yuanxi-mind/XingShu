# 来源与第三方声明

星枢 XingShu 1.0.0 是基于 Munder Difflin 的衍生项目，不是从零实现，也不是上游或模型厂商的官方发行版。

## 基础代码

- 上游：https://github.com/chaitanyagiri/munder-difflin
- 原作者：Chaitanya Giri
- 许可：MIT，完整原许可保留于根目录 `LICENSE`。
- 本地接收的源码没有携带上游 Git 历史，无法可靠还原基础提交，故不编造 commit。公开仓库以整理后的 1.0.0 为起点。

本衍生版本主要增加本地 API 多模型协作、项目隔离与中文交互、四盒科研权限、方案采纳与工作副本、独立核查、人工确认发布、证据和版本记忆、基础能力评测、可复现实验包与批准式远程执行、工具断点恢复。

新增代码沿用 MIT；未给未确认身份的个人添加署名。上游代码仍保留其现有版权、注释与许可。仓库中保留部分上游兼容模块和回归夹具，不代表当前公开版本已验收上游的全部功能。

## 界面、美术与字体

| 资源 | 来源 | 许可与说明 |
| --- | --- | --- |
| NextChat SCSS / 图标 | ChatGPTNextWeb/NextChat | `src/renderer/src/vendor/nextchat/` 的 LICENSE 与 NOTICE.md |
| Q 版头像与小伙伴 | fywdy/chatgpt-chibi-pets | CC BY-NC 4.0；完整许可、同人声明与修改说明在 `src/renderer/src/vendor/chibi-pets/` |
| 内置字体 | 各字体原作者 | SIL OFL 1.1；`src/renderer/src/assets/fonts/LICENSE.txt` |
| 星枢应用图标 | 本衍生版本 SVG 图形 | `src/renderer/src/assets/xingshu.svg`，随新增代码使用 MIT |

角色 PNG 为上游图集的静态帧和裁剪图，不是模型厂商官方头像。商业使用前需替换或另行取得这些美术的商业授权，并核实其他素材权利。

依赖包遵循其各自许可，依赖清单见 `package.json` 与锁文件。MIT 不授予商标、模型服务或上游美术的额外权利。
