'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const{createConversationSupport}=require('./conversation-support.cjs');
const{ConversationPluginMethods}=require('./conversation-methods.cjs');
const{patchConversations,marker}=require('./patch-conversations.cjs');
const{createStudySupport}=require('./study-support.cjs');
const support=createConversationSupport();
const input=fs.readFileSync(require('node:path').join(__dirname, '..', 'main.js'),'utf8');
const source=input.includes(marker)?input:patchConversations(input);
const validatorContext=vm.createContext({isRecord6:v=>v!==null&&typeof v==='object'});
vm.runInContext(source.slice(source.indexOf('function isLegacyPersistedChatState('),source.indexOf('function normalizeSettings(')),validatorContext);
const validateLegacy=validatorContext.isLegacyPersistedChatState;
const noteA='Book/Chapter 3/a.md',noteB='Book/Chapter 3/b.md',noteC='Book/Chapter 4/c.md';
const message=text=>({type:'assistant',text});
const apiMessage=text=>({role:'assistant',content:text});

test('candidate compiles while keeping previous permissions and formula features',()=>{
  new vm.Script(source);assert.ok(source.includes('normalizeChatMath(value)'));assert.ok(source.includes('studySupport.toolsFor('));assert.ok(source.includes('oauthReasoning(model, settings)'));
});
test('migration preserves every existing message and provider replay payload',()=>{
  const legacy={savedAt:100,chatHistory:Array.from({length:150},(_,i)=>message('原有公式 '+i)),agentMessages:[{...apiMessage('old'),replay:{provider:'chatgpt-oauth',items:[{id:'original-item'}]}}]};
  const store=support.migrate(legacy,noteA);const first=store.conversations[0];
  assert.deepEqual(first.chatHistory,legacy.chatHistory);assert.deepEqual(first.agentMessages,legacy.agentMessages);
  assert.notEqual(first.chatHistory,legacy.chatHistory);assert.equal(first.path,noteA);assert.equal(support.validate(store,validateLegacy),true);
});
test('notes with identical names in different folders have independent records',()=>{
  const store=support.migrate(null,noteA),a=store.conversations[0];a.chatHistory.push(message('Only A'));
  const b=support.resolve(store,support.target('note','Other/a.md'));
  assert.notEqual(a.id,b.id);assert.equal(b.chatHistory.length,0);assert.equal(support.resolve(store,support.target('note',noteA)).id,a.id);
});
test('chapter scope shares sibling notes and separates other chapter folders',()=>{
  const store=support.migrate(null,noteA);const first=support.resolve(store,support.target('chapter',noteA));
  assert.equal(support.resolve(store,support.target('chapter',noteB)).id,first.id);
  assert.notEqual(support.resolve(store,support.target('chapter',noteC)).id,first.id);
});
test('a fresh conversation keeps the prior one in history and becomes the preferred route',()=>{
  const store=support.migrate(null,noteA),old=store.conversations[0];old.chatHistory.push(message('retained'));
  const next=support.resolve(store,support.target('note',noteA),true);
  assert.equal(next.ordinal,2);assert.notEqual(old.id,next.id);assert.equal(old.chatHistory[0].text,'retained');
  assert.equal(support.resolve(store,support.target('note',noteA)).id,next.id);
});
test('rename tracking retains ids, custom titles, folder associations and draft paths',()=>{
  const store=support.migrate(null,noteA),a=store.conversations[0];a.draft.selection={text:'x',filePath:noteA};
  const chapter=support.resolve(store,support.target('chapter',noteA));chapter.title='自定义章节';chapter.customTitle=true;
  const unrelated=support.resolve(store,support.target('note','Book/Chapter 30/a.md'));
  assert.equal(support.renamePaths(store,'Book/Chapter 3','Book/Renamed'),true);
  assert.equal(a.path,'Book/Renamed/a.md');assert.equal(a.draft.selection.filePath,a.path);
  assert.equal(chapter.path,'Book/Renamed');assert.equal(chapter.title,'自定义章节');assert.equal(unrelated.path,'Book/Chapter 30/a.md');
  assert.equal(support.validate(store,validateLegacy),true);
});
test('history search includes message content and archived records only when requested',()=>{
  const store=support.migrate(null,noteA),a=store.conversations[0];a.chatHistory.push(message('贝叶斯后验方差 sigma'));
  assert.equal(support.search(store,'后验 sigma').length,1);a.archived=true;
  assert.equal(support.search(store,'后验').length,0);assert.equal(support.search(store,'后验',true)[0].id,a.id);
});
test('a corrupt inactive conversation invalidates the whole snapshot for recovery',()=>{
  const store=support.migrate(null,noteA);support.resolve(store,support.target('note',noteB));
  store.conversations[1].chatHistory=[{type:'assistant',text:42}];assert.equal(support.validate(store,validateLegacy),false);
  store.conversations[1].chatHistory=[];store.conversations[1].id=store.conversations[0].id;assert.equal(support.validate(store,validateLegacy),false);
});
test('draft cloning preserves text, images and selection without sharing mutable arrays',()=>{
  const value={text:'未发送的 $x^2$',images:[{id:'i',fileName:'image.png',mediaType:'image/png',data:'AA==',sizeBytes:1}],selection:{text:'x',filePath:noteA}};
  const copy=support.draft(value);assert.deepEqual(copy,value);copy.images[0].fileName='changed';assert.equal(value.images[0].fileName,'image.png');
});
test('tool paths default to the conversation note while explicit paths remain available',()=>{
  assert.equal(support.pinInput('edit_document',{operation:'replace_all'},noteA).path,noteA);
  assert.equal(support.pinInput('read_document',{path:noteB},noteA).path,noteB);
  assert.deepEqual(support.pinInput('search_vault',{query:'x'},noteA),{query:'x'});
});

