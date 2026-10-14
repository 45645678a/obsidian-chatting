'use strict';
class LibraryPluginMethods {
  getBookLibrary(){return chatBookLibrary.index(this.app.vault.getMarkdownFiles().map(file=>file.path),this.conversationStore);}
  syncBookBrowse(record){this.bookBrowse={...chatBookLibrary.locate(record),activeId:record?.id,dirty:false};}
  getBookBrowse(){
    if(!this.bookBrowse||(!this.bookBrowse.dirty&&this.bookBrowse.activeId!==this.activeConversation()?.id))this.syncBookBrowse(this.activeConversation());
    return this.bookBrowse;
  }
  async changeBookBrowse(selection,action){
    this.bookBrowse={...selection,dirty:true,activeId:this.activeConversation()?.id};this.refreshConversationControls();
    const descriptor=chatBookLibrary.descriptor(selection.scope??'');
    if(descriptor&&(action==='scope'||selection.book==='free:')){
      if(descriptor.kind==='chapter'){
        const files=this.getBookLibrary().flatMap(book=>book.chapters).find(chapter=>chapter.path===descriptor.path)?.sections;
        descriptor.lastNotePath=files?.find(file=>file.exists)?.path??files?.[0]?.path??null;
      }
      await this.requestConversation({target:descriptor});
    }
  }
  captureReadingLeaf(){
    const workspace=this.app.workspace;
    const candidates=[this.lastCaptureLeaf,workspace.getMostRecentLeaf?.(),workspace.activeLeaf];
    const all=[];workspace.iterateAllLeaves(leaf=>all.push(leaf));
    candidates.push(...all);
    return candidates.find(leaf=>{
      const view=leaf?.view;if(!view?.file||view.getViewType?.()===VIEW_TYPE_CHAT)return false;
      const r=view.contentEl.getBoundingClientRect();return r.width>30&&r.height>30;
    })??null;
  }
  async captureCurrentReadingPage(){
    if(this.captureInProgress)throw new Error('正在截图，请稍等。');
    const leaf=this.captureReadingLeaf();if(!leaf)throw new Error('请先打开要截取的笔记或阅读页。');
    const capturedPath=leaf.view.file.path,capturedName=leaf.view.file.basename??'阅读页';
    this.captureInProgress=true;
    try{
      const element=leaf.view.contentEl,win=element.ownerDocument.defaultView;
      const remote=(win.require??require)('@electron/remote');
      const contents=remote.getCurrentWebContents();
      const rectangle=chatBookLibrary.rectangle(element.getBoundingClientRect(),{width:win.innerWidth,height:win.innerHeight},contents.getZoomFactor());
      const image=await contents.capturePage(rectangle,{stayHidden:true});
      if(image.isEmpty())throw new Error('没有截取到页面，请确认 Obsidian 阅读区域已经显示。');
      if(leaf.view.file?.path!==capturedPath)throw new Error('截图期间阅读页已切换，请再点一次截图。');
      const stamp=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}).replace(/[ :]/g,'-');
      const name='截图-'+capturedName.slice(0,80)+'-'+stamp+'.png';
      const bytes=image.toPNG();
      return new File([bytes],name,{type:'image/png'});
    }finally{this.captureInProgress=false;}
  }
  async saveImageToInactiveConversation(id,image){
    const record=this.conversationStore.conversations.find(c=>c.id===id);if(!record)throw new Error('截图所属的对话不存在。');
    const draft=chatConversations.draft(record.draft);
    if(draft.images.length>=4)throw new Error('原对话已经有 4 张待发送图片。');
    if(draft.images.reduce((sum,item)=>sum+item.sizeBytes,0)+image.sizeBytes>12*1024*1024)throw new Error('图片总大小超过 12 MB。');
    draft.images.push(image);record.draft=draft;await this.saveChatHistory();
    new import_obsidian12.Notice('图片已保存在原对话的草稿中。');
  }
  initializeLibraryFeatures(){
    const remember=leaf=>{if(leaf?.view?.file&&leaf.view.getViewType?.()!==VIEW_TYPE_CHAT)this.lastCaptureLeaf=leaf;};
    remember(this.app.workspace.getMostRecentLeaf?.());
    this.registerEvent(this.app.workspace.on('active-leaf-change',remember));
    let timer;
    const refresh=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>{if(!this.unloaded)this.refreshConversationControls();},150);};
    for(const name of ['create','delete','rename'])this.registerEvent(this.app.vault.on(name,refresh));
    this.register(()=>window.clearTimeout(timer));
  }
}
module.exports={LibraryPluginMethods};
