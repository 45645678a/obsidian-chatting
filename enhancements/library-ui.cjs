'use strict';
function mountBookPicker(plugin,host,options){
  const doc=host.ownerDocument;host.classList.add('ochatting-book-picker');
  const make=(label,cls)=>{const row=doc.createElement('label');row.className='ochatting-book-row';const name=doc.createElement('span');name.textContent=label;
    const select=doc.createElement('select');select.className=cls;select.setAttribute('aria-label',label);row.append(name,select);host.appendChild(row);return select;};
  const book=make('书籍','ochatting-book-select'),chapter=make('章节','ochatting-chapter-select'),section=make('小节','ochatting-section-select');
  const fill=(select,items,value,placeholder)=>{select.replaceChildren();const empty=doc.createElement('option');empty.value='';empty.textContent=placeholder;select.appendChild(empty);
    for(const item of items){const option=doc.createElement('option');option.value=item.key;option.textContent=item.title;select.appendChild(option);}select.value=value??'';};
  function update(){
    const state=options.selection(),library=plugin.getBookLibrary();
    fill(book,[...library,{key:'free:',title:'自由对话'}],state.book,options.filter?'全部书籍':'请选择书籍');
    const current=library.find(item=>item.key===state.book);
    fill(chapter,current?.chapters??[],state.chapter,options.filter?'全部章节':'请选择章节');chapter.disabled=!current;
    const selected=current?.chapters.find(item=>item.key===state.chapter);
    fill(section,selected?[{key:selected.key,title:'整章共用对话'},...selected.sections.map(item=>({...item,title:item.title+(item.exists?'':'（历史记录）')}))]:[],state.scope,
      options.filter?'全部小节':'请选择小节或整章对话');section.disabled=!selected;
  }
  book.onchange=()=>{const state={book:book.value,chapter:'',scope:book.value==='free:'?'free:':''};options.change(state,'book');update();};
  chapter.onchange=()=>{options.change({...options.selection(),chapter:chapter.value,scope:''},'chapter');update();};
  section.onchange=()=>{options.change({...options.selection(),scope:section.value},'scope');update();};
  update();return{update,destroy(){host.remove();}};
}

function mountConversationControls(plugin,host,settingsOnly=false){
  const doc=host.ownerDocument;host.classList.add('ochatting-conversation-library');
  const add=(tag,cls,text,parent=host)=>{const el=doc.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;parent.appendChild(el);return el;};
  const pickerHost=add('div','');const report=error=>new import_obsidian12.Notice(error.message??String(error));
  const hierarchy=mountBookPicker(plugin,pickerHost,{selection:()=>plugin.getBookBrowse(),change:(state,action)=>{void plugin.changeBookBrowse(state,action).catch(report);}});
  let picker,status,create;
  if(!settingsOnly){
    const row=add('div','ochatting-conversation-row');picker=add('select','ochatting-conversation-picker',undefined,row);picker.setAttribute('aria-label','当前小节的历史对话');
    picker.onchange=()=>{if(picker.value)void plugin.requestConversation({id:picker.value}).catch(report);};
    create=add('button','ochatting-conversation-new','新对话',row);create.type='button';create.onclick=()=>void plugin.newConversation().catch(report);
    const history=add('button','ochatting-conversation-history','历史',row);history.type='button';history.onclick=()=>showConversationHistory(plugin);
    status=add('div','ochatting-conversation-status');
  }
  const label=add('label','ochatting-conversation-follow'),follow=add('input','',undefined,label);follow.type='checkbox';add('span','','跟随正在阅读的笔记',label);
  follow.onchange=()=>void plugin.setConversationFollow(follow.checked).catch(report);
  let destroyed=false;
  const control={element:host,update(){
    if(destroyed)return;hierarchy.update();const selected=plugin.getBookBrowse(),active=plugin.activeConversation();
    follow.checked=plugin.settings.followActiveNote!==false;follow.disabled=selected.book==='free:';
    if(picker){
      picker.replaceChildren();const placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent=selected.scope?'当前范围的对话':'请先选择书籍、章节和小节';picker.appendChild(placeholder);
      const records=(plugin.conversationStore?.conversations??[]).filter(c=>!c.archived&&chatBookLibrary.matches(c,selected)).sort((a,b)=>b.updatedAt-a.updatedAt);
      if(selected.scope)for(const record of records){const option=doc.createElement('option');option.value=record.id;option.textContent=record.title;picker.appendChild(option);}
      picker.value=selected.scope&&records.some(record=>record.id===active?.id)?active.id:'';picker.disabled=!selected.scope||plugin.conversationChanging;
      create.disabled=!selected.scope||plugin.conversationChanging||!!plugin.pendingConversationRequest;
      status.textContent=plugin.pendingConversationRequest?'当前回答完成后切换对话':active?'当前：'+active.title:'';status.title=active?.path??'';
    }
  },destroy(){if(destroyed)return;destroyed=true;hierarchy.destroy();plugin.conversationControls.delete(control);host.remove();}};
  control.update();return control;
}

