import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { numberAssets, serializeAssets, MAX_ASSETS, MAX_ASSET_DESCRIPTION_LENGTH, MAX_REFERENCE_NOTES_LENGTH } from '../assets.mjs';
import { VOICE_PRESETS, VOICE_GROUPS, MAX_CHARACTER_VOICES, MAX_VOICE_DESCRIPTION_LENGTH, MAX_CHARACTER_NAME_LENGTH } from '../voices.mjs';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import \{[^}]+\} from '\/(?:assets|voices)\.mjs';\s*/gm, '');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

// Execute shipped event handlers against a small DOM with deferred synthetic API responses.
async function createUI(providerKind = 'ollama') {
  const element = (tagName = '') => ({
    tagName, value: '', textContent: '', hidden: false, disabled: false, dataset: {}, children: [],
    listeners: {}, attributes: {}, classList: { add() {}, remove() {} },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; }, toggleAttribute() {},
    replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
    reportValidity() { return true; }, focus() {}, select() {}, click() {}, remove() {},
  });
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const get = (id) => elements.get(id);
  for (const [id, value] of Object.entries({ 'output-format': 'h3', timing: 'cued', 'seconds-per-chunk': '10', 'chunk-count': '4', mode: 't2v', duration: '5', creativity: 'faithful', audio: 'natural', music: 'auto', 'connection-kind': 'ollama', 'asset-new-type': 'picture' })) get(id).value = value;
  for (const id of ['example-confirmation', 'asset-review', 'storyboard-report-section']) get(id).hidden = true;
  const requests = [];
  const timeouts = [];
  let copied = '';
  const response = (data, ok = true) => ({ ok, status: ok ? 200 : 502, json: async () => data });
  const context = createContext({
    document: { getElementById: get, addEventListener() {}, createElement: element, body: { append() {} } },
    window: {}, navigator: { clipboard: { writeText: async (text) => { copied = text; } } }, URL, Blob, AbortController, clearTimeout,
    numberAssets, serializeAssets, MAX_ASSETS, MAX_ASSET_DESCRIPTION_LENGTH, MAX_REFERENCE_NOTES_LENGTH,
    VOICE_PRESETS, VOICE_GROUPS, MAX_CHARACTER_VOICES, MAX_VOICE_DESCRIPTION_LENGTH, MAX_CHARACTER_NAME_LENGTH,
    setTimeout(fn, ms) { timeouts.push(ms); const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    fetch: async (path, options) => {
      if (path === '/api/status?refresh=1') return response({ version: '1.5.0', connectionFingerprint: 'fixture', hosting: { label: 'test' }, settings: { kind: providerKind, baseUrl: 'http://127.0.0.1:11434', model: 'fixture' }, provider: { available: true, model: 'fixture' } });
      return new Promise((resolve) => requests.push({ path, input: JSON.parse(options.body), resolve }));
    },
  });
  runInContext(source, context);
  await new Promise(setImmediate);
  return {
    get, requests, timeouts, copied: () => copied,
    set(id, value, event = 'change') { get(id).value = value; get(id).listeners[event](); },
    click: (id) => get(id).listeners.click(),
    generate: () => get('rewrite-form').listeners.submit({ preventDefault() {} }),
    finish(index, data, ok = true) { requests[index].resolve(response(data, ok)); },
  };
}

function nodes(node) { return [node, ...node.children.flatMap(nodes)]; }
function addPicture(ui, description = 'A red robot on a neutral background.') {
  ui.click('asset-add');
  const card = ui.get('asset-list').children.at(-1);
  const input = nodes(card).find((node) => node.tagName === 'textarea');
  input.value = description; input.listeners.input();
  return card.dataset.assetId;
}

const valid = { errors: [], warnings: [] };
const script = '[shared]\nA red robot.\n\n[chunk 1]\nThe robot waves.';

