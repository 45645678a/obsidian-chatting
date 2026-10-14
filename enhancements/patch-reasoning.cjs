'use strict';
const {createReasoningSupport,mountReasoningControl,ReasoningPluginMethods}=require('./reasoning-support.cjs');
const marker='// Local reasoning-effort selector, 2026-10-13.';

function patchReasoning(source) {
  if(source.includes(marker))throw new Error('The reasoning slider patch is already present.');
  function replace(before,after) {
    if(source.split(before).length!==2)throw new Error('Unexpected plugin code at: '+before.slice(0,100));
    source=source.replace(before,()=>after);
  }
  const originalReasoning=`function oauthReasoning(model) {
  const option = activeModels.get("chatgpt-oauth")?.find((m) => m.value === model);
  if (option?.reasoningEfforts) {
    const efforts = option.reasoningEfforts;
    if (!efforts.length) return void 0;
    const effort = option.defaultReasoningEffort && efforts.includes(option.defaultReasoningEffort) ? option.defaultReasoningEffort : efforts.includes("medium") ? "medium" : efforts[0];
    return option.supportsReasoningSummary === false ? { effort } : { effort, summary: "auto" };
  }
  return supportsReasoning(model) ? { effort: "medium", summary: "auto" } : void 0;
}`;
  replace(originalReasoning,marker+'\nvar chatReasoning=('+createReasoningSupport.toString()+')();\n'+
    mountReasoningControl.toString()+`\nfunction oauthReasoning(model, settings) {
  const option=activeModels.get("chatgpt-oauth")?.find(m=>m.value===model);
  return chatReasoning.request(model,option,settings?.reasoningEffortOverrides,supportsReasoning);
}`);
  replace('const reasoning = oauthReasoning(model);','const reasoning = oauthReasoning(model, settings);');
  replace('  settings.modelCatalog = normalizeCatalogState(value.modelCatalog);',
    '  settings.modelCatalog = normalizeCatalogState(value.modelCatalog);\n'+
    '  settings.reasoningEffortOverrides = chatReasoning.normalizeOverrides(value.reasoningEffortOverrides);');
  replace('    const turnSettings = { ...this.settings };',
    '    const turnSettings = { ...this.settings, reasoningEffortOverrides: { ...this.settings.reasoningEffortOverrides } };');

  const methods=Object.getOwnPropertyNames(ReasoningPluginMethods.prototype).filter(name=>name!=='constructor')
    .map(name=>ReasoningPluginMethods.prototype[name].toString()).join('\n');
  replace('  async saveSettings() {','  reasoningControls = new Set();\n  reasoningSave = null;\n'+methods+'\n  async saveSettings() {');
  replace('    await this.saveData(toSave);\n    this.getChatView()?.updateModel(',
    '    await this.saveData(toSave);\n    this.refreshReasoningControls();\n    this.getChatView()?.updateModel(');
  replace('  onunload() {\n    this.agent?.abort();',
    '  onunload() {\n    for (const control of [...this.reasoningControls]) control.destroy();\n    this.agent?.abort();');

  replace('      { name: "Web search", render: (setting) => this.renderWebSearch(setting) },',
    '      { name: "思考强度", aliases: ["Reasoning effort", "思考程度"], render: (setting) => this.renderReasoningEffort(setting) },\n'+
    '      { name: "Web search", render: (setting) => this.renderWebSearch(setting) },');
  replace('    this.renderWebSearch(new import_obsidian7.Setting(containerEl));',
    '    this.renderReasoningEffort(new import_obsidian7.Setting(containerEl));\n'+
    '    this.renderWebSearch(new import_obsidian7.Setting(containerEl));');
  replace('  renderWebSearch(setting) {',`  renderReasoningEffort(setting) {
    this.reasoningControl?.destroy();
    setting.setName("思考强度").setDesc("与聊天栏同步，按模型记住选择。");
    setting.settingEl.classList.add("ochatting-reasoning-setting");
    const host=setting.controlEl.ownerDocument.createElement("div");
    setting.controlEl.appendChild(host);
    this.reasoningControl=this.plugin.mountReasoningControl(host,false);
  }
  renderWebSearch(setting) {`);
  replace('    super.hide();\n    this.hidden = true;',
    '    super.hide();\n    this.reasoningControl?.destroy();\n    this.reasoningControl = null;\n    this.hidden = true;');
  replace('  refreshSettingsTab() {\n    if (this.hidden) return;',
    '  refreshSettingsTab() {\n    this.plugin.refreshReasoningControls();\n    if (this.hidden) return;');

  replace('  mountChat() {\n    const container = this.contentEl;',
    '  mountChat() {\n    this.reasoningControl?.destroy();\n    const container = this.contentEl;');
  replace('    this.chatContainer.focus();',`    const chatRoot=container.querySelector(".ochatting-container");
    if(chatRoot) {
      const host=container.ownerDocument.createElement("div");
      chatRoot.insertBefore(host,chatRoot.querySelector(".ochatting-messages"));
      this.reasoningControl=this.plugin.mountReasoningControl(host,true);
    }
    this.chatContainer.focus();`);
  replace('  async onClose() {\n    this.handleStop();',
    '  async onClose() {\n    this.reasoningControl?.destroy();\n    this.reasoningControl = null;\n    this.handleStop();');
  return source;
}

module.exports={patchReasoning,marker};
