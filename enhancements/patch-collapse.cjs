'use strict';
const marker='// Collapsible assistant options, 2026-10-13.';
function patchCollapse(source){
  if(source.includes(marker))throw new Error('Options collapse patch is already present.');
  function replace(before,after){if(source.split(before).length!==2)throw new Error('Unexpected source: '+before.slice(0,100));source=source.replace(before,()=>after);}
  replace(`    if(chatRoot) {
      const host=container.ownerDocument.createElement("div");
      chatRoot.insertBefore(host,chatRoot.querySelector(".ochatting-messages"));
      this.reasoningControl=this.plugin.mountReasoningControl(host,true);
      const studyHost=container.ownerDocument.createElement("div");
      chatRoot.insertBefore(studyHost,chatRoot.querySelector(".ochatting-messages"));
      this.studyControl=this.plugin.mountStudyControls(studyHost,true);
    }`,`${marker}
    if(chatRoot) {
      const doc=container.ownerDocument;
      const options=doc.createElement("details");options.className="ochatting-options";
      options.open=this.plugin.settings.optionsExpanded===true;
      const summary=doc.createElement("summary");summary.className="ochatting-options-summary";
      const title=doc.createElement("span");title.textContent="助手选项";
      const state=doc.createElement("span");state.className="ochatting-options-state";
      summary.append(title,state);options.appendChild(summary);
      chatRoot.insertBefore(options,chatRoot.querySelector(".ochatting-messages"));
      this.optionsEl=options;this.optionsSummaryEl=state;
      const host=doc.createElement("div");options.appendChild(host);
      this.reasoningControl=this.plugin.mountReasoningControl(host,true);
      const studyHost=doc.createElement("div");options.appendChild(studyHost);
      this.studyControl=this.plugin.mountStudyControls(studyHost,true);
      this.registerDomEvent(options,"toggle",()=>{
        if(this.plugin.settings.optionsExpanded===options.open)return;
        this.plugin.settings.optionsExpanded=options.open;
        this.plugin.optionsSave=(this.plugin.optionsSave??Promise.resolve()).catch(()=>{}).then(()=>this.plugin.saveSettings());
        void this.plugin.optionsSave.catch(error=>console.error("Could not save assistant options state",error));
      });
      this.updateOptionsSummary();
    }`);
  replace('  updateModel(name) {\n    this.chatContainer?.setModel(name);\n  }',`  updateModel(name) {
    this.chatContainer?.setModel(name);
    this.updateOptionsSummary();
  }
  updateOptionsSummary() {
    if(!this.optionsSummaryEl)return;
    const mode=studySupport.mode(this.plugin.settings.editMode)==="edit"?"可编辑 · 先预览":"只读";
    const state=this.plugin.getReasoningState();
    this.optionsSummaryEl.textContent=mode+(state.effective?" · 思考"+chatReasoning.label(state.effective):"");
  }`);
  replace('  settings.editMode = studySupport.mode(value.editMode);',
    '  settings.editMode = studySupport.mode(value.editMode);\n  settings.optionsExpanded = value.optionsExpanded === true;');
  replace('refreshStudyControls(){\n    for(const control of [...this.studyControls]){if(control.element.isConnected)control.update();else control.destroy();}\n  }',
    'refreshStudyControls(){\n    for(const control of [...this.studyControls]){if(control.element.isConnected)control.update();else control.destroy();}\n    this.getChatView()?.updateOptionsSummary();\n  }');
  replace(`refreshReasoningControls() {
    for(const control of [...this.reasoningControls]) {
      if(control.element.isConnected)control.update();
      else control.destroy();
    }
  }`,`refreshReasoningControls() {
    for(const control of [...this.reasoningControls]) {
      if(control.element.isConnected)control.update();
      else control.destroy();
    }
    this.getChatView()?.updateOptionsSummary();
  }`);
  return source;
}
module.exports={patchCollapse,marker};
