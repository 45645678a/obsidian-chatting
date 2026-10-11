/** Desktop-only QA helper, installed only in an already-authorized isolated test vault. */
import { Plugin, Notice, Setting, requestUrl, apiVersion } from 'obsidian';
const obTransport = require('obsidian');
import { executeTool } from '../src/tools/executor';
import { ChatSettingTab, ChatGPTDeviceLoginModal } from '../src/settings';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

declare const __STACK_BUILD_DIR__: string;
const ID = 'chatting-with-ai';
const ROOT = '/Volumes/StudioSSD/Obsidian/ob 插件测试';
const QA = 'QA/PR-14-18';
const requirePass = (condition: unknown, label: string) => { if (!condition) throw new Error(label); };
const waitUntil = async (fn: () => unknown) => { for (let i = 0; i < 300 && !fn(); i++) await new Promise(r => setTimeout(r, 10)); requirePass(fn(), 'wait timed out'); };

export default class NativeStackQA extends Plugin {
  onload() {
    this.addCommand({ id: 'pr-stack-run', name: 'QA PR stack integration', callback: () => { void this.run().catch(e => this.fail(e)); } });
    this.addCommand({ id: 'pr-stack-reload', name: 'QA PR stack reload verification', callback: () => { void this.verifyReload().catch(e => this.fail(e)); } });
  }
  private assertVault() { requirePass((this.app.vault.adapter as any).getBasePath() === ROOT, 'wrong vault'); }
  private async fail(error: Error) {
    await this.app.vault.adapter.write(`${QA}/failure.json`, JSON.stringify({ error: error.message, appVersion: apiVersion }, null, 2));
    new Notice(`PR stack QA FAILED: ${error.message}`, 12000);
  }
  async run() {
    this.assertVault();
    const app = this.app as any, adapter = app.vault.adapter;
    let p = app.plugins.plugins[ID];
    const originalSettings = { ...p.settings };
    const originalHistory = JSON.stringify(p.chatHistory);
    const originalAPI = JSON.stringify(p.agent.exportMessages());
    await app.plugins.disablePlugin(ID);
    await app[Symbol.for('chatting-with-ai-pending-chat-state-write')];
    for (const name of ['main.js', 'styles.css', 'manifest.json']) copyFileSync(join(__STACK_BUILD_DIR__, name), join(ROOT, '.obsidian/plugins', ID, name));
    await app.plugins.enablePlugin(ID);
    p = app.plugins.plugins[ID];
    requirePass(JSON.stringify(p.chatHistory) === originalHistory, 'upgrade changed visible history');
    requirePass(JSON.stringify(p.agent.exportMessages()) === originalAPI, 'upgrade changed API history');
    requirePass(p.settings.provider === originalSettings.provider && p.settings.model === originalSettings.model, 'upgrade changed provider/model');
    const report: any = { appVersion: apiVersion, pluginVersion: p.manifest.version, upgradeHistory: true, upgradeSettings: true, scope: 'native Obsidian desktop with mocked provider transport', checks: [] };
    const note = `${QA}/Selection.md`;
    const initial = 'before task\nselected task\nafter task\n';
    let file = app.vault.getFileByPath(note);
    if (file) await app.vault.process(file, () => initial); else file = await app.vault.create(note, initial);
    const leaf = app.workspace.getLeaf(false); await leaf.openFile(file);
    const view = await p.activateView();
    const priorTransport = requestUrl;
    const settings = { ...p.settings };
    try {
      Object.assign(p.settings, { provider: 'anthropic', apiKey: 'synthetic-qa-key', model: 'claude-sonnet-4-6', enableWebSearch: false });
      const host = document.createElement('div'); document.body.appendChild(host);
      try {
        const tab: any = new ChatSettingTab(app, p);
        tab.renderCustomModel(new Setting(host));
        const input = host.querySelector('input')!; input.value = 'native-custom-model';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        requirePass(p.settings.model === 'native-custom-model', 'native Enter did not save model');
        await p.saveSettings(); p.settings.model = 'claude-sonnet-4-6';
        report.checks.push('native-settings-enter');
      } finally { host.remove(); }
      let cancels = 0;
      const modal = new ChatGPTDeviceLoginModal(app, { deviceAuthId: 'synthetic', userCode: 'QA-CODE', verificationUri: 'https://auth.openai.com/codex/device', intervalMs: 5000 },
        { promise: new Promise(() => {}), cancel: () => { cancels++; } }, () => {});
      modal.open();
      const background = modal.containerEl.querySelector('.modal-bg')!;
      requirePass(background, 'native login backdrop missing');
      background.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      background.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      requirePass(modal.containerEl.isConnected && cancels === 0, 'native backdrop cancelled login');
      modal.close(); requirePass(cancels === 1, 'native normal close ignored');
      report.checks.push('native-login-backdrop-and-close');
      view.clearConversation();
      let calls = 0;
      obTransport.requestUrl = async () => ({ status: 200, headers: {}, json: ++calls === 1 ? { content: [{ type: 'tool_use', id: 'edit', name: 'edit_document', input: { path: note, operation: 'find_replace', find: 'task', content: 'DONE' } }], stop_reason: 'tool_use' } : { content: [{ type: 'text', text: 'NATIVE-STACK-159' }], stop_reason: 'end_turn' } });
      const from = initial.indexOf('task', initial.indexOf('selected'));
      await view.handleUserMessage('Native selection QA', { filePath: note, text: 'task', from, sourceText: initial });
      requirePass(await app.vault.read(file) === 'before task\nselected DONE\nafter task\n', 'selection changed outside bytes');
      requirePass(view.contentEl.textContent.includes('NATIVE-STACK-159'), 'real Svelte answer missing');
      requirePass(view.contentEl.textContent.includes('Parameters'), 'tool parameters missing');
      report.checks.push('selection-tool-native-vault', 'svelte-render', 'tool-card-parameters');
      const changed = await app.vault.read(file);
      const denied = await executeTool(app, 'edit_document', { path: note, operation: 'replace_all', content: 'WRONG' }, async () => '', { filePath: note, text: 'DONE', from: changed.indexOf('DONE'), sourceText: changed });
      requirePass(denied.isError && await app.vault.read(file) === changed, 'whole-note scope bypass');
      const scope = { filePath: note, text: 'DONE', from: changed.indexOf('DONE'), sourceText: changed };
      requirePass(!(await executeTool(app, 'edit_document', { path: note, operation: 'find_replace', find: 'DONE', content: '' }, async () => '', scope)).isError, 'full selection deletion failed');
      requirePass((await executeTool(app, 'edit_document', { path: note, operation: 'find_replace', find: 'after', content: 'WRONG' }, async () => '', scope)).isError, 'deleted selection expanded');
      report.checks.push('scope-refusal', 'whole-selection-deletion');
      // Pending ask_user must be released by Stop, Clear and closing the real view.
      for (const action of ['stop', 'clear', 'close']) {
        view.clearConversation();
        obTransport.requestUrl = async () => ({ status: 200, headers: {}, json: { content: [{ type: 'tool_use', id: 'ask', name: 'ask_user', input: { question: 'NATIVE-ASK-QA' } }], stop_reason: 'tool_use' } });
        const asking = view.handleUserMessage(`Ask QA ${action}`, null);
        await waitUntil(() => view.contentEl.textContent.includes('NATIVE-ASK-QA'));
        if (action === 'stop') view.handleStop(); else if (action === 'clear') view.clearConversation(); else await view.onClose();
        await Promise.race([asking, new Promise((_, reject) => setTimeout(() => reject(new Error('ask_user not released')), 2000))]);
        requirePass(!view.running, `${action} left running`);
        if (action === 'close') await view.onOpen();
        report.checks.push(`ask-user-${action}`);
      }
      view.clearConversation();
      const pending: ((value: any) => void)[] = [];
      obTransport.requestUrl = () => new Promise(resolve => pending.push(resolve));
      const old = view.handleUserMessage('old turn', null); await waitUntil(() => pending.length === 1); view.handleStop();
      const next = view.handleUserMessage('new turn', null); await waitUntil(() => pending.length === 2);
      const answer = (value: string) => ({ status: 200, headers: {}, json: { content: [{ type: 'text', text: value }], stop_reason: 'end_turn' } });
      pending[0](answer('STALE')); await old; requirePass(view.running, 'old completion unlocked new turn');
      requirePass(!view.contentEl.textContent.includes('STALE'), 'old answer displayed');
      pending[1](answer('NATIVE-STACK-RELOAD')); await next;
      await p.saveChatHistory();
      requirePass(await adapter.read('.obsidian/plugins/chatting-with-ai/chat-state.json') === await adapter.read('.obsidian/plugins/chatting-with-ai/chat-state.next.json'), 'persisted copies differ');
      report.checks.push('overlapping-stopped-turns', 'matching-persisted-copies');
    } finally {
      obTransport.requestUrl = priorTransport;
      Object.assign(p.settings, settings);
      await p.saveSettings();
    }
    report.passed = true; report.windowReload = 'pending';
    await adapter.write(`${QA}/native-report.json`, JSON.stringify(report, null, 2));
    new Notice('PR stack native QA PASSED; reload window and run reload verification', 12000);
  }
  async verifyReload() {
    this.assertVault();
    const app = this.app as any, p = app.plugins.plugins[ID], a = app.vault.adapter;
    const view = await p.activateView();
    requirePass(p.chatHistory.some((m: any) => m.text === 'NATIVE-STACK-RELOAD'), 'marker lost after reload');
    requirePass(view.contentEl.textContent.includes('NATIVE-STACK-RELOAD'), 'reloaded Svelte marker missing');
    requirePass(p.agent.exportMessages().some((m: any) => JSON.stringify(m.content).includes('NATIVE-STACK-RELOAD')), 'API history lost');
    const report = JSON.parse(await a.read(`${QA}/native-report.json`));
    report.windowReload = 'passed'; await a.write(`${QA}/native-report.json`, JSON.stringify(report, null, 2));
    new Notice('PR stack QA PASSED: native window reload', 12000);
  }
}
