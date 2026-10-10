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
- [x] 使用测试 Vault 验证 0.4.0 升级与回退，记录桌面和 iPhone 验证范围（桌面通过；iPhone 未验证）。
- [x] 推送分支并建立可审查的整合 PR，CI 通过。
- [x] 对最终代码完成独立审查，处理全部有效发现。
- [x] Obsidian Community 对整合分支检查完成，错误处理完毕。
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

### 2026-10-10 — 延迟回调保护

- 复审发现旧 view 的 provider Promise 在卸载后才返回，其 finally 可能再次发起保存。已添加 unloaded 状态：卸载时排队一次最终保存，然后拒绝旧实例的后续保存请求。
- 新回归确认替代实例保存新会话后，旧实例的延迟收尾不能覆盖它。当前 81 项测试通过，TypeScript、Svelte、生产构建和 diff 检查通过。
- 卸载中仍未加载完的实例也不能在加载结束后恢复保存；对应来源测试保留启动保护场景并修正卸载后的期待。
- 未完成 gate 仍是原生桌面 QA、iPhone QA、最终 head 独立复审/Community；main 合并和正式发布尚未执行。

### 2026-10-10 — 代码 gate 通过，等待原生 QA

- 最终代码 `069ac1bf9b7b1b9c219d23cb01ff378967f1a370`：81 项测试、TypeScript、Svelte、生产构建及 CI 均通过。
- Codex 独立复审在 2026-10-10 11:00 PDT 显示该提交 Completed，并给出 +1；没有新增发现，三个 review thread 全部 resolved。
- Community 同一代码提交的 branch scan 显示 Completed，无错误、无依赖漏洞；只有未更改的旧设置 API 两项兼容建议。
- 已在本地准备 0.4.1 候选产物与 SHA-256 清单：`/Volumes/StudioSSD/Developer/BuildScratch/obsidian-chatting/0.4.1-candidate`。仅为 staging，没有创建 tag、正式 Release 或修改 main 的版本。
- 本次进度记录提交只修改文档；推送后仍会核对最新 head 的 CI、review 和 Community 状态。
- 下一步明确：收到隔离测试 Vault 的插件启用确认后，继续原生桌面测试；完成 iPhone QA，再推进 merge、main CI、独立发布分支和正式发布检查。

## 未完成事项与限制

- 已建立整合 PR #11，代码提交的 CI、独立复审和 Community 分支检查通过；合并前仍需核对最终 head。
- 作者报告做过桌面 Obsidian 1.14.4 验证；尚未报告手机验证。我们的验证需单独记录。
- GOAL 勾选项只在取得对应证据后更新。

### 2026-10-10 — 原生桌面 QA 通过

- 用户要求先测试，并接受在没有额外账号/API 的情况下尽可能扩大验证范围。测试 Vault 的插件已启用，完成真实 Obsidian 1.13.7 桌面验证。
- 顺序执行 0.4.0 基线 → 整合版 → 0.4.0 降级回写 → 整合版；原有聊天和设置保留，截断主文件可恢复，降级后的新聊天不会被过期副本覆盖。
- 重新加载整个测试窗口后，正文、API 续聊历史和设置保留，实际聊天界面显示恢复内容。通过 UI 清空后，两份文件均为空历史，再次重载保持空白。未模拟强制杀进程。
- 原生测试报告：`docs/chat-saving-desktop-qa.json`。安装产物与当前生产 main.js 的 SHA-256 相同；原生测试使用模拟聊天数据，没有发送真实 AI 请求，也没有使用主 Vault。
- 离线 81 项测试再次全部通过，覆盖三个 provider 的模拟响应、工具调用续聊、错误/中断、卸载后延迟保存等场景。
- 真实提供商端到端请求和物理 iPhone 仍未验证，不以离线测试替代。此次按“先测试”的要求完成验证与记录，没有合并 main 或发布版本。

### 2026-10-10 — 共享测试库与真实 OAuth QA

- 用户明确授权只复制主库 `10 Projects` 与 `30 Resources`，不复制 check 类内容，并将测试库命名为“ob 插件测试”，后续用于其他插件与 iPhone。
- 稳定测试路径：`/Volumes/StudioSSD/Obsidian/ob 插件测试`。共复制 1,771 个文件（128,398,973 bytes），保留层级与内部附件；选定树中没有 check/检查/清单类路径。没有复制主库配置或其他目录。
- 每个源文件和副本 SHA-256 相同，且没有共享 inode；真实测试结束后再次核验全部 1,771 个文件均未变化。详细私有清单只留在测试库。
- 使用 Obsidian 自带重命名/移动保留原测试库注册 ID，避免丢失 SecretStorage OAuth 登录。原测试库不再留重复注册项。
- 已用用户登录的 ChatGPT OAuth / gpt-6.1-sol 完成真实多轮工具测试：列出项目、读取复制模板、新建 QA 笔记、窗口重载后回忆历史并续聊、编辑、frontmatter 设置及读回、停止后下一轮继续；两份最终保存文件一致。
- 写入只发生在测试库 QA 区域。公开证据 `docs/chat-saving-oauth-qa.json` 不包含私有正文、文件清单或凭据。
- 真实 iPhone、Anthropic、OpenAI API-key 与强制杀进程仍未验证；当前 main 合并和正式发布未执行。

### 2026-10-10 — 合并与发布授权

- 用户明确授权合并、发布新版本，并在作者 PR #10 通知整合 PR 与发布结果；接受已记录的真实设备验证范围。
- 发布分支 `codex/release-0.4.1` 从已验证整合提交 5fd144d 建立；只更新版本元数据与目标进度，保持作者原始提交、插件身份和 1.11.4 最低版本。
- 合并前重新触发整合提交 5fd144d 的 GitHub 独立复审和 Community preview；不得把 Pending 记为通过。
