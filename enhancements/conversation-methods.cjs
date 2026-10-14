'use strict';

class ConversationPluginMethods {
  activeConversation(){return this.conversationStore?.conversations.find(c=>c.id===this.conversationStore.activeId)??null;}
  conversationNotePath(){
    const file=chatConversations.currentNote(this.app);
    return file?.extension==='md'?file.path:this.lastConversationNotePath??this.activeConversation()?.lastNotePath??null;
  }
  captureActiveConversation(){
    const record=this.activeConversation();if(!record)return;
    record.chatHistory=this.chatHistory.slice();record.agentMessages=this.agent.exportMessages(80).slice();record.updatedAt=Date.now();
    const view=this.getChatView();
    if(view?.chatContainer&&view.displayConversationId===record.id){
      record.draft=chatConversations.draft(view.chatContainer.getDraft());
      record.scrollTop=Math.max(0,view.contentEl.querySelector('.ochatting-messages')?.scrollTop??0);
    }
  }
  activateConversationRecord(record){
    this.conversationStore.activeId=record.id;record.archived=false;
    this.conversationStore.routes[chatConversations.key(record.kind,record.path)]=record.id;
    this.chatHistory=record.chatHistory;
    this.agent=new AgentLoop(this.app,this.settings);this.agent.importMessages(record.agentMessages);
    this.studySelection=record.draft?.selection??null;this.prepareConversationTurn();
  }
  prepareConversationTurn(selection){
    const record=this.activeConversation();if(!record)return;
    let path=record.kind==='note'?record.path:null;
    if(record.kind==='chapter'){
      const current=this.conversationNotePath();
      if(current&&chatConversations.parent(current)===record.path)record.lastNotePath=current;
      path=record.lastNotePath;
    }
    if(selection?.filePath)path=selection.filePath;
    this.agent.boundNotePath=path;
    this.agent.conversationContextLabel=record.kind==='free'?'自由对话':chatConversations.label(record.kind)+'：'+record.path;
  }
  mountConversationControls(host,settingsOnly=false){const control=mountConversationControls(this,host,settingsOnly);this.conversationControls.add(control);return control;}
  refreshConversationControls(){
    for(const control of [...this.conversationControls]){if(control.element.isConnected)control.update();else control.destroy();}
  }
  requestConversation(request){
    const navigation=++this.conversationNavigation;
    const perform=async()=>{
      if(this.unloaded||navigation!==this.conversationNavigation)return{skipped:true};
      if(!this.chatHistoryLoaded||!this.conversationStore)throw new Error('聊天记录尚未成功读取，暂不能切换对话。');
      const view=this.getChatView();
      if(view?.running||this.pendingStudyPreviews.size){
        this.pendingConversationRequest={...request};this.refreshConversationControls();return{queued:true};
      }
      const existing=request.id?this.conversationStore.conversations.find(c=>c.id===request.id):null;
      if(request.id&&!existing)throw new Error('找不到这段历史对话。');
      if(existing?.id===this.conversationStore.activeId&&!existing.archived){this.pendingConversationRequest=null;this.settings.conversationScope=existing.kind;await this.saveSettings();this.refreshConversationControls();return{unchanged:true};}
      this.conversationChanging=true;view?.chatContainer?.setInputEnabled(false);this.refreshConversationControls();
      try{
        this.captureActiveConversation();await this.saveChatHistory();
        if(this.conversationSaveError)throw new Error('对话保存失败，已保留当前对话，请稍后重试。');
        if(this.unloaded||navigation!==this.conversationNavigation)return{skipped:true};
        const record=existing??chatConversations.resolve(this.conversationStore,request.target,request.fresh===true);
        if(request.target?.lastNotePath)record.lastNotePath=request.target.lastNotePath;
        this.activateConversationRecord(record);this.settings.conversationScope=record.kind;this.pendingConversationRequest=null;
        view?.replayConversation();await this.saveSettings();await this.saveChatHistory();
        if(this.conversationSaveError)throw new Error('对话暂未写入磁盘，请保留窗口并稍后重试。');
        return{activeId:record.id};
      }finally{
        this.conversationChanging=false;this.getChatView()?.chatContainer?.setInputEnabled(true);
        this.refreshConversationControls();this.refreshStudyControls();
      }
    };
    this.conversationSwitch=(this.conversationSwitch??Promise.resolve()).catch(()=>{}).then(perform);
    return this.conversationSwitch;
  }
  async flushPendingConversation(){
    if(this.unloaded||!this.pendingConversationRequest||this.getChatView()?.running)return;
    const request=this.pendingConversationRequest;this.pendingConversationRequest=null;
    await this.requestConversation(request);
  }
  async finishConversationTurn(){await this.saveChatHistory();this.refreshConversationControls();await this.flushPendingConversation();}
  async followConversationFile(file){
    if(!file||file.extension!=='md')return;this.lastConversationNotePath=file.path;
    if(this.settings.followActiveNote===false||this.settings.conversationScope==='free')return;
    const descriptor=chatConversations.target(this.settings.conversationScope,file.path);
    const active=this.activeConversation();
    if(active&&chatConversations.key(active.kind,active.path)===chatConversations.key(descriptor.kind,descriptor.path)){
      active.lastNotePath=file.path;this.pendingConversationRequest=null;this.conversationNavigation++;this.refreshConversationControls();return;
    }
    await this.requestConversation({target:descriptor,automatic:true});
  }
  async setConversationScope(value){
    this.settings.conversationScope=chatConversations.kind(value);await this.saveSettings();
    await this.requestConversation({target:chatConversations.target(this.settings.conversationScope,this.conversationNotePath())});
  }
  async setConversationFollow(value){
    this.settings.followActiveNote=value===true;await this.saveSettings();
    if(value)await this.followConversationFile(this.app.workspace.getActiveFile());
  }
  async newConversation(){
    const active=this.activeConversation();
    const descriptor=active?{kind:active.kind,path:active.path,lastNotePath:active.lastNotePath}:
      chatConversations.target(this.settings.conversationScope,this.conversationNotePath());
    await this.requestConversation({target:descriptor,fresh:true});
  }
  async renameConversation(id,title){
    title=String(title).trim();if(!title)throw new Error('对话标题不能为空。');
    const record=this.conversationStore.conversations.find(c=>c.id===id);if(!record)throw new Error('对话不存在。');
    record.title=title.slice(0,200);record.customTitle=true;record.updatedAt=Date.now();
    await this.saveChatHistory();this.refreshConversationControls();
  }
  async archiveConversation(id,archived){
    const record=this.conversationStore.conversations.find(c=>c.id===id);if(!record)throw new Error('对话不存在。');
    if(id===this.conversationStore.activeId&&(this.getChatView()?.running||this.pendingStudyPreviews.size))throw new Error('请等当前回答结束后再归档这段对话。');
    record.archived=archived;await this.saveChatHistory();
    if(archived&&id===this.conversationStore.activeId)await this.newConversation();
    this.refreshConversationControls();
  }
  async readLegacyConversationState(){
    const adapter=this.app.vault.adapter;
    const files=[this.pluginDataDir+'/chat-state.json',this.pluginDataDir+'/chat-state.next.json',this.legacyChatStatePath];
    const valid=[];let existing=false;
    for(const path of files){
      if(!await adapter.exists(path))continue;existing=true;
      try{const value=JSON.parse(await adapter.read(path));if(isLegacyPersistedChatState(value))valid.push(value);}catch{}
    }
    if(valid.length)return valid.sort((a,b)=>(b.savedAt??0)-(a.savedAt??0))[0];
    if(existing){new import_obsidian12.Notice('旧聊天记录未能读取，已保留原文件，暂不保存新记录。');return undefined;}
    return null;
  }
  initializeConversationFeatures(){
    const report=error=>new import_obsidian12.Notice(error.message??String(error));
    this.registerEvent(this.app.workspace.on('file-open',file=>{void this.followConversationFile(file).catch(report);}));
    this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{
      if(this.conversationStore&&chatConversations.renamePaths(this.conversationStore,oldPath,file.path)){
        this.prepareConversationTurn();this.refreshConversationControls();void this.saveChatHistory();
      }
    }));
    this.addCommand({id:'conversation-history',name:'打开历史对话',callback:()=>showConversationHistory(this)});
    this.addCommand({id:'new-conversation',name:'在当前笔记或章节新建对话',callback:()=>{void this.newConversation().catch(report);}});
    this.app.workspace.onLayoutReady(()=>{if(!this.unloaded&&this.chatHistoryLoaded)void this.followConversationFile(this.app.workspace.getActiveFile()).catch(report);});
  }
}

module.exports={ConversationPluginMethods};
