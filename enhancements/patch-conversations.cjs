'use strict';
const{createConversationSupport}=require('./conversation-support.cjs');
const{mountConversationControls,showConversationHistory}=require('./conversation-ui.cjs');
const{ConversationPluginMethods}=require('./conversation-methods.cjs');
const marker='// Independent note/chapter conversations and history, 2026-10-13.';
function patchConversations(source){
  if(source.includes(marker))throw new Error('Conversation management patch is already present.');
  function replace(before,after){if(source.split(before).length!==2)throw new Error('Unexpected plugin source: '+before.slice(0,110));source=source.replace(before,()=>after);}
  replace('var ChatPlugin = class extends import_obsidian12.Plugin {',marker+'\nvar chatConversations=('+createConversationSupport.toString()+')();\n'+
    mountConversationControls.toString()+'\n'+showConversationHistory.toString()+'\nvar ChatPlugin = class extends import_obsidian12.Plugin {');
  const methods=Object.getOwnPropertyNames(ConversationPluginMethods.prototype).filter(name=>name!=='constructor').map(name=>ConversationPluginMethods.prototype[name].toString()).join('\n');
  replace('  studyControls = new Set();',`  conversationStore = null;
  conversationControls = new Set();
  conversationHistoryModals = new Set();
  conversationChanging = false;
  conversationNavigation = 0;
  conversationSwitch = null;
  pendingConversationRequest = null;
  conversationSaveError = null;
  lastConversationNotePath = null;
${methods}
  studyControls = new Set();`);
  replace('    this.initializeStudyFeatures();','    this.initializeStudyFeatures();\n    this.initializeConversationFeatures();');
  replace('  onunload() {\n    this.cancelStudyPreviews();','  onunload() {\n    this.conversationNavigation++;\n    for(const modal of [...this.conversationHistoryModals])modal.close();\n    for(const control of [...this.conversationControls])control.destroy();\n    this.cancelStudyPreviews();');
  replace('    await this.saveData(toSave);\n    this.refreshStudyControls();','    await this.saveData(toSave);\n    this.refreshConversationControls();\n    this.refreshStudyControls();');
  replace('  settings.optionsExpanded = value.optionsExpanded === true;',
    '  settings.optionsExpanded = value.optionsExpanded === true;\n  settings.conversationScope = chatConversations.kind(value.conversationScope);\n  settings.followActiveNote = value.followActiveNote !== false;');

  replace(`      const state2 = {
        // Which of the two copies is newer when both are whole.
        savedAt: this.lastChatStateSavedAt = Math.max(Date.now(), this.lastChatStateSavedAt + 1),
        chatHistory: this.chatHistory.slice(-100),
        // Cap at 100 UI messages
        agentMessages: this.agent.exportMessages(80)
        // Keep complete API turns
      };`,`      this.captureActiveConversation();
      const state2 = { ...this.conversationStore,
        savedAt: this.lastChatStateSavedAt = Math.max(Date.now(), this.lastChatStateSavedAt + 1)
      };
      if(!chatConversations.validate(state2,isLegacyPersistedChatState))throw new Error("Invalid conversation state; original files were preserved.");`);
  replace('      await adapter.write(this.chatStatePath, json);\n    } catch {\n    }',
    '      await adapter.write(this.chatStatePath, json);\n      this.conversationSaveError=null;\n    } catch(error) {\n      this.conversationSaveError=error;\n      new import_obsidian12.Notice("对话保存失败，请保留当前窗口并稍后重试。");\n    }');
  replace(`    if (state2) {
      this.lastChatStateSavedAt = state2.savedAt ?? 0;
      if (Array.isArray(state2.chatHistory)) {
        this.chatHistory = state2.chatHistory;
      }
      if (Array.isArray(state2.agentMessages)) {
        this.agent.importMessages(state2.agentMessages);
      }
    }
    this.chatHistoryLoaded = true;`,`    this.lastChatStateSavedAt=state2?.savedAt??0;
    const file=chatConversations.currentNote(this.app);
    this.conversationStore=chatConversations.migrate(state2,file?.extension==="md"?file.path:null);
    this.activateConversationRecord(this.activeConversation());
    this.chatHistoryLoaded = true;`);
  replace(`    if (!exists) {
      try {
        return await read(this.legacyChatStatePath);
      } catch {
        return null;
      }
    }`,`    if (!exists) return await this.readLegacyConversationState();`);
  replace('return `${this.pluginDataDir}/chat-state.json`;','return `${this.pluginDataDir}/conversations.json`;');
  replace('return `${this.pluginDataDir}/chat-state.next.json`;','return `${this.pluginDataDir}/conversations.next.json`;');
  replace('const name = `${file === path ? "chat-state" : "chat-state.next"}.corrupt-${Date.now()}.json`;',
    'const name = `${file === path ? "conversations" : "conversations.next"}.corrupt-${Date.now()}.json`;');
  replace('function isPersistedChatState(value) {',`function isPersistedChatState(value) {
  if(value?.schemaVersion===2)return chatConversations.validate(value,isLegacyPersistedChatState);
  return isLegacyPersistedChatState(value);
}
function isLegacyPersistedChatState(value) {`);

  replace('  function getSelection() {\n    return get2(selection);\n  }',`  function getSelection() {
    return get2(selection);
  }
  function getDraft() {
    return {text:get2(inputText),images:get2(attachments).slice(),selection:get2(selection)};
  }
  function restoreDraft(value) {
    const saved=chatConversations.draft(value);
    set(inputText,saved.text);set(attachments,saved.images,true);set(selection,saved.selection,true);
    requestAnimationFrame(autoGrow);
  }`);
  replace('    getSelection,\n    clearSelection\n','    getSelection,\n    getDraft,\n    restoreDraft,\n    clearSelection\n');
  const replayStart=source.indexOf('    for (const msg of this.plugin.chatHistory) {');
  const replayEnd=source.indexOf('    const chatRoot=container.querySelector(".ochatting-container");',replayStart);
  if(replayStart<0||replayEnd<0)throw new Error('Chat replay block missing');
  const replay=source.slice(replayStart,replayEnd);
  replace(replay,'    this.replayConversation();\n');
  replace('  mountChat() {\n    this.studyControl?.destroy();',
    '  mountChat() {\n    this.conversationBar?.destroy();\n    this.conversationOptions?.destroy();\n    this.studyControl?.destroy();');
  replace('      this.studyControl=this.plugin.mountStudyControls(studyHost,true);',`      this.studyControl=this.plugin.mountStudyControls(studyHost,true);
      const conversationBar=doc.createElement("div");chatRoot.insertBefore(conversationBar,options);
      this.conversationBar=this.plugin.mountConversationControls(conversationBar,false);
      const conversationOptions=doc.createElement("div");options.appendChild(conversationOptions);
      this.conversationOptions=this.plugin.mountConversationControls(conversationOptions,true);`);
  replace('  async onClose() {\n    this.studyControl?.destroy();',
    '  async onClose() {\n    this.plugin.captureActiveConversation();\n    this.conversationBar?.destroy();\n    this.conversationOptions?.destroy();\n    this.studyControl?.destroy();');
  replace('    this.handleStop();\n    if (this.chatContainer) {','    this.handleStop(false);\n    if (this.chatContainer) {');
  replace('  /** Programmatically send a message */',`  replayConversation() {
    if(!this.chatContainer)return;
    this.chatContainer.clearMessages();
${replay}
    const record=this.plugin.activeConversation();
    this.displayConversationId=record?.id;
    this.chatContainer.restoreDraft(record?.draft);
    this.plugin.studySelection=record?.draft?.selection??null;
    const scroller=this.contentEl.querySelector(".ochatting-messages");
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(scroller&&this.displayConversationId===record?.id)scroller.scrollTop=record?.scrollTop??0;}));
    const clear=this.contentEl.querySelector(".ochatting-header button");
    if(clear){clear.textContent="清空本对话";clear.setAttribute("aria-label","清空当前对话的消息");}
    this.plugin.refreshStudyControls();this.plugin.refreshConversationControls();
  }
  /** Programmatically send a message */`);
  replace('    const version = ++this.runVersion;\n    const isCurrent = () => version === this.runVersion;',`    if(this.plugin.conversationChanging){
      this.chatContainer.restoreDraft({text:text2,images,selection});
      new import_obsidian9.Notice("正在切换对话，内容已保留在输入框，请稍后发送。");return;
    }
    this.plugin.prepareConversationTurn(selection);
    const version = ++this.runVersion;
    const isCurrent = () => version === this.runVersion;`);
  replace('        void this.plugin.saveChatHistory();\n      }\n    }\n  }',
    '        await this.plugin.finishConversationTurn();\n      }\n    }\n  }');
  replace('  handleStop() {','  handleStop(drain = true) {');
  replace('    void this.plugin.saveChatHistory();\n  }\n  handleClear()',
    '    void this.plugin.saveChatHistory().then(()=>{if(drain)return this.plugin.flushPendingConversation();}).catch(error=>new import_obsidian9.Notice(error.message));\n  }\n  handleClear()');
  replace('    this.plugin.chatHistory = [];','    this.plugin.chatHistory = [];\n    this.plugin.pendingConversationRequest=null;');

  replace('    const context = buildContext(this.app);\n    const contextPrefix = buildContextMessage(context);',`    const context = buildContext(this.app);
    if(this.boundNotePath){if(context.activeFile!==this.boundNotePath)context.selection=null;context.activeFile=this.boundNotePath;}
    let turnDefaultPath=selection?.filePath??context.activeFile;
    const contextPrefix = buildContextMessage(context)+(this.conversationContextLabel?"\\n[Conversation association: "+this.conversationContextLabel+"]":"");`);
  replace('        callbacks.onToolCall(tc.name, tc.input);',
    '        const toolInput=chatConversations.pinInput(tc.name,tc.input,turnDefaultPath);\n        callbacks.onToolCall(tc.name, toolInput);');
  replace('await callbacks.onExecuteTool(tc.name,tc.input,callbacks.onAskUser,scope,writeContext) :\n          await executeTool(this.app,tc.name,tc.input,callbacks.onAskUser,scope);',
    'await callbacks.onExecuteTool(tc.name,toolInput,callbacks.onAskUser,scope,writeContext) :\n          await executeTool(this.app,tc.name,toolInput,callbacks.onAskUser,scope);\n'+
    '        if(!result.isError&&tc.name==="rename_file"&&turnDefaultPath){\n'+
    '          const from=chatConversations.clean(toolInput.path),to=chatConversations.clean(toolInput.new_path);\n'+
    '          if(turnDefaultPath===from||turnDefaultPath.startsWith(from+"/"))turnDefaultPath=to+turnDefaultPath.slice(from.length);\n        }');

  replace('      { name: "笔记修改权限", aliases:',
    '      { name: "独立对话", aliases:["历史对话","Conversations"], render:setting=>this.renderConversationSettings(setting) },\n      { name: "笔记修改权限", aliases:');
  replace('    this.renderStudyAccess(new import_obsidian7.Setting(containerEl));',
    '    this.renderConversationSettings(new import_obsidian7.Setting(containerEl));\n    this.renderStudyAccess(new import_obsidian7.Setting(containerEl));');
  replace('  renderStudyAccess(setting) {',`  renderConversationSettings(setting) {
    this.conversationControl?.destroy();setting.setName("独立对话");setting.settingEl.classList.add("ochatting-conversation-setting");
    const host=setting.controlEl.ownerDocument.createElement("div");setting.controlEl.appendChild(host);
    this.conversationControl=this.plugin.mountConversationControls(host,true);
  }
  renderStudyAccess(setting) {`);
  replace('    super.hide();\n    this.studyControl?.destroy();',
    '    super.hide();\n    this.conversationControl?.destroy();\n    this.conversationControl=null;\n    this.studyControl?.destroy();');
  return source;
}
module.exports={patchConversations,marker};
