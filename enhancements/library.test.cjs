'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const{createBookLibrary}=require('./library-support.cjs');
const{createConversationSupport}=require('./conversation-support.cjs');
const{LibraryPluginMethods}=require('./library-methods.cjs');
const{patchLibrary,marker}=require('./patch-library.cjs');
const library=createBookLibrary(),conversations=createConversationSupport();
test('books, chapters and sections follow paths and natural numeric order',()=>{
  const tree=library.index(['Book A/第10章/10.1.md','Book A/第2章/2.2.md','Book A/第2章/2.1.md','Book B/第1章/1.1.md','Book A/raw/books/full.md'],{conversations:[]});
  assert.equal(tree.length,2);const book=tree.find(b=>b.path==='Book A');assert.equal(book.chapters.length,2);
  assert.equal(book.chapters[0].title,'第2章');assert.equal(book.chapters[0].sections[0].title,'2.1');
});
test('historical conversations stay discoverable when source files are missing',()=>{
  const record={id:'old',kind:'note',path:'Old Book/Chapter/note.md',chatHistory:[{type:'user',text:'remember'}]};
  const tree=library.index([],{activeId:'old',conversations:[record]});assert.equal(tree[0].chapters[0].sections[0].exists,false);
});
test('hierarchical filtering distinguishes whole-chapter chats from section chats',()=>{
  const note={kind:'note',path:'Book/Chapter/note.md'},chapter={kind:'chapter',path:'Book/Chapter'};
  const filter={book:'book:Book',chapter:'chapter:Book/Chapter',scope:''};assert.equal(library.matches(note,filter),true);assert.equal(library.matches(chapter,filter),true);
  filter.scope='note:Book/Chapter/note.md';assert.equal(library.matches(chapter,filter),false);assert.equal(library.matches(note,filter),true);
});
test('root notes and free chats use different selections',()=>{
  assert.equal(library.locate({kind:'note',path:'root.md'}).book,'book:');assert.equal(library.locate({kind:'free',path:''}).book,'free:');
  assert.equal(library.descriptor('chapter:Book/C').kind,'chapter');assert.equal(library.descriptor(''),null);
});
test('screen capture is clipped to the reading pane and respects zoom',()=>{
  assert.deepEqual(library.rectangle({x:-10,y:20,width:310,height:900},{width:1000,height:800},1.5),{x:0,y:30,width:450,height:1170});
  assert.throws(()=>library.rectangle({x:1200,y:10,width:200,height:300},{width:1000,height:800}),/不可见/);
});
function captureFixture(changePage=false){
  let captured;
  const file={path:'Book/C/note.md',basename:'note'};
  const native={isEmpty:()=>false,toPNG:()=>new Uint8Array([1,2,3])};
  const contents={getZoomFactor:()=>1.25,capturePage:async(rect,options)=>{captured={rect,options};if(changePage)file.path='changed.md';return native;}};
  const win={innerWidth:1000,innerHeight:800,require:()=>({getCurrentWebContents:()=>contents})};
  const leaf={view:{file,contentEl:{ownerDocument:{defaultView:win},getBoundingClientRect:()=>({x:100,y:100,width:600,height:900})}}};
  class FakeFile {constructor(parts,name,options){this.parts=parts;this.name=name;this.type=options.type;}}
  const sandbox=vm.createContext({chatBookLibrary:library,chatConversations:conversations,File:FakeFile,import_obsidian12:{Notice:class{}}});
  vm.runInContext(LibraryPluginMethods.toString()+';globalThis.Methods=LibraryPluginMethods;',sandbox);
  const p=new sandbox.Methods();p.captureReadingLeaf=()=>leaf;
  return{p,getCapture:()=>captured};
}
test('capture method returns a PNG attachment from the selected pane only',async()=>{
  const f=captureFixture(),image=await f.p.captureCurrentReadingPage();
  assert.equal(image.type,'image/png');assert.ok(image.name.startsWith('截图-note-'));assert.equal(f.getCapture().rect.width,750);assert.equal(f.getCapture().rect.height,875);
  assert.equal(f.getCapture().options.stayHidden,true);assert.equal(f.p.captureInProgress,false);
});
test('switching pages while capture is pending rejects the stale screenshot',async()=>{
  const f=captureFixture(true);await assert.rejects(f.p.captureCurrentReadingPage(),/阅读页已切换/);assert.equal(f.p.captureInProgress,false);
});
test('late images are stored in their original conversation draft',async()=>{
  const{p}=captureFixture();p.conversationStore={activeId:'b',conversations:[{id:'a',draft:{text:'draft A',images:[],selection:null}},{id:'b',draft:{text:'draft B',images:[],selection:null}}]};
  p.saveChatHistory=async()=>{};await p.saveImageToInactiveConversation('a',{id:'img',sizeBytes:10});
  assert.equal(p.conversationStore.conversations[0].draft.images.length,1);assert.equal(p.conversationStore.conversations[1].draft.images.length,0);
});
test('patched bundle compiles and keeps all conversation controls inside the fold',()=>{
  const input=fs.readFileSync(require('node:path').join(__dirname, '..', 'main.js'),'utf8');
  const source=input.includes(marker)?input:patchLibrary(input);new vm.Script(source);
  assert.ok(source.includes('options.appendChild(conversationBar)'));assert.ok(!source.includes('chatRoot.insertBefore(conversationBar,options)'));
  assert.ok(source.includes('imageAttachmentMenu'));assert.ok(source.includes('saveImageToInactiveConversation(conversationId,image)'));
});