test('Fluff up is discoverable beside the brief while faithful remains the default', async () => {
  const ui = await createUI();
  const select = html.match(/<select id="creativity"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(select);
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]), ['faithful', 'enrich', 'fluff']);
  assert.equal(ui.get('creativity').value, 'faithful');
  assert.ok(html.indexOf('id="creativity"') < html.indexOf('id="more-options"'), 'Creative freedom is outside the collapsed options');
  assert.match(html, /aria-describedby="creativity-help"/);
  assert.match(html, /expands your idea first, then formats it for H3/);
  assert.match(html, /two AI passes when you format/);
  assert.match(html, /without adding plot, characters, or dialogue/);
  assert.equal(ui.requests.length, 0);
});

test('Fluff up travels through every H3 mode and storyboard using the normal rewrite request', async () => {
  for (const mode of ['t2v', 'i2v', 'fl2v', 'l2v', 'reference', 'storyboard']) {
    const ui = await createUI();
    ui.get('prompt').value = 'A red robot waves.';
    if (mode === 'storyboard') ui.set('output-format', 'storyboard');
    else ui.set('mode', mode);
    if (mode !== 't2v') addPicture(ui);
    if (mode === 'fl2v') addPicture(ui, 'The same red robot with its hand lowered.');
    ui.set('creativity', 'fluff', 'input');
    assert.equal(ui.requests.length, 0, 'Selecting Fluff up never starts a request');
    const pending = ui.generate();
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].path, '/api/rewrite');
    assert.equal(ui.requests[0].input.creativity, 'fluff', mode);
    assert.equal(ui.requests[0].input.mode, mode === 'storyboard' ? 'reference' : mode);
    assert.equal(ui.requests[0].input.outputFormat, mode === 'storyboard' ? 'storyboard' : 'h3');
    assert.equal(ui.get('input-fields').disabled, true);
    ui.finish(0, { text: mode === 'storyboard' ? script : 'Expanded prompt.', validation: valid });
    await pending;
  }
});

test('Fluff up allows both AI passes to finish for either provider without changing ordinary timeouts', async () => {
  for (const [providerKind, creativity, timeout, wording] of [
    ['openrouter', 'fluff', 310000, /Both AI passes can take up to five minutes/],
    ['ollama', 'fluff', 310000, /Both AI passes can take up to five minutes/],
    ['openrouter', 'faithful', 130000, /up to two minutes/],
    ['openrouter', 'enrich', 130000, /up to two minutes/],
    ['ollama', 'faithful', 310000, /up to five minutes/],
  ]) {
    const ui = await createUI(providerKind);
    ui.get('prompt').value = 'A red robot waves.';
    ui.set('creativity', creativity, 'input');
    const pending = ui.generate();
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.timeouts.at(-1), timeout, `${providerKind}/${creativity}`);
    assert.match(ui.get('feedback').textContent, wording);
    ui.finish(0, { text: 'Completed prompt.', validation: valid }); await pending;
    assert.equal(ui.get('output').value, 'Completed prompt.');
  }
});

