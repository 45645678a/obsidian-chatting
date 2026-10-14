'use strict';

function createStudySupport() {
  const writes=new Set(['edit_document','create_file','rename_file','delete_file','set_properties']);
  const actions=[
    {id:'symbols',label:'解释符号',icon:'sigma',prompt:'请解释我选中内容中的每个符号及公式的直接含义。先交代模型假设，区分参数、观测量和统计量，再给出直观理解；无法从上下文确定的符号请明确指出。'},
    {id:'derive',label:'逐步推导',icon:'list-ordered',prompt:'请对我选中的公式作可检查的逐步数学推导。先列出假设和起始关系，再写清关键代数变换及其理由，标明哪些结论是精确的、哪些用了近似，并解释结果的直观意义。'},
    {id:'example',label:'数值例子',icon:'calculator',prompt:'请围绕我选中的内容给出一个完整数值例子。明确区分书中给定值与为演示假设的数值，列出输入、单位、逐步计算和最终结果，再说明这个结果如何体现原公式。'},
    {id:'dimensions',label:'检查量纲',icon:'ruler',prompt:'请检查我选中的公式的量纲和单位。逐项说明各符号的单位，检验等式两边、相加项、指数与对数自变量是否一致；若变量已无量纲化或单位定义缺失，请明确列出所需假设。'}
  ];
  const mode=value=>value==='edit'?'edit':'read';
  function prompt(id) {
    const action=actions.find(item=>item.id===id);
    if(!action)throw new Error('Unknown study action');
    return action.prompt+'\n请使用中文和清晰的数学排版，只在聊天栏回答，不创建、修改、移动或删除任何文件。';
  }
  function policy(canWrite) {
    return canWrite ? '\n\n## Vault editing permission\nEditable mode is enabled. Each mutation is staged for a human diff preview and must be applied through that preview. Call the requested tool directly; do not ask for an extra confirmation with ask_user. A cancelled change must not be retried or replaced with another write in this turn. Only say a file was changed when the tool reports success.' :
      '\n\n## Vault editing permission\nThis turn is READ-ONLY. Answer in chat and use reading/search tools as needed. Do not create, edit, rename, move, delete files or change properties. Do not claim edits were made. If editing is requested, explain that the user can switch the plugin to editable mode and send a new request.';
  }
  function safePath(value) {
    if(typeof value!=='string')return;
    const path=value.replace(/\\/g,'/');
    if(path.startsWith('/')||/^[a-zA-Z]:/.test(path)||path.split('/').includes('..'))throw new Error('仅支持当前笔记库内的相对路径。');
  }
  function diff(before,after) {
    const old=before===''?[]:before.split(/\r?\n/), next=after===''?[]:after.split(/\r?\n/);
    let start=0,end=0;
    while(start<old.length&&start<next.length&&old[start]===next[start])start++;
    while(end<old.length-start&&end<next.length-start&&old[old.length-1-end]===next[next.length-1-end])end++;
    const a=old.slice(start,old.length-end),b=next.slice(start,next.length-end);
    const rows=[];
    if(start>3)rows.push({kind:'skip',text:`省略前 ${start-3} 行未修改内容`});
    for(const text of old.slice(Math.max(0,start-3),start))rows.push({kind:'same',text});
    if((a.length+1)*(b.length+1)<=1000000){
      const width=b.length+1,table=new Uint32Array((a.length+1)*width);
      for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)
        table[i*width+j]=a[i]===b[j]?1+table[(i+1)*width+j+1]:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
      let i=0,j=0;
      while(i<a.length||j<b.length){
        if(i<a.length&&j<b.length&&a[i]===b[j]){rows.push({kind:'same',text:a[i++]});j++;}
        else if(i<a.length&&(j===b.length||table[(i+1)*width+j]>=table[i*width+j+1]))rows.push({kind:'remove',text:a[i++]});
        else rows.push({kind:'add',text:b[j++]});
      }
    }else{
      for(const text of a)rows.push({kind:'remove',text});
      for(const text of b)rows.push({kind:'add',text});
    }
    for(const text of old.slice(old.length-end,old.length-end+Math.min(3,end)))rows.push({kind:'same',text});
    if(end>3)rows.push({kind:'skip',text:`省略后 ${end-3} 行未修改内容`});
    return rows;
  }
  function snapshot(app,target) {
    const list=[];
    function visit(file){
      list.push([file.path,file.children?'folder':'file',file.stat?.mtime??null,file.stat?.size??null]);
      for(const child of file.children??[])visit(child);
    }
    visit(target);list.sort((a,b)=>a[0].localeCompare(b[0]));
    return JSON.stringify(list);
  }
  function backlinks(app,path) {
    return Object.entries(app.metadataCache?.resolvedLinks??{}).filter(([,targets])=>
      Object.keys(targets).some(target=>target===path||target.startsWith(path+'/'))).map(([source])=>source).sort();
  }
  async function prepare(app,name,input,scope,executeRaw,api) {
    safePath(input.path);safePath(input.new_path);
    const operations=[],folders=[],snapshots=[];
    const frozenScope=scope?{...scope}:undefined;
    const active=app.workspace.getActiveFile();
    const read=async file=>app.vault.read(file);
    const recordTarget=target=>snapshots.push({target,path:target.path,value:snapshot(app,target)});
    const recordText=async(file,transform)=>{
      const before=await read(file),after=transform(before);
      if(typeof after!=='string')throw new Error('修改结果不是文本。');
      if(before!==after){recordTarget(file);operations.push({type:'modify',file,path:file.path,before,after});}
      return after;
    };
    const vault=new Proxy(app.vault,{get(target,key){
      if(key==='process')return recordText;
      if(key==='createFolder')return async path=>{safePath(path);folders.push(path);};
      if(key==='create')return async(path,content)=>{
        safePath(path);if(app.vault.getAbstractFileByPath(path))throw new Error('目标路径已存在。');
        operations.push({type:'create',path,before:'',after:content});
      };
      if(['modify','modifyBinary','delete','trash','rename','append','createBinary'].includes(String(key)))return()=>{throw new Error('未预览的写入已阻止。');};
      if(key==='adapter')throw new Error('预览不能直接写入文件系统。');
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
    const fileManager=new Proxy(app.fileManager,{get(target,key){
      if(key==='processFrontMatter')return async(file,change)=>recordText(file,before=>{
        const info=api.getFrontMatterInfo(before);
        const parsed=info.exists?api.parseYaml(info.frontmatter):{};
        if(parsed!==null&&(typeof parsed!=='object'||Array.isArray(parsed)))throw new Error('笔记属性不是有效的 YAML 对象。');
        const frontmatter=Object.assign(Object.create(null),parsed??{});change(frontmatter);
        const nl=before.includes('\r\n')?'\r\n':'\n';
        const yaml=api.stringifyYaml(frontmatter).trimEnd().replace(/\r?\n/g,nl);
        const bom=before.startsWith('\uFEFF')?'\uFEFF':'';
        const body=info.exists?before.slice(info.contentStart):before.slice(bom.length);
        return bom+'---'+nl+yaml+nl+'---'+nl+body;
      });
      if(key==='renameFile')return async(file,to)=>{
        recordTarget(file);operations.push({type:'rename',file,path:file.path,to,
          files:JSON.parse(snapshot(app,file)).map(item=>item[0]),links:backlinks(app,file.path)});
      };
      if(key==='trashFile')return async file=>{
        recordTarget(file);operations.push({type:'delete',file,path:file.path,
          files:JSON.parse(snapshot(app,file)).map(item=>item[0]),
          trash:typeof app.vault.getConfig==='function'?app.vault.getConfig('trashOption'):null});
      };
      throw new Error('预览中不允许直接调用文件管理写入。');
    }});
    const workspace=new Proxy(app.workspace,{get(target,key){
      if(key==='getActiveFile')return()=>active;
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
    const stagedApp=new Proxy(app,{get(target,key){
      if(key==='vault')return vault;if(key==='fileManager')return fileManager;if(key==='workspace')return workspace;
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
    const result=await executeRaw(stagedApp,name,JSON.parse(JSON.stringify(input)),undefined,frozenScope);
    if(result.isError||!operations.length)return{result,operations:[]};
    const plan={name,operations,folders,result};
    plan.apply=async allowed=>{
      if(!allowed())throw new Error('已切换到只读或本轮已停止，未应用修改。');
      for(const saved of snapshots){
        const current=app.vault.getAbstractFileByPath(saved.path);
        if(current!==saved.target||snapshot(app,current)!==saved.value)throw new Error('预览期间文件发生变化，请重新生成修改预览。');
      }
      for(const op of operations){
        if(op.type==='create'&&app.vault.getAbstractFileByPath(op.path))throw new Error('预览期间目标路径已被创建，未覆盖文件。');
        if(op.type==='rename'&&(app.vault.getAbstractFileByPath(op.to)||JSON.stringify(backlinks(app,op.path))!==JSON.stringify(op.links)))throw new Error('目标路径或引用关系发生变化，请重新预览。');
        if(op.type==='delete'&&typeof app.vault.getConfig==='function'&&app.vault.getConfig('trashOption')!==op.trash)throw new Error('删除 / 回收站设置已变化，请重新预览。');
        if(op.type==='modify'&&await read(op.file)!==op.before)throw new Error('预览期间笔记内容已变化，未覆盖新内容。');
      }
      for(const folder of folders){
        if(!allowed())throw new Error('本轮已停止，未继续修改。');
        if(!app.vault.getFolderByPath(folder))await app.vault.createFolder(folder);
      }
      for(const op of operations){
        if(!allowed())throw new Error('本轮已停止，未继续修改。');
        if(op.type==='modify')await app.vault.process(op.file,current=>{
          if(!allowed()||op.file.path!==op.path||current!==op.before)throw new Error('文件或权限已变化，未应用修改。');
          return op.after;
        });
        else if(op.type==='create')await app.vault.create(op.path,op.after);
        else if(op.type==='rename')await app.fileManager.renameFile(op.file,op.to);
        else if(op.type==='delete')await app.fileManager.trashFile(op.file);
      }
      if(scope&&frozenScope)Object.assign(scope,frozenScope);
      return result;
    };
    return plan;
  }
  async function execute(app,name,input,onAskUser,scope,access,executeRaw,api){
    if(!writes.has(name))return executeRaw(app,name,input,onAskUser,scope);
    if(!access?.allowed?.())return{result:'Read-only mode: no files were changed. Answer in chat; editing requires editable mode and a new request.',isError:true};
    try{
      const plan=await prepare(app,name,input,scope,executeRaw,api);
      if(!plan.operations.length)return plan.result;
      if(!access.allowed())return{result:'This turn was stopped or made read-only before preview. No changes applied.',isError:true};
      if(!await access.confirm(plan)){
        access.cancel?.();
        return{result:'The user cancelled the change. No files were changed. Do not retry or perform any further writes in this turn.',isError:true};
      }
      return await plan.apply(access.allowed);
    }catch(error){return{result:'修改未完成：'+(error instanceof Error?error.message:String(error)),isError:true};}
  }
  return{actions,prompt,mode,policy,diff,prepare,execute,isWrite:name=>writes.has(name),
    toolsFor:(tools,canWrite)=>canWrite?tools:tools.filter(tool=>!writes.has(tool.name))};
}

module.exports={createStudySupport};
