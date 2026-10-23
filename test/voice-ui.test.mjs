import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import * as assets from '../assets.mjs';
import * as voices from '../voices.mjs';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import \{[^}]+\} from '\/(?:assets|voices)\.mjs';\s*/gm, '');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

// Run the actual UI handlers, retaining pending responses to exercise stale checks and failures.
async function createUI() {
  let focused;
  const element = (tagName = '') => ({
    tagName, value: '', textContent: '', hidden: false, disabled: false, dataset: {}, children: [],
    listeners: {}, attributes: {}, classList: { add() {}, remove() {} },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; }, toggleAttribute() {},
    replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
    reportValidity() { return true; }, focus() { focused = this; }, select() {}, click() {}, remove() {},
    set innerHTML(_value) { throw new Error('Character voices must use DOM text, not HTML interpolation.'); },
  });
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const get = id => elements.get(id);
  for (const [id, value] of Object.entries({ 'output-format': 'h3', timing: 'cued', 'seconds-per-chunk': '10', 'chunk-count': '4', mode: 't2v', duration: '5', creativity: 'faithful', audio: 'natural', music: 'auto', 'connection-kind': 'ollama', 'asset-new-type': 'picture' })) get(id).value = value;
  for (const id of ['example-confirmation', 'asset-review', 'storyboard-report-section']) get(id).hidden = true;
  const requests = [];
  const response = (data, ok = true) => ({ ok, status: ok ? 200 : 502, json: async () => data });
  const context = createContext({
    ...assets, ...voices,
    document: { getElementById: get, addEventListener() {}, createElement: element, body: { append() {} } },
    window: {}, navigator: {}, URL, Blob, AbortController, clearTimeout,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    fetch: async (path, options) => {
      if (path === '/api/status?refresh=1') return response({ version: '1.4.0', connectionFingerprint: 'fixture', hosting: { label: 'test' }, settings: { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'fixture' }, provider: { available: true, model: 'fixture' } });
      return new Promise(resolve => requests.push({ path, input: JSON.parse(options.body), resolve }));
    },
  });
  runInContext(source, context);
  await new Promise(setImmediate);
  return {
    get, requests, focused: () => focused,
    set(id, value, event = 'change') { get(id).value = value; get(id).listeners[event](); },
    click: id => get(id).listeners.click(),
    generate: () => get('rewrite-form').listeners.submit({ preventDefault() {} }),
    finish(index, data, ok = true) { requests[index].resolve(response(data, ok)); },
  };
}

const nodes = node => [node, ...node.children.flatMap(nodes)];
function row(ui, index = 0) {
  const card = ui.get('voice-list').children[index];
  const all = nodes(card);
  return { card, name: all.find(node => node.tagName === 'input'), preset: all.find(node => node.tagName === 'select'), description: all.find(node => node.tagName === 'textarea'), remove: all.find(node => node.tagName === 'button') };
}
function input(control, value, event = 'input') { control.value = value; control.listeners[event](); }
function addVoice(ui, name = 'Captain Mira', preset = voices.VOICE_PRESETS[0]) {
  ui.click('voice-add');
  const controls = row(ui, ui.get('voice-list').children.length - 1);
  input(controls.name, name);
  input(controls.preset, preset.id, 'change');
  return controls;
}
const valid = { errors: [], warnings: [] };

test('voices start empty and expose both named groups with fifteen presets each', async () => {
  const ui = await createUI();
  assert.equal(ui.get('voice-list').children.length, 0);
  ui.click('voice-add');
  const controls = row(ui);
  assert.equal(ui.focused(), controls.name);
  assert.equal(controls.name.maxLength, 80);
  assert.equal(controls.description.maxLength, 1000);
  assert.equal(controls.preset.children[0].textContent, 'Choose a voice');
  const groups = controls.preset.children.filter(node => node.tagName === 'optgroup');
  assert.deepEqual(groups.map(group => group.label), ['Adult female', 'Adult male']);
  assert.deepEqual(groups.map(group => group.children.length), [15, 15]);
  assert.ok(groups.flatMap(group => group.children).every(option => /^.+ — .+$/.test(option.textContent)));
  assert.equal(ui.requests.length, 0);
});

