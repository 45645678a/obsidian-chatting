# PR #14–#18 集成审查与验证

日期：2026-10-11（America/Los_Angeles）。范围为整组合入隔离分支后，自检、真实 Obsidian QA、最终 head CI 和 Community 分支 review；未合入 main、未发布。

## 审查基线

主分支：`de39810793338fc5b2fbc4e061c36b8f0d755f38`。

| PR | 固定 head | 增量审查结果 |
| --- | --- | --- |
| #14 Tool fixes | `f9c8d50286a0dfe7a9d157ef931bea11ad714271` | 缺失 content 拒绝、frontmatter 插入、原子写入、本地日期、非文本读取拒绝及测试均已核对；本层未发现需要补修的问题。 |
| #15 Chat fixes | `845800a1356a604f0c3aa6527298720364b479a6` | 保留历史与响应链、工具参数及问答持久化、视图就绪与 Markdown 生命周期均已审查；补修停止后旧请求解锁新轮次，以及关闭面板时未释放 ask_user。 |
| #16 Provider & settings fixes | `7d2a7cb77187d5366c65035e8ed5793e5e6df3c3` | 状态码重试、配额区别、引用展示、模型列表和设置均已审查；补修自定义 ID 按 Enter 保存，避免重复保存及 IME 确认误触发。 |
| #17 ChatGPT sign-in fixes | `d9ae0fc27bcd764e98bf8aaf295fe855320590f5` | 补修跨凭据刷新共享、旧 401 用新账户重试、Stop 后重试、设备授权取消后保存，以及背景点击标志误吞合法关闭。 |
| #18 Selection scope enforcement | `33c032a1af82bb7dae7123a06b467e036bcb0394` | 补修删除完整选区循环、相同文字误定位、失败写入污染跟踪状态；用编辑器快照支持范围外连续编辑的偏移迁移，遇到修改或歧义拒绝写入。 |

这 5 个 head 构成累积提交链。集成分支 `codex/pr-14-18-review` 从 #18 建立，完整保留作者的 36 个提交。

## 补修提交

- `7e59c99`：#15 聊天停止、并发轮次与关闭面板。
- `ecbb451`：#16 自定义模型 ID 的 Enter 保存。
- `edc723e`：#17 凭据刷新、请求重试、登录取消和背景事件。
- `610c22b`：#18 快照定位、删除和写入失败恢复；同步行为说明。

原始 PR 分支没有被改写。上述补修在集成分支上，合并整组时必须一起包含，不能只合入原 PR 的未修正版本。

## 验证

原始 #18：`npm test` 144/144 通过。

新增回归先复现选区错位、Stop/Clear 旧轮次解锁新轮次、面板关闭等待未释放、自定义模型 Enter 丢失、跨账户 401 重试、Stop 后重试。另覆盖完整删除、失败写入后重试、跨凭据刷新、授权取消与 CRLF 偏移。

补修后：

- `npm test`：159/159 通过，无跳过或取消。
- `npx tsc --noEmit`：通过。
- `npm run svelte-check`：0 errors / 0 warnings。
- `npm run build`：生产构建通过。
- `git diff --check`：通过。

插件 ID、manifest、版本号、依赖锁文件和最低 Obsidian 版本没有变化。

GitHub 上 5 个原始 head 的 check 均成功，GraphQL 回读均没有 review thread。main 的旧式 branch protection 不存在，仓库 rulesets 列表为空。补修分支验证来自本地执行；现有 workflow 只在 PR 和 main push 时触发，不能把原始 head 的绿色检查当作补修 head 的 GitHub CI。

## 合并安排与验证边界

代码审查与离线集成验证完成；它们不能单独证明整组验收完成。真实桌面 QA、最终 head CI 和 Community 分支 review 必须完成后才可交付。建议保留原 PR：按 #14 → #15 → #16 → #17 → #18 合并，并在同一批合入上述补修。保留提交祖先关系可避免后续累积 PR 重复展示历史改动。任何 head 更新或主分支变动都应重新检查合并差异及相关测试。

