'use strict';

function mountConversationControls(plugin,host,settingsOnly=false){
  const doc=host.ownerDocument;host.classList.add(settingsOnly?'ochatting-conversation-settings':'ochatting-conversation-bar');
  const add=(tag,cls,text,parent=host)=>{const el=doc.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;parent.appendChild(el);return el;};
  let picker,status,scope,follow;
  const report=error=>new import_obsidian12.Notice(error instanceof Error?error.message:String(error));
  if(!settingsOnly){
    const row=add('div','ochatting-conversation-row');
    picker=add('select','ochatting-conversation-picker',undefined,row);picker.setAttribute('aria-label','切换独立对话');
    picker.onchange=()=>void plugin.requestConversation({id:picker.value}).catch(report);
    const create=add('button','ochatting-conversation-new','新对话',row);create.type='button';
    create.onclick=()=>void plugin.newConversation().catch(report);
    const history=add('button','ochatting-conversation-history','历史',row);history.type='button';
    history.onclick=()=>showConversationHistory(plugin);
    status=add('div','ochatting-conversation-status');
  }else{
    const row=add('div','ochatting-conversation-row');
    add('span','ochatting-study-label','对话范围',row);
    scope=add('select','ochatting-conversation-scope',undefined,row);scope.setAttribute('aria-label','独立对话的归属范围');
    for(const[value,title]of [['note','按笔记'],['chapter','按章节（文件夹）'],['free','自由对话']]){const opt=add('option','',title,scope);opt.value=value;}
    scope.onchange=()=>void plugin.setConversationScope(scope.value).catch(report);
    const label=add('label','ochatting-conversation-follow');
    follow=add('input','',undefined,label);follow.type='checkbox';
    add('span','','切换笔记时自动接续对应对话',label);
    follow.onchange=()=>void plugin.setConversationFollow(follow.checked).catch(report);
    add('div','ochatting-study-mode-status','同一章节文件夹内的笔记可共用对话；历史记录保存在本机。');
  }
  let destroyed=false;
  const control={element:host,update(){
    if(destroyed)return;
    const store=plugin.conversationStore,active=plugin.activeConversation();
    if(picker){
      picker.replaceChildren();
      for(const type of ['note','chapter','free']){
        const group=doc.createElement('optgroup');group.label=chatConversations.label(type)+'对话';
        for(const item of store?.conversations.filter(c=>c.kind===type&&(!c.archived||c.id===store.activeId)).sort((a,b)=>b.updatedAt-a.updatedAt)??[]){
          const option=doc.createElement('option');option.value=item.id;option.textContent='['+chatConversations.label(item.kind)+'] '+item.title;option.title=item.path||item.title;group.appendChild(option);
        }
        if(group.children.length)picker.appendChild(group);
      }
      picker.value=store?.activeId??'';picker.disabled=plugin.conversationChanging||!active;
      if(plugin.pendingConversationRequest){
        const request=plugin.pendingConversationRequest;
        const next=request.id?store.conversations.find(c=>c.id===request.id)?.title:request.target?.path.split('/').pop()||'新对话';
        status.textContent='本次回答结束后切换到：'+next;
      }else status.textContent=active?(active.path||'不绑定笔记')+(active.archived?' · 已归档':''):'正在读取对话记录';
      status.title=status.textContent;
    }
    if(scope){scope.value=plugin.settings.conversationScope??'note';scope.disabled=plugin.conversationChanging;follow.checked=plugin.settings.followActiveNote!==false;follow.disabled=scope.value==='free';}
  },destroy(){if(destroyed)return;destroyed=true;plugin.conversationControls.delete(control);host.remove();}};
  control.update();return control;
}

function showConversationHistory(plugin){
  plugin.captureActiveConversation();
  const modal=new import_obsidian12.Modal(plugin.app);
  plugin.conversationHistoryModals.add(modal);
  modal.onClose=()=>plugin.conversationHistoryModals.delete(modal);
  modal.onOpen=()=>{
    modal.modalEl.classList.add('ochatting-history-modal');modal.titleEl.textContent='历史对话';
    const root=modal.contentEl,doc=root.ownerDocument;
    const add=(tag,cls,text,parent=root)=>{const el=doc.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;parent.appendChild(el);return el;};
    const search=add('input','ochatting-history-search');search.type='search';search.placeholder='搜索标题、笔记路径或聊天内容';search.setAttribute('aria-label','搜索历史对话');
    const label=add('label','ochatting-conversation-follow');const archived=add('input','',undefined,label);archived.type='checkbox';
    add('span','','包含已归档的对话',label);
    const count=add('div','ochatting-history-count');const list=add('div','ochatting-history-list');
    const report=error=>new import_obsidian12.Notice(error.message??String(error));
    function render(){
      const records=chatConversations.search(plugin.conversationStore,search.value,archived.checked);list.replaceChildren();count.textContent=records.length+' 段对话';
      if(!records.length){add('p','ochatting-history-empty','没有匹配的历史对话。',list);return;}
      for(const record of records){
        const card=add('section','ochatting-history-card',undefined,list);card.dataset.conversationId=record.id;
        const heading=add('div','ochatting-history-title',record.title,card);
        const metadata=chatConversations.label(record.kind)+(record.archived?' · 已归档':'')+' · '+
          new Date(record.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
        add('div','ochatting-history-meta',metadata,card);
        if(record.path)add('div','ochatting-history-path',record.path,card);
        const last=[...record.chatHistory].reverse().find(m=>(m.type==='assistant'||m.type==='user')&&m.text);
        add('div','ochatting-history-excerpt',last?last.text.replace(/\s+/g,' ').slice(0,160):'尚未发送消息',card);
        const actions=add('div','ochatting-history-actions',undefined,card);
        const open=add('button','mod-cta',record.archived?'恢复并打开':'打开',actions);open.type='button';
        open.onclick=()=>void plugin.requestConversation({id:record.id}).then(()=>modal.close()).catch(report);
        const rename=add('button','','重命名对话',actions);rename.type='button';let input=null;
        rename.onclick=()=>{
          if(!input){input=doc.createElement('input');input.type='text';input.value=record.title;input.setAttribute('aria-label','对话标题');heading.replaceChildren(input);rename.textContent='保存标题';input.focus();input.select();input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();rename.click();}};}
          else void plugin.renameConversation(record.id,input.value).then(render).catch(report);
        };
        const archive=add('button','',record.archived?'取消归档':'归档',actions);archive.type='button';
        archive.onclick=()=>void plugin.archiveConversation(record.id,!record.archived).then(render).catch(report);
      }
    }
    search.oninput=render;archived.onchange=render;render();search.focus();
  };
  modal.open();return modal;
}

module.exports={mountConversationControls,showConversationHistory};
