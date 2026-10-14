# Chatting with AI — Study Fork

[![Check](https://github.com/45645678a/obsidian-chatting/actions/workflows/check.yml/badge.svg)](https://github.com/45645678a/obsidian-chatting/actions/workflows/check.yml)
[![Release](https://img.shields.io/github/v/release/45645678a/obsidian-chatting)](https://github.com/45645678a/obsidian-chatting/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An **unofficial, desktop-oriented study fork** of
[o1xhack/obsidian-chatting](https://github.com/o1xhack/obsidian-chatting), based on
upstream **0.4.2**. Maintained by [45645678a](https://github.com/45645678a).
Original authorship and the MIT license are retained; see [NOTICE](NOTICE.md).

**[简体中文说明](README.zh-CN.md)** · [Download](https://github.com/45645678a/obsidian-chatting/releases/latest) · [Build and contribute](docs/FORK_DEVELOPMENT.md)

## What this fork adds

- **Math rendering:** converts AI-produced TeX delimiters for Obsidian display while preserving code examples and the original stored message.
- **Reasoning controls:** per-model effort selection using the authenticated model catalog's advertised capabilities.
- **Reviewed editing:** read-only by default; editable mode previews each proposed change before applying it and rejects stale previews.
- **Study shortcuts:** explain selected text, work through derivations, and review the current note.
- **Conversation library:** separate note/chapter/free conversations, persistent drafts and attachments, history, search, and archives.
- **Book navigation:** select a book, chapter, and section from the vault's folder structure, with optional following of the reading note.
- **Reading-pane capture:** attach a screenshot of the selected reading pane on desktop. It is placed in the draft; sending remains a user action.
- **Collapsible options:** keep the reading/chat interface compact.

The upstream Anthropic API, OpenAI API, and experimental ChatGPT account
provider implementations remain available. Provider/account availability and
model capabilities depend on the relevant service; this fork does not imply
official endorsement by Obsidian, OpenAI, Anthropic, or the upstream authors.

## Install this fork

Requires **desktop Obsidian 1.11.4 or later**. The enhanced workflow was used
and validated on Windows desktop. Reading-pane capture uses Electron APIs;
this fork's release manifest is deliberately marked desktop-only.

1. Download `chatting-with-ai-0.4.3.zip` from this repository's [Releases](https://github.com/45645678a/obsidian-chatting/releases/latest).
2. Extract its `chatting-with-ai` directory into `<vault>/.obsidian/plugins/`.
3. Reload Obsidian, then enable **Chatting with AI (Study Fork)** under **Settings → Community plugins**.
4. Choose a provider in the plugin settings and configure your own account or API key. No account configuration is distributed with the plugin.

If the upstream plugin is already installed, disable it before replacing its
code files. Preserve your existing `data.json`, chat databases, and recovery
copies. The plugin ID remains `chatting-with-ai`, so the two versions replace
one another rather than running side by side. Existing single-conversation
history is migrated into the conversation library.

The official Community Plugins listing points to the upstream project.
Install and update **this fork** from this repository's releases; an upstream
community-plugin update can replace these enhancements.

## Reading workflow

Folders such as `Book/Chapter/Section.md` become the book/chapter/section
selectors. Choose a section or turn on automatic following to associate chat
with the note being read. Free conversations and manual history selection
remain available. Turn off automatic following when you want manual control.

The image button captures the visible reading pane on desktop. Its context
menu keeps the ordinary image-file picker available. Captured images remain
attached to the conversation draft until you send or remove them.

## Data and permissions

Notes/context requested for a chat turn and images you send are transmitted
to the selected AI provider. The plugin's read-only setting prevents its
note-writing tools; editable mode requires a preview decision for each change.

Conversation content, draft text, and attached images are stored locally in
the plugin directory, primarily in `conversations.json` and recovery copies.
Legacy `chat-state*.json` files may remain after migration. Credentials use
the upstream Obsidian SecretStorage integration. Vault synchronization and
backups are controlled by your own configuration; do not share or commit
these personal files. This repository and its release archives contain none
of them.

## Build and validate

```sh
git clone https://github.com/45645678a/obsidian-chatting.git
cd obsidian-chatting
npm ci
npm run check
npm run package
```

Use Node.js 22. `npm run check` builds the enhanced bundle, runs the upstream
and enhancement tests, checks TypeScript/Svelte, and reviews release contents.
`npm run package` creates an allowlisted ZIP, standalone installation files,
license notices, and SHA-256 checksums in `release-assets/`.

The added implementation is a checked post-build layer in `enhancements/`;
the original TypeScript/Svelte source remains in `src/`. Transformations fail
when their expected upstream anchors change. See
[development notes](docs/FORK_DEVELOPMENT.md) before upgrading upstream.

Tests use synthetic fixtures and mocked services. They do not send live AI
requests or prove account/provider availability. Source and release contents
are reproducible without access to the maintainer's computer or vault.

## Attribution and license

MIT, with the original copyright notices preserved in [LICENSE](LICENSE).
Upstream authors include **Omar Shahine**, **Yuxiao (o1xhack)**, and
**Thomas Schierl**. The source lineage and fork changes are recorded in
[NOTICE](NOTICE.md); bundled dependency licenses are in
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).

[Historical upstream documentation](docs/UPSTREAM_README.md) is retained for
reference. Its upstream installation and mobile-parity statements do not
describe this desktop fork.
