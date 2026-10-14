'use strict';
const {createStudySupport}=require('./study-support.cjs');
const {showStudyChangePreview,mountStudyControls,StudyPluginMethods}=require('./study-ui.cjs');
const marker='// Local reviewed editing and study shortcuts, 2026-10-13.';
function patchStudy(source){
  if(source.includes(marker))throw new Error('Study feature patch is already present.');
  function replace(before,after){
    if(source.split(before).length!==2)throw new Error('Unexpected plugin source near: '+before.slice(0,130));
    source=source.replace(before,()=>after);
  }
  replace('async function executeTool(app, toolName, input, onAskUser, scope) {',
    marker+'\nvar studySupport=('+createStudySupport.toString()+')();\n'+
    showStudyChangePreview.toString()+'\n'+mountStudyControls.toString()+`\nasync function executeTool(app, toolName, input, onAskUser, scope, access) {
  return studySupport.execute(app,toolName,input,onAskUser,scope,access,executeToolWithoutPreview,import_obsidian);
}
async function executeToolWithoutPreview(app, toolName, input, onAskUser, scope) {`);
  replace('  settings.reasoningEffortOverrides = chatReasoning.normalizeOverrides(value.reasoningEffortOverrides);',
    '  settings.reasoningEffortOverrides = chatReasoning.normalizeOverrides(value.reasoningEffortOverrides);\n  settings.editMode = studySupport.mode(value.editMode);');

  const methods=Object.getOwnPropertyNames(StudyPluginMethods.prototype).filter(name=>name!=='constructor')
    .map(name=>StudyPluginMethods.prototype[name].toString()).join('\n');
  replace('  reasoningControls = new Set();',
    '  studyControls = new Set();\n  pendingStudyPreviews = new Set();\n  studySelection = null;\n  studySettingsSave = null;\n'+methods+'\n  reasoningControls = new Set();');
  replace('    await this.saveData(toSave);\n    this.refreshReasoningControls();',
    '    await this.saveData(toSave);\n    this.refreshStudyControls();\n    this.refreshReasoningControls();');
  replace('    this.addSettingTab(new ChatSettingTab(this.app, this));',
    '    this.addSettingTab(new ChatSettingTab(this.app, this));\n    this.initializeStudyFeatures();');
  replace('  onunload() {\n    for (const control of [...this.reasoningControls]) control.destroy();',
    '  onunload() {\n    this.cancelStudyPreviews();\n    for (const control of [...this.studyControls]) control.destroy();\n    for (const control of [...this.reasoningControls]) control.destroy();');

  replace('      { name: "思考强度", aliases: ["Reasoning effort", "思考程度"], render: (setting) => this.renderReasoningEffort(setting) },',
    '      { name: "笔记修改权限", aliases: ["Read only", "只读", "可编辑"], render: (setting) => this.renderStudyAccess(setting) },\n'+
    '      { name: "思考强度", aliases: ["Reasoning effort", "思考程度"], render: (setting) => this.renderReasoningEffort(setting) },');
  replace('    this.renderReasoningEffort(new import_obsidian7.Setting(containerEl));',
    '    this.renderStudyAccess(new import_obsidian7.Setting(containerEl));\n    this.renderReasoningEffort(new import_obsidian7.Setting(containerEl));');
  replace('  renderReasoningEffort(setting) {',`  renderStudyAccess(setting) {
    this.studyControl?.destroy();
    setting.setName("笔记修改权限").setDesc("只读模式禁止写入；可编辑模式下，每次修改都需预览确认。");
    setting.settingEl.classList.add("ochatting-study-setting");
    const host=setting.controlEl.ownerDocument.createElement("div");setting.controlEl.appendChild(host);
    this.studyControl=this.plugin.mountStudyControls(host,false);
  }
  renderReasoningEffort(setting) {`);
  replace('    super.hide();\n    this.reasoningControl?.destroy();',
    '    super.hide();\n    this.studyControl?.destroy();\n    this.studyControl=null;\n    this.reasoningControl?.destroy();');
  replace('  refreshSettingsTab() {\n    this.plugin.refreshReasoningControls();',
    '  refreshSettingsTab() {\n    this.plugin.refreshStudyControls();\n    this.plugin.refreshReasoningControls();');

  replace('  mountChat() {\n    this.reasoningControl?.destroy();',
    '  mountChat() {\n    this.studyControl?.destroy();\n    this.reasoningControl?.destroy();');
  replace('      this.reasoningControl=this.plugin.mountReasoningControl(host,true);',
    '      this.reasoningControl=this.plugin.mountReasoningControl(host,true);\n'+
    '      const studyHost=container.ownerDocument.createElement("div");\n'+
    '      chatRoot.insertBefore(studyHost,chatRoot.querySelector(".ochatting-messages"));\n'+
    '      this.studyControl=this.plugin.mountStudyControls(studyHost,true);');
  replace('  async onClose() {\n    this.reasoningControl?.destroy();',
    '  async onClose() {\n    this.studyControl?.destroy();\n    this.studyControl=null;\n    this.reasoningControl?.destroy();');
  replace('    this.chatContainer?.setSelection(selection);',
    '    this.chatContainer?.setSelection(selection);\n    this.plugin.setStudySelection(selection);');
  replace('  function clearSelection() {\n    set(selection, null);',
    '  function clearSelection() {\n    set(selection, null);\n    $$props.component.plugin.clearStudySelection();');
  replace('    this.running = true;\n    chat.addUserMessage(',
    '    this.running = true;\n    this.plugin.refreshStudyControls();\n    chat.addUserMessage(');
  replace('        this.running = false;\n        chat.setInputEnabled(true);',
    '        this.running = false;\n        this.plugin.refreshStudyControls();\n        chat.setInputEnabled(true);');
  replace('  handleStop() {\n    this.runVersion++;',
    '  handleStop() {\n    this.plugin.cancelStudyPreviews();\n    this.runVersion++;');
  replace('    this.plugin.agent.abort();\n    this.running = false;',
    '    this.plugin.agent.abort();\n    this.running = false;\n    this.plugin.refreshStudyControls();');
  replace('  handleClear() {\n    this.runVersion++;',
    '  handleClear() {\n    this.plugin.cancelStudyPreviews();\n    this.plugin.clearStudySelection();\n    this.runVersion++;');
  replace('      await this.plugin.agent.run(text2, {\n        onThinking:',
    '      await this.plugin.agent.run(text2, {\n        onExecuteTool: (name,input,onAskUser,scope,access) => this.plugin.executeStudyTool(name,input,onAskUser,scope,access),\n        onThinking:');

  replace('    const turnSettings = { ...this.settings, reasoningEffortOverrides: { ...this.settings.reasoningEffortOverrides } };',
    '    const turnSettings = { ...this.settings, reasoningEffortOverrides: { ...this.settings.reasoningEffortOverrides } };\n'+
    '    const writeContext = {cancelled:false, allowed:()=>!isStopped() && !writeContext.cancelled &&\n'+
    '      studySupport.mode(turnSettings.editMode)==="edit" && studySupport.mode(this.settings.editMode)==="edit" && !selection?.studyReadOnly};');
  replace('    const systemPrompt = buildSystemPrompt();\n    debugLog(this.app, "USER_MESSAGE",',
    '    const systemPrompt = buildSystemPrompt()+studySupport.policy(writeContext.allowed());\n    debugLog(this.app, "USER_MESSAGE",');
  replace('          TOOL_DEFINITIONS,\n          systemPrompt,',
    '          studySupport.toolsFor(TOOL_DEFINITIONS,writeContext.allowed()),\n          systemPrompt,');
  replace(`        const result = await executeTool(
          this.app,
          tc.name,
          tc.input,
          callbacks.onAskUser,
          scope
        );`,
    `        const result = callbacks.onExecuteTool ?
          await callbacks.onExecuteTool(tc.name,tc.input,callbacks.onAskUser,scope,writeContext) :
          await executeTool(this.app,tc.name,tc.input,callbacks.onAskUser,scope);`);
  replace('- Never ask for confirmation before using a tool. Just use it. The user can see what you did.',
    '- In read-only mode, answer in chat without writes. In editable mode, call the requested tool; the plugin presents its own preview and confirmation. Do not add a duplicate ask_user confirmation.');
  return source;
}
module.exports={patchStudy,marker};
