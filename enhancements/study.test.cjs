'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const{createStudySupport}=require('./study-support.cjs');
const{createConversationSupport}=require('./conversation-support.cjs');
const{patchStudy,marker}=require('./patch-study.cjs');
const support=createStudySupport();
const installed=fs.readFileSync(require('node:path').join(__dirname, '..', 'main.js'),'utf8');
const source=installed.includes(marker)?installed:patchStudy(installed);
const rawCode=source.slice(source.indexOf('async function executeToolWithoutPreview('),source.indexOf('// src/settings.ts'));
const api={
  normalizePath:path=>path.replace(/\\/g,'/').replace(/\/+$/,''),
  getFrontMatterInfo:text=>{const m=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);return m?{exists:true,frontmatter:m[1],contentStart:m[0].length}:{exists:false,contentStart:0};},
  parseYaml:text=>Object.fromEntries(text.split('\n').filter(Boolean).map(line=>{const i=line.indexOf(':');const raw=line.slice(i+1).trim();let value;try{value=JSON.parse(raw);}catch{value=raw;}return[line.slice(0,i),value];})),
  stringifyYaml:obj=>Object.entries(obj).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n')+'\n'
};
const context=vm.createContext({import_obsidian:api,IMAGE_EXTENSIONS:['png'],BINARY_EXTENSIONS:['pdf']});
vm.runInContext(rawCode,context);
const executeRaw=context.executeToolWithoutPreview;

function fixture(initial={'a.md':'alpha\nbeta\ngamma\n','other.md':'untouched'}){
  const files=new Map(),writes=[];
  const add=(path,text)=>{const file={path,extension:path.split('.').pop(),text,stat:{mtime:1,size:text.length}};files.set(path,file);return file;};
  for(const[path,text]of Object.entries(initial))add(path,text);
  let active=files.get('a.md');
  const app={metadataCache:{resolvedLinks:{}},workspace:{getActiveFile:()=>active},
    vault:{getAbstractFileByPath:path=>files.get(path),getFileByPath:path=>files.get(path)?.children?null:files.get(path),
      getFolderByPath:path=>files.get(path)?.children?files.get(path):null,getFiles:()=>[...files.values()].filter(f=>!f.children),
      getMarkdownFiles:()=>[...files.values()].filter(f=>f.extension==='md'),
      read:async file=>file.text,cachedRead:async file=>file.text,getConfig:()=>app.trash,
      process:async(file,fn)=>{app.beforeProcess?.(file);const text=fn(file.text);if(text!==file.text){file.text=text;file.stat={mtime:file.stat.mtime+1,size:text.length};writes.push('modify:'+file.path);}return text;},
      createFolder:async path=>{files.set(path,{path,children:[]});writes.push('folder:'+path);},
      create:async(path,text)=>{if(files.has(path))throw new Error('exists');writes.push('create:'+path);return add(path,text);}},
    fileManager:{renameFile:async(file,path)=>{if(files.has(path))throw new Error('exists');writes.push('rename:'+file.path);files.delete(file.path);file.path=path;files.set(path,file);},
      trashFile:async file=>{writes.push('delete:'+file.path);files.delete(file.path);}},trash:'local'};
  return{app,files,writes,setActive:file=>{active=file;}};
}
function access(confirm=async()=>true){const state={cancelled:false,enabled:true};return{state,allowed:()=>state.enabled&&!state.cancelled,confirm,cancel:()=>{state.cancelled=true;}};}
const run=(f,name,input,guard,scope)=>support.execute(f.app,name,input,undefined,scope,guard,executeRaw,api);