test('detail choices preserve drafts across formats and failures, and invalidate pending checks', async () => {
  const ui = await createUI();
  ui.set('mode', 'i2v');
  ui.get('prompt').value = 'Mira waves beside a red robot.';
  ui.get('exact-text').value = 'Ready.';
  ui.get('output').value = 'Earlier result';
  const assetId = addPicture(ui);
  ui.click('voice-add');
  const voice = ui.get('voice-list').children[0];
  const voiceNodes = nodes(voice);
  const name = voiceNodes.find(node => node.tagName === 'input');
  name.value = 'Mira'; name.listeners.input();
  const preset = voiceNodes.find(node => node.tagName === 'select');
  preset.value = VOICE_PRESETS[0].id; preset.listeners.change();
  const description = voiceNodes.find(node => node.tagName === 'textarea');
  description.value = 'An edited warm speaking voice.'; description.listeners.input();
  const checking = ui.click('validate-button');
  ui.set('creativity', 'fluff', 'input');
  ui.finish(0, valid); await checking;
  assert.equal(ui.get('validation-title').textContent, 'Changes need a check');
  ui.set('output-format', 'storyboard');
  ui.set('output-format', 'h3');
  assert.equal(ui.get('mode').value, 'i2v');
  assert.equal(ui.get('creativity').value, 'fluff');
  for (const choice of ['enrich', 'faithful', 'fluff']) ui.set('creativity', choice, 'input');
  assert.equal(ui.requests.length, 1);
  const generating = ui.generate();
  assert.equal(ui.requests[1].input.characterVoices[0].description, 'An edited warm speaking voice.');
  ui.finish(1, { error: 'Synthetic unavailable model.' }, false); await generating;
  assert.equal(ui.get('creativity').value, 'fluff');
  assert.equal(ui.get('prompt').value, 'Mira waves beside a red robot.');
  assert.equal(ui.get('exact-text').value, 'Ready.');
  assert.equal(ui.get('output').value, 'Earlier result');
  assert.equal(ui.get('asset-list').children[0].dataset.assetId, assetId);
  assert.equal(ui.get('voice-list').children[0].dataset.voiceId, voice.dataset.voiceId);
  assert.equal(description.value, 'An edited warm speaking voice.');
});

test('format switches preserve all drafts and restore the previous H3 mode without requests', async () => {
  const ui = await createUI();
  ui.set('mode', 'l2v');
  ui.set('timing', 'natural');
  ui.get('prompt').value = 'A robot reaches its seated final pose.';
  ui.get('exact-text').value = 'Keep this exact text.';
  ui.get('output').value = 'Previous output';
  ui.get('duration').value = '7.5';
  const id = addPicture(ui, 'Seated robot final frame.');
  ui.set('output-format', 'storyboard');
  assert.equal(ui.get('mode').value, 'reference');
  assert.equal(ui.get('mode').disabled, true);
  assert.equal(ui.get('timing').disabled, true);
  assert.equal(ui.get('timing-field').hidden, true);
  assert.match(ui.get('timing-help').textContent, /always use local event-time cues/);
  assert.equal(ui.get('duration').disabled, true);
  assert.equal(ui.get('duration-field').hidden, true);
  assert.equal(ui.get('seconds-per-chunk').disabled, false);
  assert.equal(ui.get('storyboard-settings').hidden, false);
  assert.equal(ui.get('reference-field').hidden, false);
  assert.equal(ui.get('output').value, 'Previous output');
  ui.set('output-format', 'h3');
  assert.equal(ui.get('mode').value, 'l2v');
  assert.equal(ui.get('mode').disabled, false);
  assert.equal(ui.get('timing').disabled, false);
  assert.equal(ui.get('timing-field').hidden, false);
  assert.equal(ui.get('timing').value, 'natural');
  assert.equal(ui.get('duration').value, '7.5');
  assert.equal(ui.get('duration').disabled, false);
  assert.equal(ui.get('seconds-per-chunk').disabled, true);
  assert.equal(ui.get('chunk-count').disabled, true);
  assert.equal(ui.get('asset-list').children[0].dataset.assetId, id);
  assert.equal(ui.get('prompt').value, 'A robot reaches its seated final pose.');
  assert.equal(ui.get('exact-text').value, 'Keep this exact text.');
  assert.equal(ui.get('output').value, 'Previous output');
  assert.equal(ui.requests.length, 0);
});

