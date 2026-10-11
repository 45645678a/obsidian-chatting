import { ItemView, WorkspaceLeaf, Notice, type App } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import type ChatPlugin from "../main";
import ChatContainer from "./ChatContainer.svelte";
import type { ToolResult, SelectionScope, ImageAttachment } from "../types";
import { getModelDisplayName } from "../settings";

export const VIEW_TYPE_CHAT = "ochatting-view";

const SAVED_INPUT_TEXT = 300;
const SAVED_INPUT_ITEMS = 10;
const SAVED_INPUT_KEYS = 20;

/**
 * A tool call's input as saved with its card, for display only: strings
 * cut to 300 characters, lists to 10 items and objects to 20 keys, so long
 * note content or canvas lists don't bloat `chat-state.json`.
 */
function savedToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const cap = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (value.length <= SAVED_INPUT_TEXT) return value;
      // Don't keep the first half of a surrogate pair (e.g. an emoji).
      const end = /[\uD800-\uDBFF]/.test(value[SAVED_INPUT_TEXT - 1]) ? SAVED_INPUT_TEXT - 1 : SAVED_INPUT_TEXT;
      return `${value.slice(0, end)}... (${value.length} characters)`;
    }
    if (Array.isArray(value)) {
      const items = value.slice(0, SAVED_INPUT_ITEMS).map(cap);
      return value.length > SAVED_INPUT_ITEMS ? [...items, `... (${value.length - SAVED_INPUT_ITEMS} more)`] : items;
    }
    if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value);
      const kept = Object.fromEntries(entries.slice(0, SAVED_INPUT_KEYS).map(([key, item]) => [key, cap(item)]));
      if (entries.length > SAVED_INPUT_KEYS) kept["..."] = `(${entries.length - SAVED_INPUT_KEYS} more)`;
      return kept;
    }
    return value;
  };
  return cap(input) as Record<string, unknown>;
}

interface ChatContainerProps {
  app: App;
  component: ObsidianChatView;
  provider: string;
  model: string;
  onSend: (text: string, selection: SelectionScope | null, images: ImageAttachment[]) => void;
  onClear: () => void;
  onStop: () => void;
}

interface ChatContainerApi extends Record<string, unknown> {
  addUserMessage(text: string, images?: ImageAttachment[]): void;
  addAssistantMessage(text: string): void;
  addToolCall(name: string, input: Record<string, unknown>): number;
  updateToolResult(msgId: number, name: string, result: ToolResult): void;
  addError(text: string): void;
  showThinking(): void;
  hideThinking(): void;
  showAskUser(question: string): Promise<string>;
  cancelAskUser(): void;
  setInputEnabled(enabled: boolean): void;
  clearMessages(): void;
  focus(): void;
  setModel(name: string): void;
  setSelection(selection: SelectionScope): void;
  getSelection(): SelectionScope | null;
}

/**
 * Chat view for Chatting with AI.
 * Desktop: right sidebar. Mobile: right sidebar (slides in from edge).
 * Uses the plugin's shared AgentLoop and chatHistory so conversations
 * survive the view being closed and reopened (e.g. sidebar toggle).
 */
export class ObsidianChatView extends ItemView {
  private plugin: ChatPlugin;
  private chatContainer: ChatContainerApi | undefined;
  private running = false;
  private runVersion = 0;
  /** Resolves once onOpen() has mounted the chat UI, or failed to. */
  readonly ready: Promise<void>;
  private markReady!: () => void;

  constructor(leaf: WorkspaceLeaf, plugin: ChatPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.ready = new Promise((resolve) => { this.markReady = resolve; });
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    // Distinct from upstream "Chat" tab so users running both plugins
    // side-by-side can tell the workspace tabs apart.
    return "Chatting with AI";
  }

  getIcon(): string {
    return "message-circle";
  }

  async onOpen(): Promise<void> {
    try {
      this.mountChat();
    } finally {
      // Also when mounting failed: commands waiting for the view go on
      // (its methods do nothing without the UI) instead of waiting forever.
      this.markReady();
    }
  }

  private mountChat(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ochatting-view-container");

    this.chatContainer = mount<ChatContainerProps, ChatContainerApi>(
      ChatContainer as unknown as Component<ChatContainerProps, ChatContainerApi>,
      {
      target: container,
      props: {
        app: this.app,
        component: this,
        provider: this.plugin.settings.provider,
        model: getModelDisplayName(this.plugin.settings.provider, this.plugin.settings.model),
        onSend: (text: string, selection: SelectionScope | null, images: ImageAttachment[]) => {
          void this.handleUserMessage(text, selection, images);
        },
        onClear: () => this.handleClear(),
        onStop: () => this.handleStop(),
      },
    });

    // Replay chat history into the UI
    for (const msg of this.plugin.chatHistory) {
      switch (msg.type) {
        case "user":
          this.chatContainer.addUserMessage(msg.text!, msg.images);
          break;
        case "assistant":
          this.chatContainer.addAssistantMessage(msg.text!);
          break;
        case "tool-result":
          if (msg.toolName && msg.toolResult) {
            const id = this.chatContainer.addToolCall(msg.toolName, msg.toolInput || {});
            this.chatContainer.updateToolResult(id, msg.toolName, msg.toolResult);
          }
          break;
        case "error":
          this.chatContainer.addError(msg.text!);
          break;
      }
    }

    this.chatContainer.focus();
  }

