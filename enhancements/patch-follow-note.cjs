'use strict';
const {ConversationPluginMethods}=require('./conversation-methods.cjs');
const {LibraryPluginMethods}=require('./library-methods.cjs');
const {FollowNoteMethods}=require('./follow-note-methods.cjs');
const marker='// Follow the selected section while retaining manual conversations, 2026-10-13.';
function patchFollowNote(source){
  if(source.includes(marker))throw new Error('Follow-note patch already present');
  const replace=(from,to)=>{if(source.split(from).length!==2)throw new Error('Unexpected source: '+from.slice(0,100));source=source.replace(from,()=>to);};
  for(const name of ['followConversationFile','setConversationFollow'])replace(ConversationPluginMethods.prototype[name].toString(),FollowNoteMethods.prototype[name].toString());
  replace(LibraryPluginMethods.prototype.initializeLibraryFeatures.toString(),FollowNoteMethods.prototype.initializeLibraryFeatures.toString());
  replace('  bookBrowse = null;',marker+'\n  '+FollowNoteMethods.prototype.followReadingNote.toString()+'\n  followObservedPath = null;\n  bookBrowse = null;');
  replace("add('span','','跟随正在阅读的笔记',label);","add('span','','自动跟随当前小节',label);label.title='切换阅读小节时自动打开对应聊天；也可通过小节选择、对话下拉框或历史按钮手动切换。取消勾选后仅手动切换。';");
  replace("follow.checked=plugin.settings.followActiveNote!==false;follow.disabled=selected.book==='free:';","follow.checked=plugin.settings.followActiveNote!==false;follow.disabled=false;");
  replace('    this.app.workspace.onLayoutReady(()=>{this.conversationRoutingReady=true;});',
    '    this.app.workspace.onLayoutReady(()=>{this.conversationRoutingReady=true;if(!this.unloaded&&this.chatHistoryLoaded)void this.followConversationFile(this.followReadingNote(),{force:true}).catch(report);});');
  const guard='if(this.unloaded||navigation!==this.conversationNavigation)return{skipped:true};';
  if(source.split(guard).length!==3)throw new Error('Conversation navigation guards changed');
  source=source.split(guard).join('if(this.unloaded||navigation!==this.conversationNavigation||(request.automatic&&this.settings.followActiveNote===false))return{skipped:true};');
  return source;
}
module.exports={patchFollowNote,marker};