test('installed candidate compiles and preserves formula and reasoning features',()=>{
  new vm.Script(source);assert.ok(source.includes('normalizeChatMath(value)'));assert.ok(source.includes('oauthReasoning(model, settings)'));
});
test('read-only rejects every mutation even if the model calls a hidden tool',async()=>{
  for(const name of ['edit_document','create_file','rename_file','delete_file','set_properties']){
    const f=fixture();const guard=access(async()=>{throw new Error('must not preview');});guard.state.enabled=false;
    const result=await run(f,name,{path:'a.md'},guard);assert.equal(result.isError,true);
    // Also check missing access fails closed, independent of supplied input.
    const denied=await run(f,name,{path:'a.md'},undefined);
    assert.equal(denied.isError,true);assert.equal(f.writes.length,0);
  }
});
test('preview staging has no filesystem effects; declining suppresses later writes',async()=>{
  const f=fixture();let previews=0;
  const guard=access(async plan=>{previews++;assert.equal(f.writes.length,0);assert.equal(plan.operations[0].after,'hello');return false;});
  const result=await run(f,'create_file',{path:'new/note.md',content:'hello'},guard);
  assert.equal(result.isError,true);assert.equal(f.files.has('new'),false);assert.equal(guard.state.cancelled,true);
  await run(f,'delete_file',{path:'a.md'},guard);assert.equal(previews,1);assert.equal(f.writes.length,0);
});
test('accepted edits apply precisely the displayed text and pin the original target',async()=>{
  const f=fixture();let proposed;
  const guard=access(async plan=>{proposed=plan.operations[0];f.setActive(f.files.get('other.md'));return true;});
  const result=await run(f,'edit_document',{operation:'find_replace',find:'beta',content:'BETA'},guard);
  assert.equal(result.isError,false);assert.equal(proposed.before,'alpha\nbeta\ngamma\n');
  assert.equal(f.files.get('a.md').text,proposed.after);assert.equal(f.files.get('other.md').text,'untouched');
});
test('external edits and late changes inside the atomic write both block stale previews',async()=>{
  for(const late of [false,true]){
    const f=fixture();const guard=access(async()=>{
      if(late)f.app.beforeProcess=file=>{file.text='new user content';};
      else f.files.get('a.md').text='new user content';return true;
    });
    const result=await run(f,'edit_document',{path:'a.md',operation:'replace_all',content:'model content'},guard);
    assert.equal(result.isError,true);assert.equal(f.files.get('a.md').text,'new user content');assert.equal(f.writes.length,0);
  }
});
test('switching to read-only while the preview is open prevents commit',async()=>{
  const f=fixture();const guard=access(async()=>{guard.state.enabled=false;return true;});
  const result=await run(f,'delete_file',{path:'a.md'},guard);assert.equal(result.isError,true);assert.equal(f.writes.length,0);
});
test('selection scope is staged on a copy and only advanced after approval',async()=>{
  const f=fixture();const scope={filePath:'a.md',text:'beta',from:6,sourceText:'alpha\nbeta\ngamma\n'};
  const guard=access(async plan=>{assert.equal(scope.text,'beta');assert.equal(plan.operations[0].after,'alpha\nBETA\ngamma\n');return true;});
  assert.equal((await run(f,'edit_document',{path:'a.md',operation:'find_replace',find:'beta',content:'BETA'},guard,scope)).isError,false);
  assert.equal(scope.text,'BETA');assert.equal(f.files.get('a.md').text,'alpha\nBETA\ngamma\n');
  const denied=await run(f,'edit_document',{path:'a.md',operation:'replace_all',content:'oops'},access(),scope);
  assert.equal(denied.isError,true);assert.equal(f.writes.length,1);
});
test('create, rename and trash only execute after an accepted preview',async()=>{
  const f=fixture();let previews=0;const guard=access(async()=>{previews++;return true;});
  assert.equal((await run(f,'create_file',{path:'new/file.md',content:'new'},guard)).isError,false);
  assert.equal(f.files.get('new/file.md').text,'new');
  assert.equal((await run(f,'rename_file',{path:'new/file.md',new_path:'new/renamed.md'},guard)).isError,false);
  assert.equal((await run(f,'delete_file',{path:'new/renamed.md'},guard)).isError,false);assert.equal(previews,3);
});
test('property changes preview the exact Markdown that will be committed',async()=>{
  const f=fixture({'a.md':'---\na: 1\nremove: true\n---\nBody stays.\n'});let preview;
  const guard=access(async plan=>{preview=plan.operations[0].after;assert.equal(f.writes.length,0);return true;});
  const result=await run(f,'set_properties',{path:'a.md',properties:{a:2,remove:null,tags:['study']}},guard);
  assert.equal(result.isError,false);assert.equal(f.files.get('a.md').text,preview);
  assert.ok(preview.includes('a: 2'));assert.ok(!preview.includes('remove:'));assert.ok(preview.endsWith('Body stays.\n'));
});
test('a new destination or changed trash settings invalidates an open preview',async()=>{
  const f=fixture();const guard=access(async()=>{f.app.trash='none';return true;});
  assert.equal((await run(f,'delete_file',{path:'a.md'},guard)).isError,true);assert.equal(f.writes.length,0);
  const g=fixture();const other=access(async()=>{g.files.set('new.md',{path:'new.md',text:'user file'});return true;});
  assert.equal((await run(g,'create_file',{path:'new.md',content:'AI file'},other)).isError,true);assert.equal(g.files.get('new.md').text,'user file');
});
test('out-of-vault paths are refused before preview or parent creation',async()=>{
  for(const path of ['../outside.md','C:/outside.md','/outside.md']){
    const f=fixture();assert.equal((await run(f,'create_file',{path,content:'x'},access())).isError,true);assert.equal(f.writes.length,0);
  }
});
test('line diff identifies inserted and removed mathematical content',()=>{
  const rows=support.diff('Before\n$x+y$\nAfter','Before\n$x-y$\nNew\nAfter');
  assert.deepEqual(rows.filter(row=>row.kind==='remove').map(row=>row.text),['$x+y$']);
  assert.deepEqual(rows.filter(row=>row.kind==='add').map(row=>row.text),['$x-y$','New']);
});
test('the actual agent loop hides write tools for read-only and study turns',async()=>{
  const agentCode=source.slice(source.indexOf('var AgentLoop = class {'),source.indexOf('// src/auth/chatgptOAuthStore.ts'));
  for(const editMode of ['read','edit'])for(const studyReadOnly of [false,true]){
    let offered,prompt;
    const tools=['read_document','edit_document','create_file','rename_file','delete_file','set_properties'].map(name=>({name}));
    const sandbox=vm.createContext({studySupport:support,chatConversations:createConversationSupport(),MAX_CONVERSATION_LENGTH:80,KEEP_RECENT:60,TOOL_DEFINITIONS:tools,
      buildContext:()=>({}),buildContextMessage:()=>'',buildSystemPrompt:()=>'',debugLog:()=>{},
      sendMessage:async(settings,messages,list,instructions)=>{offered=list;prompt=instructions;return{content:[{type:'text',text:'ok'}]};}});
    vm.runInContext(agentCode,sandbox);const agent=new sandbox.AgentLoop({}, {editMode});
    await agent.run('test',{onThinking(){},onResponse(){}},studyReadOnly?{text:'x',filePath:'a.md',studyReadOnly:true}:undefined);
    assert.equal(offered.some(tool=>support.isWrite(tool.name)),editMode==='edit'&&!studyReadOnly);
    if(editMode==='read'||studyReadOnly)assert.match(prompt,/READ-ONLY/);
  }
});