function pluginFixture(){
  class FakeAgent {constructor(app,settings){this.messages=[];this.settings=settings;}exportMessages(){return this.messages.slice();}importMessages(messages){this.messages=JSON.parse(JSON.stringify(messages));}}
  const context=vm.createContext({chatConversations:support,AgentLoop:FakeAgent,Date});
  vm.runInContext(ConversationPluginMethods.toString()+';globalThis.Methods=ConversationPluginMethods;',context);
  const p=new context.Methods();let file={path:noteA,extension:'md'};
  p.app={workspace:{getActiveFile:()=>file}};p.settings={conversationScope:'note',followActiveNote:true};
  p.conversationStore=support.migrate(null,noteA);p.conversationControls=new Set();p.pendingStudyPreviews=new Set();p.conversationNavigation=0;p.chatHistoryLoaded=true;
  const view={running:false,displayConversationId:p.conversationStore.activeId,draft:{text:'draft A',images:[],selection:null},
    contentEl:{querySelector:()=>({scrollTop:37})},chatContainer:{getDraft:()=>view.draft,setInputEnabled(){}},
    replayConversation(){view.displayConversationId=p.conversationStore.activeId;view.draft=support.draft(p.activeConversation().draft);}};
  p.getChatView=()=>view;p.refreshStudyControls=()=>{};p.saveSettings=async()=>{};
  p.saveChatHistory=async()=>{p.captureActiveConversation();};p.activateConversationRecord(p.activeConversation());
  return{p,view,setFile:path=>{file={path,extension:'md'};}};
}
test('real switching methods isolate model messages and restore each conversation draft',async()=>{
  const{p,view}=pluginFixture();const old=p.activeConversation().id;
  p.chatHistory.push(message('A only'));p.agent.messages.push(apiMessage('A context'));
  await p.requestConversation({target:support.target('note',noteB)});
  assert.equal(p.chatHistory.length,0);assert.equal(p.agent.messages.length,0);assert.equal(view.draft.text,'');
  p.chatHistory.push(message('B only'));p.agent.messages.push(apiMessage('B context'));view.draft.text='draft B';
  await p.requestConversation({id:old});assert.equal(p.chatHistory[0].text,'A only');assert.equal(p.agent.messages[0].content,'A context');assert.equal(view.draft.text,'draft A');
  await p.requestConversation({target:support.target('note',noteB)});assert.equal(view.draft.text,'draft B');
});
test('navigation waits for a running answer and only applies the last pending choice',async()=>{
  const{p,view}=pluginFixture();const old=p.activeConversation().id;view.running=true;
  assert.equal((await p.requestConversation({target:support.target('note',noteB)})).queued,true);
  await p.requestConversation({target:support.target('note',noteC)});assert.equal(p.activeConversation().id,old);
  p.chatHistory.push(message('late A response'));view.running=false;await p.finishConversationTurn();
  assert.equal(p.activeConversation().path,noteC);assert.equal(p.chatHistory.length,0);
  assert.equal(p.conversationStore.conversations.find(c=>c.id===old).chatHistory[0].text,'late A response');
});
test('returning to the original note cancels a stale automatic switch',async()=>{
  const{p,view}=pluginFixture();view.running=true;
  await p.followConversationFile({path:noteB,extension:'md'});assert.ok(p.pendingConversationRequest);
  await p.followConversationFile({path:noteA,extension:'md'});assert.equal(p.pendingConversationRequest,null);
  view.running=false;await p.flushPendingConversation();assert.equal(p.activeConversation().path,noteA);
});
test('archiving preserves an active conversation and opens a fresh one',async()=>{
  const{p}=pluginFixture();const old=p.activeConversation().id;p.chatHistory.push(message('preserve me'));
  await p.archiveConversation(old,true);const archived=p.conversationStore.conversations.find(c=>c.id===old);
  assert.equal(archived.archived,true);assert.equal(archived.chatHistory[0].text,'preserve me');assert.notEqual(p.activeConversation().id,old);
  await p.requestConversation({id:old});assert.equal(archived.archived,false);assert.equal(p.chatHistory[0].text,'preserve me');
});
test('a failed save keeps the current conversation active',async()=>{
  const{p}=pluginFixture();const old=p.activeConversation().id;
  p.saveChatHistory=async()=>{p.conversationSaveError=new Error('disk failure');};
  await assert.rejects(p.requestConversation({target:support.target('note',noteB)}),/保存失败/);
  assert.equal(p.activeConversation().id,old);assert.equal(p.conversationChanging,false);
});
test('the actual agent uses its bound note and follows a successful rename for subsequent tools',async()=>{
  const agentCode=source.slice(source.indexOf('var AgentLoop = class {'),source.indexOf('// src/auth/chatgptOAuthStore.ts'));
  let calls=0;const inputs=[];
  const context=vm.createContext({chatConversations:support,studySupport:createStudySupport(),MAX_CONVERSATION_LENGTH:80,KEEP_RECENT:60,
    TOOL_DEFINITIONS:[{name:'rename_file'},{name:'read_document'}],debugLog(){},buildContext:()=>({activeFile:noteB}),buildContextMessage:c=>'Active document: '+c.activeFile,buildSystemPrompt:()=>'',
    sendMessage:async()=>{calls++;return calls===1?{content:[{type:'tool_use',id:'r',name:'rename_file',input:{path:noteA,new_path:'Book/Chapter 3/renamed.md'}}]}:
      calls===2?{content:[{type:'tool_use',id:'read',name:'read_document',input:{}}]}:{content:[{type:'text',text:'ok'}]};}});
  vm.runInContext(agentCode,context);const agent=new context.AgentLoop({}, {editMode:'edit'});agent.boundNotePath=noteA;
  await agent.run('test',{onThinking(){},onResponse(){},onToolCall(){},onToolResult(){},onExecuteTool:async(name,input)=>{inputs.push(input);return{result:'ok',isError:false};}});
  assert.equal(inputs[1].path,'Book/Chapter 3/renamed.md');assert.match(agent.messages[0].content,/Active document: Book\/Chapter 3\/a.md/);
});
