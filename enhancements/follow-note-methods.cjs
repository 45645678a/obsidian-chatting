'use strict';

class FollowNoteMethods {
  followReadingNote(){
    return chatConversations.currentNote(this.app)??this.lastCaptureLeaf?.view?.file??null;
  }
  async followConversationFile(file,{force=false}={}){
    if(!file||file.extension!=='md')return;
    const previous=this.followObservedPath;
    this.lastConversationNotePath=file.path;this.followObservedPath=file.path;
    if(this.settings.followActiveNote===false||(!force&&previous===file.path))return;
    // Automatic navigation always belongs to the selected note, independently of
    // whether the manually selected conversation was free, chapter-wide or note-bound.
    const descriptor=chatConversations.target('note',file.path),active=this.activeConversation();
    if(active&&chatConversations.key(active.kind,active.path)===chatConversations.key(descriptor.kind,descriptor.path)){
      active.lastNotePath=file.path;this.pendingConversationRequest=null;this.conversationNavigation++;
      this.syncBookBrowse(active);this.refreshConversationControls();return;
    }
    await this.requestConversation({target:descriptor,automatic:true});
  }
  async setConversationFollow(value){
    this.settings.followActiveNote=value===true;
    if(!value&&this.pendingConversationRequest?.automatic)this.pendingConversationRequest=null;
    await this.saveSettings();
    if(value)await this.followConversationFile(this.followReadingNote(),{force:true});
    this.refreshConversationControls();
  }
  initializeLibraryFeatures(){
    const remember=leaf=>{if(leaf?.view?.file&&leaf.view.getViewType?.()!==VIEW_TYPE_CHAT)this.lastCaptureLeaf=leaf;};
    remember(this.app.workspace.getMostRecentLeaf?.());
    let previousLeaf=this.app.workspace.activeLeaf;
    this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{
      const changed=leaf!==previousLeaf;previousLeaf=leaf;remember(leaf);
      // Switching between already-open tabs does not consistently emit file-open.
      if(changed&&this.conversationRoutingReady&&leaf?.view?.file?.extension==='md'){
        void this.followConversationFile(leaf.view.file,{force:true}).catch(error=>new import_obsidian12.Notice(error.message??String(error)));
      }
    }));
    let timer;
    const refresh=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>{if(!this.unloaded)this.refreshConversationControls();},150);};
    for(const name of ['create','delete','rename'])this.registerEvent(this.app.vault.on(name,refresh));
    this.register(()=>window.clearTimeout(timer));
  }
}
module.exports={FollowNoteMethods};
