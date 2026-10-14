'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createReasoningSupport,ReasoningPluginMethods}=require('./reasoning-support.cjs');
const {createStudySupport}=require('./study-support.cjs');
const {createConversationSupport}=require('./conversation-support.cjs');
const {patchReasoning,marker}=require('./patch-reasoning.cjs');
const support=createReasoningSupport();
const levels=['low','medium','high','xhigh','max','ultra'];
const astra={value:'gpt-6-astra',reasoningEfforts:levels,defaultReasoningEffort:'medium',supportsReasoningSummary:true};
const luna={value:'gpt-6-luna',reasoningEfforts:levels.slice(0,-1),defaultReasoningEffort:'medium'};
const settings={provider:'chatgpt-oauth',model:astra.value};
const originalPath=process.env.CHATTING_BASELINE || require('node:path').join(__dirname, '..', 'main.js');
const source=fs.readFileSync(originalPath,'utf8');
const patched=source.includes(marker)?source:patchReasoning(source);

test('patch is syntactically valid and retains the existing math repair',()=>{
  new vm.Script(patched);
  assert.ok(patched.includes('normalizeChatMath(value)'));
});

test('default selection matches model metadata without writing an override',()=>{
  const state=support.describe(settings,[astra]);
  assert.deepEqual(state.levels,levels);
  assert.equal(state.effective,'medium');assert.equal(state.isDefault,true);assert.equal(state.canReset,false);
  assert.equal(support.describe({...settings,model:'gpt-6.1-sol'},[{...astra,value:'gpt-6.1-sol',defaultReasoningEffort:'low'}]).effective,'low');
});

test('each model retains its own supported preference',()=>{
  const overrides={'chatgpt-oauth:gpt-6-astra':'ultra','chatgpt-oauth:gpt-6-luna':'high'};
  assert.equal(support.describe({...settings,reasoningEffortOverrides:overrides},[astra,luna]).effective,'ultra');
  const state=support.describe({...settings,model:luna.value,reasoningEffortOverrides:overrides},[astra,luna]);
  assert.equal(state.effective,'high');assert.equal(state.levels.length,5);
});

test('removed or unavailable levels fall back to a supported model default',()=>{
  const overrides={'chatgpt-oauth:gpt-6-luna':'ultra'};
  const state=support.describe({...settings,model:luna.value,reasoningEffortOverrides:overrides},[luna]);
  assert.equal(state.effective,'medium');assert.equal(state.isDefault,true);assert.equal(state.canReset,true);
  assert.equal(support.request(luna.value,luna,overrides,()=>true).effort,'medium');
});

test('unknown catalogs do not send unverified saved effort values',()=>{
  const overrides={'chatgpt-oauth:gpt-6-astra':'ultra'};
  assert.equal(support.describe({...settings,reasoningEffortOverrides:overrides},[]).enabled,false);
  assert.equal(support.request(astra.value,undefined,overrides,()=>true).effort,'medium');
  assert.equal(support.request('gpt-4.1',undefined,overrides,()=>false),undefined);
});

test('nonreasoning models and unsupported providers disable the slider',()=>{
  assert.equal(support.describe({...settings,provider:'anthropic'},[astra]).enabled,false);
  assert.equal(support.request(astra.value,{...astra,reasoningEfforts:[]},{},()=>true),undefined);
  assert.equal(support.describe(settings,[{...astra,reasoningEfforts:['medium']}]).enabled,false);
  assert.deepEqual(support.request(astra.value,{...astra,supportsReasoningSummary:false},{},()=>true),{effort:'medium'});
});

test('settings persistence keeps only well-formed model preferences',()=>{
  const input=JSON.parse('{"chatgpt-oauth:gpt-6-astra":"high","__proto__":{"bad":true},"anthropic:claude":"max","chatgpt-oauth:gpt-6-sol":42}');
  assert.deepEqual(support.normalizeOverrides(input),{'chatgpt-oauth:gpt-6-astra':'high'});
  const fn=patched.match(/function normalizeSettings\(value\) \{[\s\S]*?\n\}/)[0];
  const context=vm.createContext({chatReasoning:support,studySupport:createStudySupport(),chatConversations:createConversationSupport(),isRecord6:v=>!!v&&typeof v==='object',isProvider:v=>v==='chatgpt-oauth',normalizeCatalogState:v=>v});
  vm.runInContext(fn,context);
  assert.equal(context.normalizeSettings({provider:'chatgpt-oauth',reasoningEffortOverrides:input}).reasoningEffortOverrides['chatgpt-oauth:gpt-6-astra'],'high');
});

test('slider commits replace preference maps and reset removes only the selected model',async()=>{
  const context=vm.createContext({chatReasoning:support});
  vm.runInContext(ReasoningPluginMethods.toString()+';globalThis.Methods=ReasoningPluginMethods;',context);
  const p=new context.Methods();
  p.settings={...settings,reasoningEffortOverrides:{'chatgpt-oauth:gpt-6-luna':'high'}};
  p.getReasoningState=()=>support.describe(p.settings,[astra,luna]);
  p.refreshReasoningControls=()=>{};p.saveSettings=async()=>{};
  const before=p.settings.reasoningEffortOverrides;
  await p.setReasoningEffort('ultra','chatgpt-oauth:gpt-6-astra');
  assert.equal(before['chatgpt-oauth:gpt-6-astra'],undefined);
  assert.equal(p.settings.reasoningEffortOverrides['chatgpt-oauth:gpt-6-astra'],'ultra');
  await p.setReasoningEffort(null,'chatgpt-oauth:gpt-6-astra');
  assert.equal(p.settings.reasoningEffortOverrides['chatgpt-oauth:gpt-6-astra'],undefined);
  assert.equal(p.settings.reasoningEffortOverrides['chatgpt-oauth:gpt-6-luna'],'high');
});

test('real provider request builder forwards all advertised slider levels',async()=>{
  const sender=patched.match(/async function sendChatGPTOAuthMessage\([\s\S]*?\n\}/)[0];
  const resolver=patched.match(/function oauthReasoning\(model, settings\) \{[\s\S]*?\n\}/)[0];
  let captured;
  const context=vm.createContext({
    chatReasoning:support,activeModels:new Map([['chatgpt-oauth',[astra,luna]]]),supportsReasoning:()=>true,
    oauthService:{getUsableCredential:async()=>({accountId:'synthetic-test-account',accessToken:'synthetic-test-token'})},
    catalogIdentity:async()=>'synthetic-identity',cachedCatalog:()=>{},buildResponsesInput:()=>[],oauthParallelTools:()=>true,
    sendOnce:async body=>{captured=body;return{content:[]};},ChatGPTOAuthError:Error,ProviderError:class extends Error{},
    CHATGPT_OAUTH_DEFAULT_MODEL:'gpt-6-astra'
  });
  vm.runInContext(resolver+'\n'+sender,context);
  for(const level of levels) {
    await context.sendChatGPTOAuthMessage({...settings,reasoningEffortOverrides:{'chatgpt-oauth:gpt-6-astra':level}},[],[],'test');
    assert.equal(captured.reasoning.effort,level);assert.equal(captured.model,'gpt-6-astra');
    assert.equal(captured.stream,true);assert.equal(captured.store,false);
  }
  await context.sendChatGPTOAuthMessage({...settings,model:luna.value,reasoningEffortOverrides:{'chatgpt-oauth:gpt-6-luna':'ultra'}},[],[],'test');
  assert.equal(captured.reasoning.effort,'medium');
});
