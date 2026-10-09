import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { api, settings } from './harness.mjs';

// A settings row as Obsidian hands it to a definition's render(); records its controls.
function row() {
  const r = { controls: [], settingEl: { parentElement: {} } };
  const add = extra => fn => { const c = { options: [], setValue(v) { c.value = v; return c; }, onChange(f) { c.change = f; return c; }, ...extra(() => c) }; r.controls.push(c); fn(c); return r; };
  r.setName = name => { r.name = name; return r; };
  r.setDesc = desc => { r.desc = desc; return r; };
  r.addDropdown = add(c => ({ addOption(value, label) { c().options.push([value, label]); return c(); } }));
  r.addText = add(c => ({
    listeners: {}, inputEl: { addEventListener(type, f) { c().listeners[type] = f; } },
    setPlaceholder(p) { c().placeholder = p; return c(); }, getValue() { return c().value; },
    // A keystroke (input event), and leaving the field or pressing Enter (change event).
    type(v) { c().value = v; return c().change?.(v); },
    async leave() { c().listeners.change?.(); await new Promise(setImmediate); },
  }));
  return r;
}

let previousWindow, refreshes;
beforeEach(() => {
  previousWindow = globalThis.window;
  globalThis.window = { setTimeout(fn) { fn(); }, clearTimeout() {} };
  globalThis.__providerRequest = async () => assert.fail('No catalog request without a key');
});
afterEach(() => { globalThis.window = previousWindow; });

function settingsTab(provider) {
  const plugin = { settings: { ...settings(provider), apiKey: '' }, saves: 0, async saveSettings() { plugin.saves++; }, reloadApiKeyForProvider() {} };
  const tab = new api.ChatSettingTab({}, plugin);
  refreshes = 0;
  tab.display = () => { refreshes++; };
  const definitions = tab.getSettingDefinitions();
  const definition = name => definitions.find(d => d.name === name);
  const render = name => { const r = row(); definition(name).render(r); return r; };
  return { plugin, tab, definition, render };
}

test('Settings: "Custom..." is UI state only and never saves an empty model', async () => {
  for (const provider of ['openai', 'anthropic', 'chatgpt-oauth']) {
    const { plugin, definition, render } = settingsTab(provider);
    plugin.chatgptOAuth = { getCredential: () => null };
    const original = plugin.settings.model;
    let dropdown = render('Model').controls[0];
    assert.equal(dropdown.value, original);
    assert.ok(dropdown.options.some(([value, label]) => value === '__custom__' && label === 'Custom...'));
    assert.equal(definition('Custom model ID').visible(), false);

    await dropdown.change('__custom__');
    assert.equal(plugin.settings.model, original);
    assert.equal(plugin.saves, 0);
    assert.equal(refreshes, 1);
    assert.equal(definition('Custom model ID').visible(), true);
    assert.equal(render('Model').controls[0].value, '__custom__');

    // The ID field starts with the current model; the placeholder is the provider's default.
    const field = render('Custom model ID').controls[0];
    assert.equal(field.value, original);
    assert.equal(field.placeholder, { openai: 'gpt-6.1-sol', anthropic: 'claude-sonnet-4-6', 'chatgpt-oauth': 'gpt-5.5' }[provider]);
    // Deleting the ID key by key saves nothing, and an empty field is never saved.
    for (let end = original.length - 1; end >= 0; end--) await field.type(original.slice(0, end));
    await field.leave();
    await field.type('   ');
    await field.leave();
    assert.equal(plugin.settings.model, original);
    assert.equal(plugin.saves, 0);
    // A typed ID is saved once the field is left.
    for (const typed of [' f', ' future', ' future-model ']) await field.type(typed);
    assert.equal(plugin.saves, 0);
    await field.leave();
    assert.equal(plugin.settings.model, 'future-model');
    assert.equal(plugin.saves, 1);

    // Picking a listed model again hides the field.
    dropdown = render('Model').controls[0];
    assert.ok(dropdown.options.some(([value, label]) => value === 'future-model' && label === 'future-model (current)'));
    await dropdown.change(original);
    assert.equal(plugin.settings.model, original);
    assert.equal(plugin.saves, 2);
    assert.equal(refreshes, 2);
    assert.equal(definition('Custom model ID').visible(), false);
  }
});

test('Settings: changing the provider leaves "Custom..."', async () => {
  const { plugin, definition, render } = settingsTab('openai');
  await render('Model').controls[0].change('__custom__');
  assert.equal(definition('Custom model ID').visible(), true);
  await render('Provider').controls[0].change('anthropic');
  assert.equal(plugin.settings.model, 'claude-sonnet-4-6');
  assert.equal(definition('Custom model ID').visible(), false);
});

test('Settings: closing the settings leaves "Custom..."', async () => {
  const { plugin, tab, definition, render } = settingsTab('openai');
  await render('Model').controls[0].change('__custom__');
  assert.equal(definition('Custom model ID').visible(), true);
  tab.hide();
  assert.equal(definition('Custom model ID').visible(), false);
  assert.equal(render('Model').controls[0].value, plugin.settings.model);
});

test('Settings before Obsidian 1.13: display() shows the custom model ID row only while "Custom..." is picked', async () => {
  const { tab, render } = settingsTab('openai');
  const dropdown = render('Model').controls[0];
  // Only the wiring of display() is under test here; the rows have their own tests.
  const shown = [];
  const ignore = () => {};
  Object.assign(tab, { containerEl: { empty: ignore }, renderProvider: ignore, renderApiKeySection: ignore, renderModelSection: ignore,
    renderWebSearch: ignore, renderMaxIterations: ignore, loadCatalog: async () => {}, renderCustomModel: setting => shown.push(setting) });
  delete tab.display;
  tab.display();
  assert.equal(shown.length, 0);
  await dropdown.change('__custom__');
  assert.equal(shown.length, 1);
});

test('Settings load: the iteration limit from data.json stays within 1 to 100; below 1 is the default', async () => {
  // Whole numbers as the settings field reads them (parseInt); 0 meant the default before.
  for (const [saved, loaded] of [[1000, 100], [100, 100], [1, 1], [0, 20], [0.5, 20], [-5, 20], [7.6, 7], [Infinity, 20], [NaN, 20], ['50', 20], [42, 42]]) {
    const plugin = new api.ChatPlugin();
    plugin.app = { secretStorage: { getSecret: () => '' } };
    plugin.loadData = async () => ({ maxIterations: saved });
    await plugin.loadSettings();
    assert.equal(plugin.settings.maxIterations, loaded, String(saved));
  }
});
