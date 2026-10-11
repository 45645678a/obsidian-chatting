# Chatting with AI

Agentic AI chat plugin for Obsidian. Simple, mobile-first, three providers (Anthropic + OpenAI + ChatGPT account sign-in).

## Architecture

```
User Input -> Agent Loop -> API Client (requestUrl) -> Anthropic/OpenAI/Codex
                 |                                         |
            Tool Executor  <---  tool_use response  <------+
                 |
         Obsidian Vault APIs (read/edit/search/create)
```

- **API clients** use `requestUrl()` (not `fetch`) because mobile WebViews enforce CORS
- **Anthropic** uses Messages API with adaptive thinking and prompt caching
- **OpenAI** uses Responses API with `previous_response_id` for multi-turn
- **ChatGPT account** uses the ChatGPT/Codex backend with Device Authorization Flow credentials in `SecretStorage`
- **Agent loop** is provider-agnostic: send -> tools -> send -> done
- **UI** is a single Svelte 5 component (`ChatContainer.svelte`) mounted in an `ItemView`

## Project Structure

```
src/
  main.ts                # Plugin entry: commands, views, settings, context menus
  types.ts               # All interfaces and defaults
  settings.ts            # PluginSettingTab with model fetching
  api/
    client.ts            # Dispatcher: routes to anthropic, openai, or ChatGPT OAuth adapter
    anthropic.ts         # Messages API, adaptive thinking, cache_control
    openai.ts            # Responses API, previous_response_id chaining
  tools/
    registry.ts          # 14 tool definitions (JSON Schema)
    executor.ts          # Runs tools against Obsidian Vault APIs
  agent/
    loop.ts              # Core agentic loop with selection scope
    context.ts           # Builds vault context (active file, selection)
    system-prompt.ts     # Static system prompt (KV cache optimized)
  ui/
    chat-view.ts         # ItemView wrapper, mounts Svelte component
    ChatContainer.svelte # All chat UI: messages, input, selection pill
```

## Key Patterns

- **KV cache optimization**: System prompt is static (never includes dynamic context). Dynamic context (active file, selection) goes in the user message after the cached prefix.
- **Anthropic `cache_control`**: Breakpoints on system prompt and last tool definition.
- **Per-provider API keys**: Stored as `chatting-with-ai-api-key-anthropic` / `chatting-with-ai-api-key-openai` in `SecretStorage`.
- **In-memory chat persistence**: `AgentLoop` and `chatHistory` live on the plugin instance, surviving view open/close cycles.
- **Selection scope**: Injected into user message with scoping instructions, and enforced by `executeTool` for that turn: in the selected note only `edit_document` `find_replace` inside the selection (located by its offset and in-memory editor snapshot; changes outside the range can relocate it, while changed or ambiguous selections are refused) succeeds; other changes to that note, or renaming/deleting a folder it is in, are refused. Other notes stay editable.

## Build

```bash
npm install
npm run build          # Production
npm run dev            # Watch mode
npx tsc --noEmit       # Type check
npm run svelte-check   # Svelte check
```

## Tools

| Tool | Obsidian API | Notes |
|------|-------------|-------|
| read_document | `vault.cachedRead()` | Falls back to active file if no path |
| edit_document | `vault.process()` | Atomic read-modify-write |
| search_vault | `getMarkdownFiles()` + `cachedRead()` | Linear scan, capped |
| read_file | `vault.getFileByPath()` + `cachedRead()` | Text files; images and binary files refused |
| create_file | `vault.create()` | Auto-creates parent folders |
| list_files | `vault.getFiles()` | Capped at 100 results |
| rename_file | `fileManager.renameFile()` | Updates all links |
| delete_file | `fileManager.trashFile()` | Respects user trash setting |
| open_document | `workspace.getLeaf().openFile()` | Opens file in editor |
| get_properties | `metadataCache.getFileCache()` | Reads YAML frontmatter |
| set_properties | `fileManager.processFrontMatter()` | Safe YAML merge/remove |
| get_backlinks | `metadataCache.resolvedLinks` | Finds linking notes |
| get_current_datetime | `Date` | User's locale and timezone |
| ask_user | UI callback | Pauses agent loop |

## Debug

Set `DEBUG = true` in `src/agent/loop.ts` to write API calls and errors to `<vault-config-dir>/plugins/chatting-with-ai/debug.log`.
