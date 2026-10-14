'use strict';

function showStudyChangePreview(plugin,plan){
  return new Promise(resolve=>{
    const modal=new import_obsidian12.Modal(plugin.app);
    const component=new import_obsidian12.Component();component.load();
    let accepted=false,closed=false;
    modal.onClose=()=>{
      if(closed)return;closed=true;plugin.pendingStudyPreviews.delete(modal);component.unload();resolve(accepted);
    };
    modal.onOpen=()=>{
      modal.modalEl.classList.add('ochatting-change-modal');
      modal.titleEl.textContent='预览 AI 对笔记的修改';
      const root=modal.contentEl,doc=root.ownerDocument;
      const add=(tag,cls,text,parent=root)=>{const el=doc.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;parent.appendChild(el);return el;};
      add('p','ochatting-change-intro','确认后才会写入；取消会阻止本轮后续修改。');
      for(const op of plan.operations){
        const card=add('section','ochatting-change-card');
        const labels={modify:'修改',create:'新建',rename:'重命名 / 移动',delete:'删除'};
        add('h3','ochatting-change-path',labels[op.type]+'：'+op.path,card);
        if(op.type==='modify'||op.type==='create'){
          const rows=studySupport.diff(op.before,op.after);
          const plus=rows.filter(row=>row.kind==='add').length,minus=rows.filter(row=>row.kind==='remove').length;
          add('div','ochatting-change-count',`新增 ${plus} 行，删除 ${minus} 行`,card);
          const tabs=add('div','ochatting-change-tabs',undefined,card);
          const diffButton=add('button','', '查看差异',tabs);diffButton.type='button';
          const renderButton=add('button','', '排版预览',tabs);renderButton.type='button';
          const difference=add('div','ochatting-change-diff',undefined,card);
          difference.setAttribute('aria-label','修改前后差异');
          for(const row of rows){
            const line=add('div','ochatting-diff-'+row.kind,undefined,difference);
            add('span','ochatting-diff-sign',row.kind==='add'?'+':row.kind==='remove'?'−':row.kind==='skip'?'…':' ',line);
            add('span','ochatting-diff-text',row.text||' ',line);
          }
          if(!rows.length)add('p','',op.type==='create'?'将创建一个空文件。':'内容没有变化。',difference);
          const preview=add('div','ochatting-change-render markdown-rendered',undefined,card);preview.hidden=true;
          let rendered=false;
          diffButton.onclick=()=>{difference.hidden=false;preview.hidden=true;};
          renderButton.onclick=()=>{
            difference.hidden=true;preview.hidden=false;
            if(!rendered){rendered=true;
              void import_obsidian12.MarkdownRenderer.render(plugin.app,op.after,preview,op.path,component)
                .then(()=>import_obsidian12.finishRenderMath?.()).catch(()=>{preview.textContent='无法排版，请查看差异或完整文本。';});
            }
          };
          const details=add('details','ochatting-change-full',undefined,card);
          add('summary','','查看完整文本',details);
          if(op.type==='modify'){add('h4','','修改前',details);add('pre','',op.before,details);}
          add('h4','','修改后',details);add('pre','',op.after,details);
        }else if(op.type==='rename'){
          add('p','ochatting-change-destination','新位置：'+op.to,card);
          const details=add('details','',undefined,card);add('summary','',`包含 ${op.files.length} 个文件 / 文件夹`,details);
          add('pre','',op.files.join('\n'),details);
          if(op.links.length){
            add('p','','Obsidian 可能按你的链接设置自动更新以下笔记中的内部链接：',card);
            add('pre','ochatting-change-files',op.links.join('\n'),card);
          }
        }else{
          const trash={system:'系统回收站',local:'Obsidian 回收站',none:'永久删除'};
          add('p','ochatting-change-delete','处理方式：'+(trash[op.trash]??'按当前 Obsidian 删除设置处理'),card);
          add('pre','ochatting-change-files',op.files.join('\n'),card);
        }
      }
      if(plan.folders.length)add('p','ochatting-change-folders','需要新建的文件夹：'+plan.folders.join('、'));
      const buttons=add('div','ochatting-change-buttons');
      const cancel=add('button','ochatting-change-cancel','取消本次修改',buttons);cancel.type='button';
      cancel.onclick=()=>modal.close();
      const apply=add('button','mod-cta ochatting-change-apply','应用修改',buttons);apply.type='button';
      apply.onclick=()=>{
        if(studySupport.mode(plugin.settings.editMode)!=='edit'){modal.close();return;}
        accepted=true;modal.close();
      };
      cancel.focus();
    };
    plugin.pendingStudyPreviews.add(modal);modal.open();
  });
}