function showConversationHistory(plugin){
  plugin.captureActiveConversation();const modal=new import_obsidian12.Modal(plugin.app);plugin.conversationHistoryModals.add(modal);
  modal.onClose=()=>plugin.conversationHistoryModals.delete(modal);
  modal.onOpen=()=>{
    modal.modalEl.classList.add('ochatting-history-modal');modal.titleEl.textContent='历史对话';const root=modal.contentEl,doc=root.ownerDocument;
    const add=(tag,cls,text,parent=root)=>{const el=doc.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;parent.appendChild(el);return el;};
    const current=plugin.getBookBrowse();let filter={book:current.book,chapter:current.chapter,scope:''};
    const filters=add('div','ochatting-history-filters');
    const hierarchy=mountBookPicker(plugin,filters,{filter:true,selection:()=>filter,change:state=>{filter=state;render();}});
    const search=add('input','ochatting-history-search');search.type='search';search.placeholder='搜索标题或聊天内容';search.setAttribute('aria-label','搜索历史对话');
    const label=add('label','ochatting-conversation-follow'),archived=add('input','',undefined,label);archived.type='checkbox';add('span','','包含已归档的对话',label);
    const count=add('div','ochatting-history-count'),list=add('div','ochatting-history-list');const report=error=>new import_obsidian12.Notice(error.message??String(error));
    function render(){
      const records=chatConversations.search(plugin.conversationStore,search.value,archived.checked).filter(c=>chatBookLibrary.matches(c,filter)&&
        (c.chatHistory.length||c.draft?.text||c.draft?.images?.length||c.archived||c.id===plugin.conversationStore.activeId));
      list.replaceChildren();count.textContent=records.length+' 段对话';if(!records.length){add('p','ochatting-history-empty','这个范围内没有匹配的历史对话。',list);return;}
      for(const record of records){
        const card=add('section','ochatting-history-card',undefined,list);card.dataset.conversationId=record.id;
        const heading=add('div','ochatting-history-title',record.title,card);
        add('div','ochatting-history-meta',chatConversations.label(record.kind)+(record.archived?' · 已归档':'')+' · '+new Date(record.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),card);
        if(record.path)add('div','ochatting-history-path',record.path,card);
        const last=[...record.chatHistory].reverse().find(m=>(m.type==='assistant'||m.type==='user')&&m.text);
        add('div','ochatting-history-excerpt',last?last.text.replace(/\s+/g,' ').slice(0,160):'尚未发送消息',card);
        const actions=add('div','ochatting-history-actions',undefined,card);
        const open=add('button','mod-cta',record.archived?'恢复并打开':'打开',actions);open.type='button';open.onclick=()=>void plugin.requestConversation({id:record.id}).then(()=>modal.close()).catch(report);
        const rename=add('button','','重命名对话',actions);rename.type='button';let input=null;
        rename.onclick=()=>{if(!input){input=doc.createElement('input');input.type='text';input.value=record.title;input.setAttribute('aria-label','对话标题');heading.replaceChildren(input);rename.textContent='保存标题';input.focus();input.select();input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();rename.click();}};}else void plugin.renameConversation(record.id,input.value).then(render).catch(report);};
        const archive=add('button','',record.archived?'取消归档':'归档',actions);archive.type='button';archive.onclick=()=>void plugin.archiveConversation(record.id,!record.archived).then(render).catch(report);
      }
    }
    search.oninput=render;archived.onchange=render;render();
  };
  modal.open();return modal;
}
module.exports={mountBookPicker,mountConversationControls,showConversationHistory};
