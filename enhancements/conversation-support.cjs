'use strict';

function createConversationSupport(){
  const kinds=['note','chapter','free'];
  const kind=value=>kinds.includes(value)?value:'note';
  const clean=path=>String(path??'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
  const parent=path=>clean(path).split('/').slice(0,-1).join('/');
  const key=(type,path)=>type+':'+clean(path);
  const label=type=>({note:'笔记',chapter:'章节',free:'自由'})[type]??'笔记';
  const clone=value=>JSON.parse(JSON.stringify(value));
  function currentNote(app){
    const workspace=app.workspace;
    for(const file of [workspace.getActiveFile?.(),workspace.activeEditor?.file,workspace.getMostRecentLeaf?.()?.view?.file])if(file?.extension==='md')return file;
    const open=(workspace.getLeavesOfType?.('markdown')??[]).map(leaf=>leaf.view.file).filter(file=>file?.extension==='md');
    for(const path of workspace.getLastOpenFiles?.()??[]){const file=open.find(file=>file.path===path);if(file)return file;}
    return open[0]??null;
  }
  function target(type,filePath){
    type=kind(type);const file=clean(filePath);
    if(type==='free'||!file)return{kind:'free',path:'',lastNotePath:file||null};
    return{kind:type,path:type==='chapter'?parent(file):file,lastNotePath:file};
  }
  function defaultTitle(record){
    const base=record.kind==='free'?'自由对话':record.kind==='chapter'?(record.path.split('/').pop()||'笔记库根目录'):
      record.path.split('/').pop().replace(/\.md$/i,'');
    return base+(record.ordinal>1?' · '+record.ordinal:'');
  }
  function add(store,descriptor,now=Date.now()){
    const ordinal=1+store.conversations.filter(c=>key(c.kind,c.path)===key(descriptor.kind,descriptor.path)).reduce((max,c)=>Math.max(max,c.ordinal??1),0);
    const id='c-'+(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():now.toString(36)+'-'+Math.random().toString(36).slice(2));
    const record={id,kind:descriptor.kind,path:clean(descriptor.path),lastNotePath:descriptor.lastNotePath??null,ordinal,
      title:'',customTitle:false,archived:false,createdAt:now,updatedAt:now,chatHistory:[],agentMessages:[],draft:{text:'',images:[],selection:null},scrollTop:0};
    record.title=defaultTitle(record);store.conversations.push(record);store.routes[key(record.kind,record.path)]=id;
    return record;
  }
  function resolve(store,descriptor,fresh=false){
    const route=key(descriptor.kind,descriptor.path);
    const preferred=store.conversations.find(c=>c.id===store.routes[route]&&!c.archived&&key(c.kind,c.path)===route);
    const existing=preferred??store.conversations.filter(c=>!c.archived&&key(c.kind,c.path)===route).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
    return !fresh&&existing?existing:add(store,descriptor);
  }
  function migrate(state,filePath){
    if(state?.schemaVersion===2)return clone(state);
    const store={schemaVersion:2,activeId:'',routes:{},conversations:[]};
    const record=add(store,target('note',filePath),state?.savedAt??Date.now());
    record.chatHistory=clone(state?.chatHistory??[]);record.agentMessages=clone(state?.agentMessages??[]);
    if(!filePath&&record.chatHistory.length)record.title='迁移前的聊天记录';
    store.activeId=record.id;return store;
  }
  function draft(value){
    return{ text:typeof value?.text==='string'?value.text:'',images:Array.isArray(value?.images)?clone(value.images):[],
      selection:value?.selection?.text&&value.selection.filePath?clone(value.selection):null};
  }
  function validate(store,legacyValidator){
    if(!store||store.schemaVersion!==2||!Array.isArray(store.conversations)||!store.conversations.length||typeof store.activeId!=='string')return false;
    if(!store.routes||typeof store.routes!=='object'||Array.isArray(store.routes))return false;
    if('savedAt'in store&&(!Number.isFinite(store.savedAt)||store.savedAt<0))return false;
    const ids=new Set();
    for(const c of store.conversations){
      if(!c||typeof c!=='object'||typeof c.id!=='string'||!c.id||ids.has(c.id)||!kinds.includes(c.kind)||typeof c.path!=='string'||typeof c.title!=='string')return false;
      if(typeof c.archived!=='boolean'||!Number.isFinite(c.createdAt)||c.createdAt<0||!Number.isFinite(c.updatedAt)||c.updatedAt<0||!Array.isArray(c.chatHistory)||!Array.isArray(c.agentMessages)||!legacyValidator(c))return false;
      if('ordinal'in c&&(!Number.isInteger(c.ordinal)||c.ordinal<1))return false;
      if('lastNotePath'in c&&c.lastNotePath!==null&&typeof c.lastNotePath!=='string')return false;
      if('scrollTop'in c&&(!Number.isFinite(c.scrollTop)||c.scrollTop<0))return false;
      if(c.draft){
        if(typeof c.draft.text!=='string'||!Array.isArray(c.draft.images)||!legacyValidator({chatHistory:[{type:'user',text:'',images:c.draft.images}],agentMessages:[]}))return false;
        const s=c.draft.selection;if(s!==null&&s!==undefined&&(typeof s!=='object'||typeof s.text!=='string'||typeof s.filePath!=='string'))return false;
      }
      ids.add(c.id);
    }
    if(!ids.has(store.activeId))return false;
    return Object.entries(store.routes).every(([route,id])=>{
      const c=store.conversations.find(c=>c.id===id);return !!c&&route===key(c.kind,c.path);
    });
  }
  function renamePaths(store,oldPath,newPath){
    oldPath=clean(oldPath);newPath=clean(newPath);
    const remap=value=>value===oldPath?newPath:typeof value==='string'&&value.startsWith(oldPath+'/')?newPath+value.slice(oldPath.length):value;
    const oldRoutes=Object.values(store.routes);let changed=false;
    for(const c of store.conversations){
      const path=remap(c.path),last=remap(c.lastNotePath);
      if(path!==c.path||last!==c.lastNotePath){changed=true;c.path=path;c.lastNotePath=last;if(!c.customTitle)c.title=defaultTitle(c);}
      if(c.draft?.selection)c.draft.selection.filePath=remap(c.draft.selection.filePath);
    }
    if(changed){
      store.routes={};
      for(const c of [...store.conversations].sort((a,b)=>a.updatedAt-b.updatedAt))if(!c.archived)store.routes[key(c.kind,c.path)]=c.id;
      for(const id of oldRoutes){const c=store.conversations.find(c=>c.id===id);if(c&&!c.archived)store.routes[key(c.kind,c.path)]=id;}
    }
    return changed;
  }
  function search(store,query='',includeArchived=false){
    const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return store.conversations.filter(c=>(includeArchived||!c.archived)&&terms.every(term=>
      [c.title,c.path,...c.chatHistory.filter(m=>m.type==='user'||m.type==='assistant').map(m=>m.text??'')].join('\n').toLocaleLowerCase().includes(term)))
      .sort((a,b)=>b.updatedAt-a.updatedAt);
  }
  function pinInput(name,input,path){
    if(!path||!input||typeof input!=='object'||Array.isArray(input))return input;
    if(['read_document','edit_document','get_properties','set_properties','get_backlinks'].includes(name)&&!(typeof input.path==='string'&&input.path.length))return{...input,path};
    return input;
  }
  return{kind,clean,parent,key,label,currentNote,target,add,resolve,migrate,draft,validate,renamePaths,search,pinInput,defaultTitle};
}

module.exports={createConversationSupport};