初始阶段仅完成离线验证。下方补充本轮原生桌面及真实 ChatGPT OAuth 证据；真实 Anthropic/OpenAI API-key、物理 iPhone 与强制进程崩溃仍未验证。

沿用 #18 明确的产品边界：选区约束保护该笔记中的直接写入；其他笔记仍可编辑，重命名其他笔记时 Obsidian 可能更新选区笔记中的链接。快照保存在内存，不写入聊天历史，不发送给模型。连续范围外编辑可迁移；无法确认原选区时要求重新选择。


## 验收流程补齐（2026-10-11）

之前只完成代码与离线检查，未完成本项目既有的真实 QA → Community branch review 流程。已从当前 main 新建 `codex/pr-14-18-integration`，按顺序生成 5 个 merge commit，再应用全部补修。5 个原始 head 均为本分支祖先，生产源代码与原补修分支逐文件一致。

补修在新分支对应 `93d185a`、`a8a848e`、`61e8fbe`、`34dded7`。隔离测试库已有私有备份，1,771 个资料副本有测试前 SHA-256 记录。原生 QA 脚本已准备；目前电脑控制操作无法可靠确认，CLI 也未启用，因此原生测试保持未执行状态，没有提交 Community 扫描来替代自检。


## 原生桌面与真实 OAuth 验证通过

在已授权的隔离测试库执行，原生 API 报告版本为 1.13.7。CLI 用于调用 QA 插件命令、完整窗口重载以及读取真实 DOM 和截图。测试前保留原插件与聊天状态的私有备份。

原生 QA 加载实际生产 main.js；模拟传输时通过独立 `require` 代理注入 requestUrl，不改写 Obsidian 的只读 API 模块。原生 Vault、设置 DOM、登录 Modal、Svelte 组件、插件生命周期和保存均真实执行。模拟模型设置不写入真实 SecretStorage。完成模拟测试后恢复标准插件加载器，再进行窗口重载和真实 OAuth 请求。

- 升级前后的可见聊天、API 历史、provider/model 均保留。
- 实际设置 DOM 的 Enter 事件生效；背景点击不会取消登录，正常关闭仍取消。
- 工具仅修改选区，范围外内容字节保持；整篇替换被拒绝；完整选区删除后不会继续扩大范围。
- 实际 Svelte UI 显示模型回答和工具参数。
- Stop/Clear/关闭面板释放 ask_user；旧请求完成不解锁新轮次，也不显示迟到回答。
- 标准加载器下，完整窗口重载恢复可见/API 历史。
- 真实 ChatGPT OAuth / gpt-6.1-sol 完成 create_file、set_properties、read_file；重载后先回忆标记，再 edit_document 追加标记并读回，无错误。
- 保存的 main/backup 副本相同；1,771 个资料副本的测试前后 SHA-256 全部相同。
- 安装的生产 main.js 与候选构建 SHA-256 均为 `05f72f2a10cec9d94945276d9456eba0eb1d037d2fc96ffbe36299932a82e98f`。

可公开的去敏报告：[原生 QA](pr-14-18-native-qa.json)、[真实 OAuth QA](pr-14-18-live-qa.json)。私有备份、资料文件路径与 OAuth 凭据不提交到仓库。

最初一轮 QA 脚本因只读 requestUrl 赋值失败，没有被记为通过；之后改为独立装载代理。那一轮写入的模拟 provider 设置及聊天已从备份恢复，模拟 key 仅在确认等于本次固定测试值时清除；OAuth SecretStorage 登录保留。后续模拟设置保存使用无副作用替身，以防测试 key 写入真实 SecretStorage。

Community 检查将固定到提交上述证据后的最终 head；当前尚未记为通过。

补充原生桌面 mobile emulation：在 390px 视口下，5 个可见设置控件容器均为 318px，scrollWidth 与实际宽度相同，flex-wrap 为 wrap；没有控件溢出。模拟模式已关闭。这不等同于物理 iPhone 验证。证据：[mobile emulation](pr-14-18-mobile-emulation.json)。
