# PR #10 聊天保存整合目标

## 目标与范围

将 Thomas Schierl 的 PR #10 聊天保存修复整合进 Chatting with AI，保留原始提交及作者归属，完成独立审查、回归验证、升级兼容验证和 Obsidian Community 分支检查。通过检查后推进 main 合并与 0.4.1 发布；任何尚未完成的真实设备验证必须明确记录，不能以模拟测试代替。

- 用户授权：2026-10-10 同意执行此前六步流程，并要求使用本文件跟踪进度。
- 工作分支：`codex/pr-10-chat-saving`，从 `origin/main` 创建。
- 基线：`20432c601b48325d18c539c2bcd4a77fd9c0040b`（0.4.0）。
- 来源：<https://github.com/o1xhack/obsidian-chatting/pull/10>。
- 来源提交：`4636fd3fc565bbb4c7bc1ac18546c1cdad2f3857`、`a7574ec3c37b8a286e68d24e6b42b979c98876f8`。
- 整合使用 merge 保留作者的原始提交；维护修正独立提交。
- 本次不接入整个 fork 的登录替换、多会话、语音、MCP 或最低版本变化。

## 完成条件

- [x] StudioSSD 挂载、UUID、逻辑入口、项目路径与可写性检查通过。
- [x] 读取项目规则，建立独立整合分支。
- [x] 接入来源提交并核验作者归属。
- [x] 审查保存、损坏恢复、并发、旧路径读取和回退兼容。
- [x] 在 main 复现新增回归测试失败，在整合分支验证通过。
- [x] 全部测试、TypeScript、Svelte、生产构建和 diff 检查通过。
- [ ] 使用测试 Vault 验证 0.4.0 升级与回退，记录桌面和 iPhone 验证范围。
- [x] 推送分支并建立可审查的整合 PR，CI 通过。
- [ ] 对最终代码完成独立审查，处理全部有效发现。
- [ ] Obsidian Community 对整合分支检查完成，错误处理完毕。
- [x] 更新 Todoist Dev，看板状态符合实际。
- [ ] 合并后 main CI 通过。
- [ ] 独立准备 0.4.1 发布分支、说明和产物；正式发布与 Community release 检查完成。

## 进度与证据

### 2026-10-10 — 开始

工作区原本位于已完成的 `codex/fix-provider-history`，没有未提交更改。已从当前 main 创建新的整合分支；PR #10 固定到上述两个提交。优先完成代码与离线验证，再执行可用的真实 Obsidian 验证和 Community 分支检查。

### 2026-10-10 — 接入与回归

- `835761d` 使用 merge 接入两个原始提交，作者均为 Thomas Schierl；LICENSE 和 README 补充作者贡献。
- main 上来源 8 项测试：7 失败、1 通过；原 PR 上 8 项全通过。
- 独立审查新增四项回归：无有效历史字段的 JSON 对象、孤立损坏副本、同毫秒/时钟回拨保存、旧版本回写后过期副本恢复。修正前四项均失败，修正后全通过。
- 修正后全部 78 项测试通过；TypeScript、Svelte（零错误零警告）、生产构建、diff 检查通过。
- 证据目录：`/Volumes/StudioSSD/Developer/BuildScratch/obsidian-chatting/`，含基线失败和修正前后测试日志。
- Todoist Dev 任务：`6hjF9M778h2gFHr2`，目前 In Progress。
- 桌面 Obsidian 1.13.7 可用；CLI 未启用，使用隔离测试 Vault 验证，不更改用户主 Vault 的插件或数据。

### 2026-10-10 — 审查与外部检查

- 整合 PR：<https://github.com/o1xhack/obsidian-chatting/pull/11>，基于 `c5932c7` 的 CI 已通过；原 PR #10 的 fork workflow 已批准并通过。
- Community preview 已提交 `codex/pr-10-chat-saving`，当前扫描固定到 `c5932c7`；后续代码更新后必须重新检查最终提交。
- 补充损坏历史条目的结构验证，防止合法 JSON 中的空条目使插件启动失败。当前共 79 项测试通过，类型检查、Svelte 和构建通过。
- 代码范围核对：插件 ID、manifest/minAppVersion、providers/auth/UI/settings、旧路径迁移代码均未改变。
- 已创建独立测试 Vault：`/Volumes/StudioSSD/Developer/BuildScratch/obsidian-chatting/pr-10-qa-vault`，只包含模拟数据、0.4.0 基线插件及本地 QA 辅助插件。没有发起真实 AI 请求。
- Obsidian 弹出“信任仓库作者并启用插件”；已在该步骤向用户请求确认，目前等待答复，不能将桌面运行验证标记为完成。
- iPhone 验证尚未执行。代码、桌面、手机、Community 和发布证据分别记录。

### 2026-10-10 — 独立审查修正

- GitHub Codex 独立审查发现跨插件实例的重载保存竞态，以及旧版本回写后 mtime 相同时选错副本，两项均补充回归并修复。
- 保存队列的最后一个 Promise 通过 App 上的 `Symbol.for` 键传递到新加载的插件 bundle；新实例加载和迁移前等待旧实例完成，卸载时停止旧 agent。
- 无 savedAt 的主文件与副本 mtime 相同，明确优先主文件；这避免回退修改被旧副本恢复。在时间精度不足的首次升级中，仍可能选择最后完整主文件而不是更新的副本，属于保守恢复策略，不承诺保留尚未完成的写入。
- 当前共 80 项离线测试通过，包含重新加载第二个 bundle 的回归。Community 在 `c5932c7` 上已 Completed、无错误，只有原有设置 API 的两项兼容建议；已提交 `25f14bd` 扫描，最终修正后需再次扫描。
- `sim-use devices` 可见真实 iPhone，但 Obsidian 属于 App Store 应用，sim-use 不支持其 UI 自动化；没有把模拟器或设备可见状态作为手机 QA 通过证据。

### 2026-10-10 — 当前检查与剩余 gate

- `a0e600e` 保留原始作者提交并完成两项 GitHub 独立审查修正；对应两个 review thread 已 resolved，并重新触发最终提交审查。
- 80 项测试通过；实际 APFS 文件系统上的旧格式恢复、双副本一致、截断恢复、回退回写后再升级测试也通过。后者仍使用模拟 Obsidian host，不等同于桌面应用运行或真机 QA。
- `25f14bd` 的 Community branch scan 已 Completed，无错误，仅原有两项设置 API 兼容建议。更新后的最终 head 需再提交 Community 检查。
- 当前等待用户确认隔离 Vault 的“信任作者并启用插件”提示，随后执行桌面 0.4.0 → 整合版 → 0.4.0 → 整合版验证。
- 正式 main 合并和 0.4.1 发布尚未执行，必须在已声明 QA gate 完成、最终 head 的 CI/review/Community 通过后推进。不得把“已创建 PR”或模拟环境验证称为整个目标完成。

## 未完成事项与限制

- 尚未建立最终整合 PR 或触发 Community 分支检查。
- 作者报告做过桌面 Obsidian 1.14.4 验证；尚未报告手机验证。我们的验证需单独记录。
- GOAL 勾选项只在取得对应证据后更新。
