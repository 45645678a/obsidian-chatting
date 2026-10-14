'use strict';

// Self-contained so the local installer can embed exactly the tested code.
function createReasoningSupport() {
  const names = {none:'关闭',minimal:'最低',low:'低',medium:'中等',high:'高',xhigh:'很高',max:'极高',ultra:'最高'};
  const validEffort = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
  function normalizeOverrides(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, effort]) =>
      /^chatgpt-oauth:[a-zA-Z0-9._:/-]{1,160}$/.test(key) && validEffort(effort)).slice(0,200));
  }
  function availableLevels(option) {
    if (!Array.isArray(option?.reasoningEfforts)) return null;
    return [...new Set(option.reasoningEfforts.filter(validEffort))];
  }
  function defaultEffort(option, levels) {
    return levels.includes(option?.defaultReasoningEffort) ? option.defaultReasoningEffort :
      levels.includes('medium') ? 'medium' : levels[0];
  }
  function describe(settings, models) {
    const key = settings.provider+':'+settings.model;
    const overrides = normalizeOverrides(settings.reasoningEffortOverrides);
    const selected = overrides[key];
    const base = {key,levels:[],effective:null,defaultEffort:null,canReset:!!selected,isDefault:true,enabled:false};
    if (settings.provider !== 'chatgpt-oauth') {
      return {...base,message:'此滑块用于 ChatGPT 账号模式；当前服务沿用原有思考设置。'};
    }
    const option = models?.find(model => model.value === settings.model);
    const levels = availableLevels(option);
    if (!levels) return {...base,message:'尚未取得该模型的思考档位，可在设置中刷新模型列表。'};
    if (!levels.length) return {...base,message:'此模型没有提供可调节的思考档位。'};
    const fallback = defaultEffort(option,levels);
    const supported = levels.includes(selected);
    return {...base,levels,effective:supported?selected:fallback,defaultEffort:fallback,
      isDefault:!supported,enabled:levels.length>1,
      message:selected&&!supported?'已保存的档位暂不可用，当前采用模型默认。':
        levels.length===1?'此模型仅提供一个思考档位。':'越靠右思考越充分，通常等待更久；下次提问生效。'};
  }
  function request(model, option, overrides, supportsReasoning) {
    const levels = availableLevels(option);
    if (levels) {
      if (!levels.length) return undefined;
      const preferred = normalizeOverrides(overrides)['chatgpt-oauth:'+model];
      const effort = levels.includes(preferred) ? preferred : defaultEffort(option,levels);
      return option.supportsReasoningSummary === false ? {effort} : {effort,summary:'auto'};
    }
    // Preserve the upstream fallback; never send an unverified override.
    return supportsReasoning(model) ? {effort:'medium',summary:'auto'} : undefined;
  }
  return {normalizeOverrides,describe,request,label:effort=>names[effort]??effort};
}

function mountReasoningControl(plugin, host, showTitle) {
  const doc = host.ownerDocument;
  host.classList.add('ochatting-reasoning-host');
  const create = (tag, cls, parent=host) => {
    const element=doc.createElement(tag);
    element.className=cls;
    parent.appendChild(element);
    return element;
  };
  const top=create('div','ochatting-reasoning-top');
  if(showTitle) create('span','ochatting-reasoning-title',top).textContent='思考强度';
  const output=create('output','ochatting-reasoning-value',top);
  output.setAttribute('aria-live','polite');
  const reset=create('button','ochatting-reasoning-reset',top);
  reset.type='button';reset.textContent='恢复默认';
  reset.setAttribute('aria-label','恢复当前模型的默认思考强度');
  const slider=create('input','ochatting-reasoning-slider');
  slider.type='range';slider.step='1';slider.min='0';
  slider.setAttribute('aria-label','AI 思考强度');
  const ticks=create('div','ochatting-reasoning-ticks');
  ticks.setAttribute('aria-hidden','true');
  const help=create('div','ochatting-reasoning-help');
  let state;
  let previewKey;
  let destroyed=false;
  function showValue(effort,isDefault) {
    output.textContent=effort ? chatReasoning.label(effort)+' · '+effort+(isDefault?'（默认）':'') : '不可调节';
    slider.setAttribute('aria-valuetext',output.textContent);
    host.dataset.effort=effort??'';
    for(const tick of ticks.children) tick.classList.toggle('is-active',tick.dataset.effort===effort);
  }
  function update() {
    if(destroyed)return;
    state=plugin.getReasoningState();
    previewKey=state.key;
    slider.max=String(Math.max(1,state.levels.length-1));
    slider.value=String(Math.max(0,state.levels.indexOf(state.effective)));
    slider.disabled=!state.enabled;
    reset.disabled=!state.canReset;
    ticks.replaceChildren();
    for(const effort of state.levels) {
      const tick=create('span','ochatting-reasoning-tick',ticks);
      tick.textContent=chatReasoning.label(effort);tick.title=effort;tick.dataset.effort=effort;
    }
    help.textContent=state.message;
    showValue(state.effective,state.isDefault);
  }
  function onInput() {
    if(!state?.enabled)return;
    showValue(state.levels[Number(slider.value)],false);
  }
  function save(value) {
    void plugin.setReasoningEffort(value,previewKey).catch(error=>{
      console.error('Chatting with AI: could not save reasoning effort',error);
      help.textContent='保存失败，请重试。';
    });
  }
  function onChange(){if(state?.enabled)save(state.levels[Number(slider.value)]);}
  function onReset(){save(null);}
  slider.addEventListener('input',onInput);
  slider.addEventListener('change',onChange);
  reset.addEventListener('click',onReset);
  const control={element:host,update,destroy(){
    if(destroyed)return;destroyed=true;
    slider.removeEventListener('input',onInput);slider.removeEventListener('change',onChange);
    reset.removeEventListener('click',onReset);
    plugin.reasoningControls.delete(control);host.remove();
  }};
  update();
  return control;
}

class ReasoningPluginMethods {
  getReasoningState() {
    const settings=this.settings;
    const cached=settings.modelCatalog?.entries?.filter(entry=>entry.provider===settings.provider).at(-1);
    const models=getCatalogModels(settings.provider)??cached?.models;
    return chatReasoning.describe(settings,models);
  }
  mountReasoningControl(host,showTitle=true) {
    const control=mountReasoningControl(this,host,showTitle);
    this.reasoningControls.add(control);
    return control;
  }
  refreshReasoningControls() {
    for(const control of [...this.reasoningControls]) {
      if(control.element.isConnected)control.update();
      else control.destroy();
    }
  }
  async setReasoningEffort(value,expectedKey) {
    const state=this.getReasoningState();
    if(expectedKey!==state.key) {this.refreshReasoningControls();return;}
    if(value!==null&&!state.levels.includes(value))throw new Error('Unsupported reasoning effort for the selected model.');
    const previous=this.settings.reasoningEffortOverrides;
    const next={...chatReasoning.normalizeOverrides(previous)};
    if(value===null)delete next[state.key];else next[state.key]=value;
    // Replace the map so a turn already running keeps its own selection.
    this.settings.reasoningEffortOverrides=next;
    this.refreshReasoningControls();
    const save=async()=>{
      try {await this.saveSettings();}
      catch(error){
        if(this.settings.reasoningEffortOverrides===next) {
          this.settings.reasoningEffortOverrides=previous;
          this.refreshReasoningControls();
        }
        throw error;
      }
    };
    this.reasoningSave=(this.reasoningSave??Promise.resolve()).catch(()=>{}).then(save);
    return this.reasoningSave;
  }
}

module.exports={createReasoningSupport,mountReasoningControl,ReasoningPluginMethods};
