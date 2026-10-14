# Chatting with AI：学习增强分支

这是 [o1xhack/obsidian-chatting](https://github.com/o1xhack/obsidian-chatting)
的**非官方公开 fork**，基于上游 0.4.2，由
[45645678a](https://github.com/45645678a) 维护。本项目保留原作者署名与 MIT
许可证，不代表原作者、Obsidian 或 AI 服务商的官方版本。

## 增强内容

- 修复 AI 回复中的数学公式分隔符显示，保留代码示例与原始消息。
- 根据模型目录支持的选项调整思考强度，并按模型记住选择。
- 默认只读；切换到可编辑后，先预览、再确认每次笔记修改。
- 从选中文本或当前笔记发起解释、推导和复习等学习操作。
- 按笔记、章节或自由对话保存记录；各对话保留独立草稿和图片。
- 通过“书籍 → 章节 → 小节”选择阅读内容，可自动跟随当前小节。
- 在桌面端截取当前阅读区域并放入草稿，发送前可以查看和移除。
- 折叠助手选项，减少界面占用；支持历史搜索、手动切换和归档。

上游的 Anthropic API、OpenAI API 与实验性的 ChatGPT 账号登录实现继续保留。
实际可用的模型和能力由服务商、账号权限及模型目录决定。

## 安装

本分支要求 **Obsidian 桌面版 1.11.4+**。学习增强流程在 Windows 上使用并验证；
阅读页截图依赖 Electron，因此本分支发布包标记为桌面专用。

1. 从[本仓库 Releases](https://github.com/45645678a/obsidian-chatting/releases/latest)
   下载 `chatting-with-ai-0.4.3.zip`。
2. 将 ZIP 内的 `chatting-with-ai` 文件夹解压到笔记库的 `.obsidian/plugins/`。
3. 重新加载 Obsidian，在社区插件中启用 **Chatting with AI (Study Fork)**。
4. 在插件设置中自行配置服务商、API 密钥或账号登录。

已经安装原版时，先停用插件，再替换代码文件。保留自己的 `data.json`、
`chat-state*.json`、`conversations*.json` 及恢复副本。本分支沿用
`chatting-with-ai` 插件 ID，用于兼容既有数据，因此与原版互为替换，不能用同一个
ID 同时安装两套。原有单段聊天记录会迁入多对话记录。

Obsidian 官方插件列表指向上游仓库。更新这个增强分支时，请使用本仓库的 Release；
从官方列表更新原版可能覆盖本分支的增强功能。

## 使用和数据

推荐采用 `书名/章节/小节.md` 的目录结构。选择小节或启用自动跟随后，聊天会关联
对应笔记；关闭自动跟随即可手动管理。截图按钮的右键菜单仍可选择普通图片文件。

发送消息时，相关笔记上下文、工具读取的内容及发送的图片会交给所选 AI 服务商。
聊天记录、草稿和图片主要保存在插件目录的 `conversations.json` 及恢复副本中；
旧版 `chat-state*.json` 可能在迁移后保留。账号凭据沿用上游的 SecretStorage 实现。
是否被同步或备份取决于个人笔记库配置，这些文件不应提交到公开仓库。

本仓库和发布包仅包含代码、构建配置、文档与许可证，不包含维护者的账号、
聊天记录、私人笔记、阅读截图或本机安装脚本。

## 从源码构建

使用 Node.js 22：

```sh
npm ci
npm run check
npm run package
```

原始 TypeScript/Svelte 源码位于 `src/`，学习增强代码与测试位于 `enhancements/`。
构建时会自动应用经过检查的转换；上游代码位置变化时会报错，要求维护者审查，
不会静默生成一个缺少增强功能的包。详细说明见
[构建与维护文档](docs/FORK_DEVELOPMENT.md)。

测试采用合成样例和模拟服务，不会实际调用个人 AI 账号。`release-assets/` 中生成
安装文件、ZIP、许可证和 SHA-256 校验清单。

## 来源与许可

原项目最早来自 [Omar Shahine](https://github.com/omarshahine/obsidian-chat)，
随后由 [Yuxiao / o1xhack](https://github.com/o1xhack/obsidian-chatting) 继续开发；
上游许可证也列明 Thomas Schierl 的贡献。所有已有版权声明均完整保留。

- [MIT 许可证](LICENSE)
- [来源及修改说明](NOTICE.md)
- [打包依赖的许可证](THIRD_PARTY_NOTICES.md)

维护者：**45645678a**。问题请提交到[本 fork 的 Issues](https://github.com/45645678a/obsidian-chatting/issues)。