test('preset descriptions autofill, remain editable, and travel with the character name', async () => {
  const ui = await createUI();
  ui.get('prompt').value = 'Captain Mira says hello.';
  const controls = addVoice(ui);
  assert.equal(controls.description.value, voices.VOICE_PRESETS[0].description);
  input(controls.description, 'Custom low, calm speaking delivery.');
  const pending = ui.generate();
  assert.deepEqual(ui.requests[0].input.characterVoices, [{ id: controls.card.dataset.voiceId, name: 'Captain Mira', presetId: voices.VOICE_PRESETS[0].id, description: 'Custom low, calm speaking delivery.' }]);
  assert.equal(ui.get('voice-add').disabled, true);
  assert.ok([controls.name, controls.preset, controls.description, controls.remove].every(control => control.disabled));
  ui.finish(0, { text: 'Formatted dialogue.', validation: valid }); await pending;
  assert.equal(controls.description.value, 'Custom low, calm speaking delivery.');
  input(controls.preset, voices.VOICE_PRESETS[1].id, 'change');
  assert.equal(controls.description.value, voices.VOICE_PRESETS[1].description, 'Choosing another preset explicitly replaces the description');
  assert.equal(ui.get('output').value, 'Formatted dialogue.');
  assert.equal(ui.get('validation-title').textContent, 'Changes need a check');
});

test('empty voice rows are not silently removed from the submitted data', async () => {
  const ui = await createUI();
  ui.get('prompt').value = 'A character speaks.';
  ui.click('voice-add');
  const pending = ui.generate();
  assert.equal(ui.requests[0].input.characterVoices.length, 1);
  assert.equal(ui.requests[0].input.characterVoices[0].name, '');
  ui.finish(0, { error: 'Add a character name.' }, false); await pending;
  assert.equal(ui.get('voice-list').children.length, 1);
});

test('voice drafts survive mode and format changes without altering assets or previous output', async () => {
  const ui = await createUI();
  const controls = addVoice(ui);
  input(controls.description, 'Edited voice description.');
  ui.get('prompt').value = 'Captain Mira looks toward the door.';
  ui.get('output').value = 'Keep the earlier output.';
  ui.set('mode', 'i2v');
  ui.click('asset-add');
  const card = ui.get('asset-list').children[0];
  input(nodes(card).find(node => node.tagName === 'textarea'), 'Captain Mira at the door.');
  ui.set('output-format', 'storyboard');
  ui.set('output-format', 'h3');
  ui.set('mode', 't2v');
  assert.equal(row(ui).card.dataset.voiceId, controls.card.dataset.voiceId);
  assert.equal(row(ui).name.value, 'Captain Mira');
  assert.equal(row(ui).description.value, 'Edited voice description.');
  assert.equal(ui.get('asset-list').children[0].dataset.assetId, card.dataset.assetId);
  assert.equal(ui.get('prompt').value, 'Captain Mira looks toward the door.');
  assert.equal(ui.get('output').value, 'Keep the earlier output.');
  assert.equal(ui.requests.length, 0);
});

test('voice edits and removal invalidate pending validation, and failed rewrites preserve them', async () => {
  const ui = await createUI();
  const controls = addVoice(ui);
  ui.get('prompt').value = 'Captain Mira speaks.';
  ui.get('output').value = 'Earlier result';
  const checking = ui.click('validate-button');
  input(controls.description, 'Edited during validation.');
  ui.finish(0, valid); await checking;
  assert.equal(ui.get('validation-title').textContent, 'Changes need a check');
  const generating = ui.generate();
  const before = row(ui).card.dataset.voiceId;
  ui.click('voice-add'); controls.remove.listeners.click();
  assert.equal(ui.get('voice-list').children.length, 1, 'Mutation handlers are guarded while generating');
  ui.finish(1, { error: 'Synthetic unavailable model.' }, false); await generating;
  assert.equal(row(ui).card.dataset.voiceId, before);
  assert.equal(row(ui).description.value, 'Edited during validation.');
  assert.equal(ui.get('output').value, 'Earlier result');
  const checkingRemoval = ui.click('validate-button');
  row(ui).remove.listeners.click();
  ui.finish(2, valid); await checkingRemoval;
  assert.equal(ui.get('voice-list').children.length, 0);
  assert.equal(ui.get('validation-title').textContent, 'Changes need a check');
  assert.equal(ui.focused(), ui.get('voice-add'));
});

test('sixteen rows are allowed and removal reopens capacity without changing remaining IDs', async () => {
  const ui = await createUI();
  for (let index = 0; index < 17; index++) ui.click('voice-add');
  assert.equal(ui.get('voice-list').children.length, 16);
  assert.equal(ui.get('voice-add').disabled, true);
  const preservedId = row(ui, 1).card.dataset.voiceId;
  row(ui).remove.listeners.click();
  assert.equal(ui.get('voice-list').children.length, 15);
  assert.equal(row(ui).card.dataset.voiceId, preservedId);
  assert.equal(ui.get('voice-add').disabled, false);
});