  async onClose(): Promise<void> {
    this.handleStop();
    if (this.chatContainer) {
      await unmount(this.chatContainer);
      this.chatContainer = undefined;
    }
  }

  /** Programmatically send a message */
  sendMessage(text: string): void {
    void this.handleUserMessage(text, this.chatContainer?.getSelection() ?? null);
  }

  /** Set the selection scope and show the pill */
  setSelection(selection: SelectionScope): void {
    this.chatContainer?.setSelection(selection);
  }

  /** Focus the input */
  focus(): void {
    this.chatContainer?.focus();
  }

  /** Update the model display name in the header */
  updateModel(name: string): void {
    this.chatContainer?.setModel(name);
  }

  /** Clear conversation */
  clearConversation(): void {
    this.handleClear();
  }

  private async handleUserMessage(
    text: string,
    selection: SelectionScope | null,
    images: ImageAttachment[] = []
  ): Promise<void> {
    if (this.running) {
      new Notice("Please wait for the current response to complete.");
      return;
    }

    const chat = this.chatContainer;
    if (!chat) {
      // No UI (mounting it failed): nothing to show the turn in.
      new Notice("The chat panel couldn't be shown, so the message wasn't sent.");
      return;
    }
    const version = ++this.runVersion;
    const isCurrent = () => version === this.runVersion;
    const history = this.plugin.chatHistory;

    this.running = true;
    chat.addUserMessage(text, images);
    history.push({ type: "user", text, images });
    chat.setInputEnabled(false);

    const toolCalls = new Map<string, { id: number; input: Record<string, unknown> }>();

    try {
      await this.plugin.agent.run(text, {
        onThinking: () => {
          chat.showThinking();
        },
        onToolCall: (name, input) => {
          chat.hideThinking();
          if (name === "ask_user") return;
          toolCalls.set(name, { id: chat.addToolCall(name, input), input });
        },
        onToolResult: (name, result: ToolResult) => {
          if (name === "ask_user") return;
          const call = toolCalls.get(name);
          if (call) chat.updateToolResult(call.id, name, result);
          history.push({ type: "tool-result", toolName: name, toolInput: savedToolInput(call?.input ?? {}), toolResult: result });
        },
        onResponse: (text) => {
          chat.hideThinking();
          chat.addAssistantMessage(text);
          history.push({ type: "assistant", text });
        },
        onAskUser: async (question) => {
          chat.hideThinking();
          chat.setInputEnabled(true);
          // The chat shows the question and the typed answer; keep both in
          // the history so they are still there after a reload.
          history.push({ type: "assistant", text: question });
          const answer = await chat.showAskUser(question);
          // Empty: Stop or Clear dropped the question.
          if (!answer || !isCurrent()) return "";
          history.push({ type: "user", text: answer });
          chat.setInputEnabled(false);
          return answer;
        },
        onError: (error) => {
          chat.hideThinking();
          chat.addError(error);
          history.push({ type: "error", text: error });
        },
      }, selection, images);
    } catch (e) {
      if (!isCurrent()) return;
      const msg = e instanceof Error ? e.message : String(e);
      chat.addError(`Unexpected error: ${msg}`);
      history.push({ type: "error", text: `Unexpected error: ${msg}` });
    } finally {
      if (isCurrent()) {
        this.running = false;
        chat.setInputEnabled(true);
        chat.focus();
        // Persist after each turn
        void this.plugin.saveChatHistory();
      }
    }
  }

  private handleStop(): void {
    this.runVersion++;
    this.plugin.agent.abort();
    this.running = false;
    const chat = this.chatContainer;
    if (chat) {
      // Otherwise the next message would answer the stopped turn's question.
      chat.cancelAskUser();
      chat.hideThinking();
      chat.setInputEnabled(true);
      chat.focus();
    }
    void this.plugin.saveChatHistory();
  }

  private handleClear(): void {
    this.runVersion++;
    this.plugin.agent.clear();
    this.plugin.chatHistory = [];
    this.chatContainer?.clearMessages();
    this.chatContainer?.cancelAskUser();
    this.running = false;
    this.chatContainer?.setInputEnabled(true);
    // Clear persisted state
    void this.plugin.saveChatHistory();
  }
}