function mountStudyControls(plugin,host,withActions){
  const doc=host.ownerDocument;host.classList.add('ochatting-study-controls');
  const add=(tag,cls,text,parent=host)=>{const el=doc.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;parent.appendChild(el);return el;};
  const row=add('div','ochatting-study-mode-row');
  add('span','ochatting-study-label','笔记权限',row);
  const select=add('select','ochatting-edit-mode',undefined,row);select.setAttribute('aria-label','AI 笔记修改权限');
  for(const [value,label] of [['read','只读问答'],['edit','可编辑（先预览）']]){const option=add('option','',label,select);option.value=value;}
  const status=add('span','ochatting-study-mode-status',undefined,row);
  select.onchange=()=>{void plugin.setStudyEditMode(select.value).catch(error=>{console.error(error);status.textContent='保存失败，请重试';});};
  let selectionLabel,buttons=[];
  if(withActions){
    selectionLabel=add('div','ochatting-study-selection');
    const actionRow=add('div','ochatting-study-actions');
    for(const action of studySupport.actions){
      const button=add('button','ochatting-study-action',action.label,actionRow);button.type='button';button.dataset.action=action.id;
      button.addEventListener('pointerdown',event=>event.preventDefault());
      button.onclick=()=>{void plugin.runStudyAction(action.id).catch(error=>new import_obsidian12.Notice(error.message));};
      buttons.push(button);
    }
  }
  let destroyed=false;
  const control={element:host,update(){
    if(destroyed)return;
    const mode=studySupport.mode(plugin.settings.editMode);select.value=mode;
    status.textContent=mode==='read'?'只在聊天栏回答':'每次写入先确认预览';host.dataset.mode=mode;
    if(withActions){
      const selection=plugin.getStudySelection();const running=!!plugin.getChatView()?.running;
      selectionLabel.textContent=selection?`已选 ${selection.text.length} 字 · ${selection.filePath.split('/').pop()}`:'先选中笔记中的公式或段落，再点下面的按钮';
      selectionLabel.title=selection?selection.text:'';
      for(const button of buttons)button.disabled=!selection||running;
    }
  },destroy(){if(destroyed)return;destroyed=true;plugin.studyControls.delete(control);host.remove();}};
  control.update();return control;
}

