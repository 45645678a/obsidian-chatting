'use strict';
const{createBookLibrary}=require('./library-support.cjs');
const oldUi=require('./conversation-ui.cjs'),newUi=require('./library-ui.cjs');
const{LibraryPluginMethods}=require('./library-methods.cjs');
const marker='// Book/chapter/section navigation and page capture, 2026-10-13.';
function patchLibrary(source){
  if(source.includes(marker))throw new Error('Library navigation patch is already present.');
  function replace(before,after){if(source.split(before).length!==2)throw new Error('Unexpected source: '+before.slice(0,130));source=source.replace(before,()=>after);}
  replace('var chatConversations=',marker+'\nvar chatBookLibrary=('+createBookLibrary.toString()+')();\n'+newUi.mountBookPicker.toString()+'\nvar chatConversations=');
  replace(oldUi.mountConversationControls.toString(),newUi.mountConversationControls.toString());
  replace(oldUi.showConversationHistory.toString(),newUi.showConversationHistory.toString());
  const methods=Object.getOwnPropertyNames(LibraryPluginMethods.prototype).filter(name=>name!=='constructor').map(name=>LibraryPluginMethods.prototype[name].toString()).join('\n');
  replace('  conversationStore = null;','  bookBrowse = null;\n  lastCaptureLeaf = null;\n  captureInProgress = false;\n'+methods+'\n  conversationStore = null;');
  replace('this.studySelection=record.draft?.selection??null;this.prepareConversationTurn();',
    'this.studySelection=record.draft?.selection??null;this.prepareConversationTurn();this.syncBookBrowse(record);');
  replace('    this.initializeConversationFeatures();','    this.initializeConversationFeatures();\n    this.initializeLibraryFeatures();');
  replace(`      const conversationBar=doc.createElement("div");chatRoot.insertBefore(conversationBar,options);
      this.conversationBar=this.plugin.mountConversationControls(conversationBar,false);
      const conversationOptions=doc.createElement("div");options.appendChild(conversationOptions);
      this.conversationOptions=this.plugin.mountConversationControls(conversationOptions,true);`,`      const conversationBar=doc.createElement("div");options.appendChild(conversationBar);
      this.conversationBar=this.plugin.mountConversationControls(conversationBar,false);`);
  replace('    this.optionsSummaryEl.textContent=mode+(state.effective?" · 思考"+chatReasoning.label(state.effective):"");',
    '    const conversation=this.plugin.activeConversation();\n    this.optionsSummaryEl.textContent=(conversation?conversation.title+" · ":"")+mode+(state.effective?" · 思考"+chatReasoning.label(state.effective):"");\n    this.optionsSummaryEl.title=conversation?.path??conversation?.title??"";');
  replace(`initializeConversationFeatures(){
    const report=error=>new import_obsidian12.Notice(error.message??String(error));
    this.registerEvent(this.app.workspace.on('file-open',file=>{void this.followConversationFile(file).catch(report);}));`,
    `initializeConversationFeatures(){
    this.conversationRoutingReady=false;
    const report=error=>new import_obsidian12.Notice(error.message??String(error));
    this.registerEvent(this.app.workspace.on('file-open',file=>{if(this.conversationRoutingReady)void this.followConversationFile(file).catch(report);}));`);
  replace('    this.app.workspace.onLayoutReady(()=>{if(!this.unloaded&&this.chatHistoryLoaded)void this.followConversationFile(this.app.workspace.getActiveFile()).catch(report);});',
    '    this.app.workspace.onLayoutReady(()=>{this.conversationRoutingReady=true;});');

  replace('aria-label="Attach images" title="Attach images"','aria-label="截取当前阅读页" title="点击截取当前阅读页；右键选择图片文件"');
  replace(`  function openImagePicker() {
    if (get2(inputEnabled)) get2(fileInputEl)?.click();
  }`,`  async function openImagePicker() {
    if(!get2(inputEnabled))return;
    if(!import_obsidian8.Platform.isDesktopApp){get2(fileInputEl)?.click();return;}
    const plugin=$$props.component.plugin;
    const conversationId=plugin.conversationStore?.activeId;
    const button=$$props.component.contentEl.querySelector(".ochatting-attach-btn");
    if(plugin.captureInProgress)return;
    button?.classList.add("is-capturing");
    try {
      const file=await plugin.captureCurrentReadingPage();
      await addImageFiles([file],conversationId);
    }catch(error){new import_obsidian8.Notice(error.message??String(error));}
    finally{button?.classList.remove("is-capturing");}
  }
  function imageAttachmentMenu(event2) {
    event2.preventDefault();
    const menu=new import_obsidian8.Menu();
    menu.addItem(item=>item.setTitle("截取当前阅读页").setIcon("camera").onClick(()=>void openImagePicker()));
    menu.addItem(item=>item.setTitle("选择图片文件").setIcon("image-plus").onClick(()=>{if(get2(inputEnabled))get2(fileInputEl)?.click();}));
    menu.showAtMouseEvent(event2);
  }`);
  const begin=source.indexOf('  async function addImageFiles(files) {'),end=source.indexOf('  async function readImageAttachment(file) {',begin);
  if(begin<0||end<0)throw new Error('Attachment handler not found');
  replace(source.slice(begin,end),`  async function addImageFiles(files,conversationId=$$props.component.plugin.conversationStore?.activeId) {
    const plugin=$$props.component.plugin;
    for(const file of files){
      try{
        const image=await readImageAttachment(file);
        if(conversationId&&conversationId!==plugin.conversationStore?.activeId){await plugin.saveImageToInactiveConversation(conversationId,image);continue;}
        if(get2(attachments).length>=MAX_IMAGE_COUNT){new import_obsidian8.Notice("每条消息最多附加 4 张图片。");return;}
        const currentBytes=get2(attachments).reduce((total,item)=>total+item.sizeBytes,0);
        if(currentBytes+image.sizeBytes>MAX_TOTAL_IMAGE_BYTES){new import_obsidian8.Notice("图片总大小不能超过 12 MB。");return;}
        set(attachments,[...get2(attachments),image],true);
        await plugin.saveChatHistory();
      }catch(error){new import_obsidian8.Notice("添加图片失败："+(error.message??String(error)));}
    }
  }
`);
  replace('  delegated("click", button_3, openImagePicker);',
    '  import_obsidian8.setIcon(button_3,"camera");\n  delegated("click", button_3, openImagePicker);\n  event("contextmenu", button_3, imageAttachmentMenu);');
  return source;
}
module.exports={patchLibrary,marker};