test('storyboard generation sends typed chunk settings, timing, and full references', async () => {
  const ui = await createUI();
  ui.set('output-format', 'storyboard');
  ui.get('prompt').value = 'A red robot waves, walks, and sits.';
  addPicture(ui);
  ui.set('seconds-per-chunk', '8.5', 'input');
  ui.set('chunk-count', '3', 'input');
  ui.set('timing', 'natural');
  const pending = ui.generate();
  assert.equal(ui.requests[0].path, '/api/rewrite');
  assert.equal(ui.requests[0].input.outputFormat, 'storyboard');
  assert.equal(ui.requests[0].input.mode, 'reference');
  assert.equal(ui.requests[0].input.timing, 'cued');
  assert.deepEqual(ui.requests[0].input.storyboard, { secondsPerChunk: 8.5, chunkCount: 3 });
  assert.equal(ui.requests[0].input.assets.length, 1);
  assert.equal(ui.requests[0].input.connectionFingerprint, 'fixture');
  assert.equal(ui.get('input-fields').disabled, true);
  ui.finish(0, { text: script, storyboardReport: '24 fps; overlap22; timeline details.', validation: valid });
  await pending;
  assert.equal(ui.get('output').value, script);
  assert.equal(ui.get('storyboard-report').textContent, '24 fps; overlap22; timeline details.');
  assert.equal(ui.get('storyboard-report-section').hidden, false);
  assert.equal(ui.get('paste-seconds-per-chunk').textContent, '8.5');
  assert.equal(ui.get('paste-chunk-count').textContent, '3');
  await ui.click('copy-button');
  assert.equal(ui.copied(), script, 'Reports and paste help must not enter the copied script');
});

test('normal H3 generation defaults to cued timing and omits storyboard settings', async () => {
  const ui = await createUI();
  ui.get('prompt').value = 'A paper boat floats through a puddle.';
  const pending = ui.generate();
  assert.equal(ui.requests[0].input.outputFormat, 'h3');
  assert.equal(ui.requests[0].input.timing, 'cued');
  assert.equal(ui.requests[0].input.mode, 't2v');
  assert.equal(ui.requests[0].input.storyboard, undefined);
  ui.finish(0, { text: 'H3 formatted prompt.', validation: valid }); await pending;
  assert.equal(ui.get('storyboard-report-section').hidden, true);
});

test('new controls invalidate in-flight validation and preserve the output', async () => {
  for (const [id, value, event] of [['output-format', 'storyboard', 'change'], ['timing', 'natural', 'change'], ['seconds-per-chunk', '6', 'input'], ['chunk-count', '2', 'input']]) {
    const ui = await createUI();
    ui.get('output').value = 'An existing output to check.';
    const pending = ui.click('validate-button');
    ui.set(id, value, event);
    ui.finish(0, { validation: valid }); await pending;
    assert.equal(ui.get('validation-title').textContent, 'Changes need a check', id);
    assert.equal(ui.get('output').value, 'An existing output to check.');
  }
});

test('old storyboard reports and paste settings remain attached to their script after edits or failures', async () => {
  const ui = await createUI();
  ui.set('output-format', 'storyboard');
  ui.get('prompt').value = 'A red robot waves.'; addPicture(ui);
  let pending = ui.generate();
  ui.finish(0, { text: script, storyboardReport: 'Original timeline.', validation: valid }); await pending;
  ui.set('seconds-per-chunk', '12', 'input');
  ui.set('chunk-count', '2', 'input');
  assert.equal(ui.get('paste-seconds-per-chunk').textContent, '10');
  assert.equal(ui.get('paste-chunk-count').textContent, '4');
  assert.match(ui.get('storyboard-settings-note').textContent, /last generated script/);
  assert.match(ui.get('storyboard-report-status').textContent, /changed/);
  pending = ui.generate();
  ui.finish(1, { error: 'Synthetic provider failure' }, false); await pending;
  assert.equal(ui.get('output').value, script);
  assert.equal(ui.get('storyboard-report').textContent, 'Original timeline.');
  ui.set('output-format', 'h3');
  assert.equal(ui.get('storyboard-paste-help').hidden, false, 'Old script keeps its paste instructions');
  assert.equal(ui.get('storyboard-report-section').hidden, false);
});