class StudyPluginMethods {
  refreshStudyControls(){
    for(const control of [...this.studyControls]){if(control.element.isConnected)control.update();else control.destroy();}
  }
  mountStudyControls(host,withActions=true){const control=mountStudyControls(this,host,withActions);this.studyControls.add(control);return control;}
  async setStudyEditMode(value){
    const mode=studySupport.mode(value);this.settings.editMode=mode;
    if(mode==='read')this.cancelStudyPreviews();
    this.refreshStudyControls();
    this.studySettingsSave=(this.studySettingsSave??Promise.resolve()).catch(()=>{}).then(()=>this.saveSettings());
    return this.studySettingsSave;
  }
  cancelStudyPreviews(){for(const modal of [...this.pendingStudyPreviews])modal.close();}
  async executeStudyTool(name,input,onAskUser,scope,context){
    const access={allowed:()=>studySupport.mode(this.settings.editMode)==='edit'&&context?.allowed?.()===true,
      confirm:plan=>showStudyChangePreview(this,plan),cancel:()=>{if(context)context.cancelled=true;}};
    return executeTool(this.app,name,input,onAskUser,scope,access);
  }
  getStudySelection(){
    const selected=this.studySelection??this.getChatView()?.chatContainer?.getSelection?.();
    return selected?.text?.trim()&&selected.filePath?selected:null;
  }
  setStudySelection(selection){this.studySelection=selection?.text?.trim()?{...selection}:null;this.refreshStudyControls();}
  clearStudySelection(){this.studySelection=null;this.refreshStudyControls();}
  captureStudySelection(doc){
    if(this.unloaded)return;
    const selected=doc.getSelection();
    if(!selected||selected.isCollapsed||!selected.rangeCount)return;
    const range=selected.getRangeAt(0);
    const node=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
    const leaf=this.app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.contentEl.contains(node));
    if(!leaf?.view.file)return;
    const view=leaf.view;
    if(view.getMode?.()==='source'&&view.editor?.getSelection()){
      this.setStudySelection(selectionScope(view.editor,view.editor.getSelection(),view.file.path));return;
    }
    const fragment=range.cloneContents();
    for(const math of fragment.querySelectorAll('mjx-container')){
      const latex=math.querySelector('mjx-math[data-latex]')?.getAttribute('data-latex');
      if(latex)math.replaceWith(doc.createTextNode((math.getAttribute('display')==='true'?'$$':'$')+latex+(math.getAttribute('display')==='true'?'$$':'$')));
    }
    for(const hidden of fragment.querySelectorAll('mjx-assistive-mml'))hidden.remove();
    for(const block of fragment.querySelectorAll('p,li,h1,h2,h3,h4,br,tr'))block.appendChild(doc.createTextNode('\n'));
    const text=fragment.textContent.trim();
    if(text)this.setStudySelection({text,filePath:view.file.path});
  }
  async runStudyAction(id,selection){
    const chosen=selection??this.getStudySelection();
    if(!chosen?.text?.trim())throw new Error('请先选中笔记中的公式或段落。');
    const view=await this.openChat();if(!view)return;
    if(view.running)throw new Error('请等待当前回答完成。');
    if(view.contentEl.querySelector('textarea')?.value.trim())throw new Error('输入框中有尚未发送的内容，请先发送或清空后再使用快捷按钮。');
    view.setSelection(chosen);
    await view.handleUserMessage(studySupport.prompt(id),{...chosen,studyReadOnly:true});
  }
  initializeStudyFeatures(){
    const documents=new WeakSet();
    const attach=doc=>{
      if(!doc||documents.has(doc))return;documents.add(doc);
      this.registerDomEvent(doc,'selectionchange',()=>{
        window.setTimeout(()=>this.captureStudySelection(doc),0);
      });
    };
    attach(document);
    for(const leaf of this.app.workspace.getLeavesOfType('markdown'))attach(leaf.view.contentEl.ownerDocument);
    this.registerEvent(this.app.workspace.on('window-open',(workspaceWindow,win)=>attach(win?.document??workspaceWindow?.win?.document)));
    for(const action of studySupport.actions){
      this.addCommand({id:'study-'+action.id,name:'学习：'+action.label,checkCallback:checking=>{
        const selection=this.getStudySelection();if(!selection)return false;
        if(!checking)void this.runStudyAction(action.id,selection).catch(error=>new import_obsidian12.Notice(error.message));return true;
      }});
    }
    this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,info)=>{
      const text=editor.getSelection();if(!text||!info.file)return;
      const selection=selectionScope(editor,text,info.file.path);this.setStudySelection(selection);
      for(const action of studySupport.actions)menu.addItem(item=>item.setTitle('AI · '+action.label).setIcon(action.icon)
        .onClick(()=>{void this.runStudyAction(action.id,selection).catch(error=>new import_obsidian12.Notice(error.message));}));
    }));
  }
}

module.exports={showStudyChangePreview,mountStudyControls,StudyPluginMethods};
