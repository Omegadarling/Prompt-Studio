import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { numberAssets, serializeAssets, MAX_ASSETS, MAX_ASSET_DESCRIPTION_LENGTH, MAX_REFERENCE_NOTES_LENGTH } from '../assets.mjs';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import \{[^}]+\} from '\/assets\.mjs';\s*/, '');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

// Exercise the shipped UI's event listeners with synthetic elements and no real inference.
async function createUI(options = {}) {
  const canvases = [];
  const revokedUrls = [];
  let objectUrlSequence = 0;
  const element = (tagName = '') => {
    const item = {
    tagName,
    value: '', textContent: '', hidden: false, disabled: false, dataset: {}, children: [],
    listeners: {}, attributes: {}, classList: { add() {}, remove() {} },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    removeEventListener(name) { delete this.listeners[name]; },
    setAttribute(name, value) { this.attributes[name] = value; }, toggleAttribute() {},
    removeAttribute(name) { this[name] = ''; delete this.attributes[name]; },
    replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
    reportValidity() { return true; }, focus() {}, select() {}, click() {}, remove() {},
    };
    if (tagName === 'canvas') {
      item.getContext = () => ({ fillRect() {}, drawImage() {} });
      item.toDataURL = () => { canvases.push({ width: item.width, height: item.height }); return 'data:image/jpeg;base64,cGljdHVyZQ=='; };
    }
    if (tagName === 'audio' || tagName === 'video') {
      item.duration = options.duration ?? 2;
      item.videoWidth = 1920; item.videoHeight = 1080;
      let currentTime = 0;
      Object.defineProperty(item, 'currentTime', { get: () => currentTime, set: (value) => { currentTime = value; queueMicrotask(() => item.listeners.seeked?.()); } });
      item.load = () => { if (item.src) queueMicrotask(() => { item.listeners.loadedmetadata?.(); item.listeners.loadeddata?.(); }); };
    }
    return item;
  };
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const get = (id) => elements.get(id);
  for (const [id, value] of Object.entries({ mode: 't2v', duration: '5', creativity: 'faithful', audio: 'natural', music: 'auto', 'connection-kind': 'ollama', 'asset-new-type': 'picture' })) get(id).value = value;
  get('example-confirmation').hidden = true;
  get('asset-review').hidden = true;
  let completeRewrite;
  let rewriteInput;
  const mediaRequests = [];
  const suggestionRequests = [];
  const response = (data) => ({ ok: true, status: 200, json: async () => data });
  const context = createContext({
    document: { getElementById: get, addEventListener() {}, createElement: element, body: { append() {} } },
    window: { confirm() { throw new Error('Native confirmation must never be opened.'); },
      AudioContext: class {
        async decodeAudioData() { return { duration: 2, length: 8, sampleRate: 4, numberOfChannels: 2, getChannelData: () => Float32Array.from([0, 0.5, -0.5, 1, -1, 0.25, -0.25, 0]) }; }
        createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
        async close() {}
      },
      OfflineAudioContext: class {
        constructor(channels, length, sampleRate) { assert.equal(channels, 1); assert.equal(sampleRate, 16000); this.length = length; this.destination = {}; }
        createBufferSource() { return { connect() {}, start() {} }; }
        async startRendering() { return { getChannelData: () => new Float32Array(this.length) }; }
      },
    },
    navigator: {}, URL: class extends URL {
      static createObjectURL() { return `blob:test-${++objectUrlSequence}`; }
      static revokeObjectURL(url) { revokedUrls.push(url); }
    }, Blob, AbortController, clearTimeout, numberAssets, serializeAssets,
    createImageBitmap: async () => ({ width: 4000, height: 2000, close() {} }),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    MAX_ASSETS, MAX_ASSET_DESCRIPTION_LENGTH, MAX_REFERENCE_NOTES_LENGTH,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    fetch: async (path, options) => {
      if (path === '/api/assets/describe' || path === '/api/assets/suggest') {
        const collection = path.endsWith('/describe') ? mediaRequests : suggestionRequests;
        return new Promise((resolve) => collection.push({ input: JSON.parse(options.body), resolve }));
      }
      if (path === '/api/rewrite') {
        rewriteInput = JSON.parse(options.body);
        return new Promise((resolve) => { completeRewrite = resolve; });
      }
      assert.equal(path, '/api/status?refresh=1');
      return response({
        version: '1.2.0', connectionFingerprint: 'synthetic', hosting: { label: 'Home server' },
        settings: { kind: 'ollama', baseUrl: 'http://192.168.1.20:11434', model: 'qwen3.5:latest' },
        provider: { available: true, model: 'qwen3.5:latest' },
      });
    },
  });
  runInContext(source, context);
  await new Promise(setImmediate);
  return { get, click: (id) => get(id).listeners.click(), change: (id, event = 'input') => get(id).listeners[event](),
    generate: () => get('rewrite-form').listeners.submit({ preventDefault() {} }),
    finish: () => completeRewrite(response({ text: 'Generated output', validation: { errors: [], warnings: [] } })),
    fail: (error = 'Ollama stopped before the prompt was complete.', code) => completeRewrite({ ok: false, status: 502, json: async () => ({ error, code }) }),
    payload: () => rewriteInput,
    upload: (files) => { get('asset-files-input').files = files; return get('asset-files-input').listeners.change(); },
    mediaRequests, suggestionRequests, canvases, revokedUrls,
    completeMedia: (index, result, ok = true) => mediaRequests[index].resolve({ ok, status: ok ? 200 : 502, json: async () => result }),
    completeSuggestion: (index, result, ok = true) => suggestionRequests[index].resolve({ ok, status: ok ? 200 : 502, json: async () => result }),
  };
}

test('an empty draft loads the selected example directly without a native dialog', async () => {
  const ui = await createUI();
  ui.get('output').value = 'Keep this result';
  ui.click('example-button');
  assert.match(ui.get('prompt').value, /clay robot/);
  assert.equal(ui.get('output').value, 'Keep this result');
  assert.equal(ui.get('example-confirmation').hidden, true);
});

test('existing brief, references, and protected text remain until explicit second click', async () => {
  const ui = await createUI();
  ui.get('prompt').value = 'My brief';
  ui.get('reference-notes').value = 'My references';
  ui.get('exact-text').value = 'Keep these words';
  ui.get('output').value = 'Keep this result';
  ui.click('example-button');
  assert.equal(ui.get('prompt').value, 'My brief');
  assert.equal(ui.get('reference-notes').value, 'My references');
  assert.equal(ui.get('exact-text').value, 'Keep these words');
  assert.equal(ui.get('example-confirmation').hidden, false);
  assert.equal(ui.get('example-label').textContent, 'Replace with example');
  assert.equal(ui.get('example-button').attributes['aria-expanded'], 'true');
  ui.click('example-button');
  assert.match(ui.get('prompt').value, /clay robot/);
  assert.equal(ui.get('reference-notes').value, '');
  assert.equal(ui.get('exact-text').value, '');
  assert.equal(ui.get('output').value, 'Keep this result');
  assert.equal(ui.get('example-label').textContent, 'Try an example');
  assert.equal(ui.get('example-confirmation').hidden, true);
});

test('Cancel preserves drafts and requires a fresh confirmation, including notes-only drafts', async () => {
  for (const field of ['prompt', 'reference-notes', 'exact-text']) {
    const ui = await createUI();
    ui.get(field).value = 'Preserve me';
    ui.click('example-button');
    ui.click('example-cancel');
    assert.equal(ui.get(field).value, 'Preserve me');
    assert.equal(ui.get('example-confirmation').hidden, true);
    ui.click('example-button');
    assert.equal(ui.get(field).value, 'Preserve me');
    assert.equal(ui.get('example-confirmation').hidden, false);
  }
});

test('editing the draft or switching mode invalidates pending replacement', async () => {
  const ui = await createUI();
  ui.get('prompt').value = 'First draft';
  ui.click('example-button');
  ui.get('prompt').value = 'Revised draft';
  ui.change('prompt');
  assert.equal(ui.get('example-confirmation').hidden, true);
  ui.click('example-button');
  assert.equal(ui.get('prompt').value, 'Revised draft');
  ui.get('mode').value = 'reference';
  ui.change('mode', 'change');
  assert.equal(ui.get('example-confirmation').hidden, true);
  ui.click('example-button');
  assert.equal(ui.get('prompt').value, 'Revised draft');
  ui.click('example-button');
  assert.match(ui.get('prompt').value, /courier character/);
  assert.match(ui.get('reference-notes').value, /Picture 2/);
});

test('a changed value without an input event still requires confirmation again', async () => {
  const ui = await createUI();
  ui.get('prompt').value = 'First draft';
  ui.click('example-button');
  ui.get('prompt').value = 'Updated externally';
  ui.click('example-button');
  assert.equal(ui.get('prompt').value, 'Updated externally');
  ui.click('example-button');
  assert.match(ui.get('prompt').value, /clay robot/);
});

test('starting a rewrite cancels pending replacement and locks example actions', async () => {
  const ui = await createUI();
  ui.get('prompt').value = 'My brief';
  ui.click('example-button');
  const pending = ui.generate();
  assert.equal(ui.get('example-confirmation').hidden, true);
  assert.equal(ui.get('example-button').disabled, true);
  assert.equal(ui.get('example-cancel').disabled, true);
  ui.click('example-button');
  assert.equal(ui.get('prompt').value, 'My brief');
  ui.finish();
  await pending;
  assert.equal(ui.get('example-button').disabled, false);
  ui.click('example-button');
  assert.equal(ui.get('prompt').value, 'My brief');
  assert.equal(ui.get('output').value, 'Generated output');
});

function descendants(node) {
  return [node, ...node.children.flatMap(descendants)];
}

function cardControl(card, predicate) { return descendants(card).find(predicate); }
function cardDescription(card) { return cardControl(card, (item) => item.tagName === 'textarea'); }
function cardButton(card, label) { return cardControl(card, (item) => item.attributes?.['aria-label'] === label); }

function addAsset(ui, type, description) {
  ui.get('asset-new-type').value = type;
  ui.click('asset-add');
  const card = ui.get('asset-list').children.at(-1);
  const input = cardDescription(card);
  input.value = description;
  input.listeners.input();
  return card.dataset.assetId;
}

test('mixed asset cards number each type independently and send structured descriptions', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'A cinematic scene';
  addAsset(ui, 'picture', 'The first character.');
  addAsset(ui, 'audio', 'Use only the singing voice.');
  addAsset(ui, 'picture', 'The environment.');
  addAsset(ui, 'video', 'Use the camera move only.');
  assert.deepEqual(ui.get('asset-list').children.map((card) => card.attributes['aria-label']), [
    'Picture 1, position 1', 'Audio 1, position 2', 'Picture 2, position 3', 'Video 1, position 4',
  ]);
  const pending = ui.generate();
  assert.equal(ui.payload().assets.length, 4);
  assert.equal(ui.payload().assets[1].type, 'audio');
  assert.equal(ui.payload().assets[1].description, 'Use only the singing voice.');
  assert.equal(new Set(ui.payload().assets.map((asset) => asset.id)).size, 4);
  ui.finish(); await pending;
});

test('moving cards renumbers in place without swapping descriptions or changing the brief', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'Picture 1 stands beside Picture 2.';
  ui.get('exact-text').value = 'Picture 1 is my name.';
  ui.get('output').value = 'Previous result';
  const first = addAsset(ui, 'picture', 'Red character.');
  const second = addAsset(ui, 'picture', 'Blue character.');
  cardButton(ui.get('asset-list').children[1], 'Move Picture 2 up').listeners.click();
  const cards = ui.get('asset-list').children;
  assert.equal(cards[0].dataset.assetId, second);
  assert.equal(cards[1].dataset.assetId, first);
  assert.equal(cardDescription(cards[0]).value, 'Blue character.');
  assert.equal(cardDescription(cards[1]).value, 'Red character.');
  assert.match(cards[0].attributes['aria-label'], /^Picture 1/);
  assert.equal(ui.get('prompt').value, 'Picture 1 stands beside Picture 2.');
  assert.equal(ui.get('exact-text').value, 'Picture 1 is my name.');
  assert.equal(ui.get('output').value, 'Previous result');
  assert.equal(ui.get('asset-review').hidden, false);
  assert.match(ui.get('asset-review-message').textContent, /Picture 1 → Picture 2/);
  assert.equal(ui.get('generate-button').disabled, true);
  ui.click('asset-review-confirm');
  assert.equal(ui.get('generate-button').disabled, false);
});

test('type changes and removal update numbering and flag affected references', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'Use Audio 1 for the voice.';
  addAsset(ui, 'picture', 'Character.');
  addAsset(ui, 'audio', 'Voice source.');
  const audioCard = ui.get('asset-list').children[1];
  const type = cardControl(audioCard, (item) => item.tagName === 'select');
  type.value = 'video'; type.listeners.change();
  assert.match(ui.get('asset-list').children[1].attributes['aria-label'], /^Video 1/);
  assert.equal(cardDescription(ui.get('asset-list').children[1]).value, 'Voice source.');
  assert.match(ui.get('asset-review-message').textContent, /Audio 1 → Video 1/);
  ui.click('asset-review-confirm');
  ui.get('prompt').value = 'Use Picture 1 for the character.';
  ui.change('prompt');
  cardButton(ui.get('asset-list').children[0], 'Remove Picture 1').listeners.click();
  assert.equal(ui.get('asset-list').children.length, 1);
  assert.match(ui.get('asset-review-message').textContent, /Picture 1 → removed/);
});

test('asset drafts survive mode switches and mixed types cannot enter keyframe requests', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'Animate the reference.';
  const id = addAsset(ui, 'audio', 'Preserve the voice.');
  ui.get('mode').value = 't2v'; ui.change('mode', 'change');
  assert.equal(ui.get('reference-field').hidden, true);
  assert.equal(cardDescription(ui.get('asset-list').children[0]).required, false);
  ui.get('mode').value = 'i2v'; ui.change('mode', 'change');
  assert.equal(ui.get('asset-list').children[0].dataset.assetId, id);
  assert.equal(cardDescription(ui.get('asset-list').children[0]).value, 'Preserve the voice.');
  await ui.generate();
  assert.equal(ui.payload(), undefined);
  assert.match(ui.get('error-message').textContent, /exactly one Picture/);
});

test('first+last frame cards clearly track opening and ending positions', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'fl2v'; ui.change('mode', 'change');
  addAsset(ui, 'picture', 'A closed flower.');
  addAsset(ui, 'picture', 'An open flower.');
  let cards = ui.get('asset-list').children;
  assert.equal(cardControl(cards[0], (item) => item.className === 'asset-role').textContent, 'Opening frame');
  assert.equal(cardControl(cards[1], (item) => item.className === 'asset-role').textContent, 'Final frame');
  cardButton(cards[1], 'Move Picture 2 up').listeners.click();
  cards = ui.get('asset-list').children;
  assert.equal(cardDescription(cards[0]).value, 'An open flower.');
  assert.equal(cardControl(cards[0], (item) => item.className === 'asset-role').textContent, 'Opening frame');
});

test('removing the last linked asset keeps the review visible and cannot submit an empty reference list', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'Use Picture 1 for the character.';
  addAsset(ui, 'picture', 'Character source.');
  cardButton(ui.get('asset-list').children[0], 'Remove Picture 1').listeners.click();
  assert.equal(ui.get('asset-list').children.length, 0);
  assert.equal(ui.get('asset-empty').hidden, false);
  assert.equal(ui.get('asset-review').hidden, false);
  assert.equal(ui.get('generate-button').disabled, true);
  ui.click('asset-review-confirm');
  await ui.generate();
  assert.equal(ui.payload(), undefined);
  assert.match(ui.get('error-message').textContent, /Add at least one reference asset/);
});

test('a text-to-video request excludes retained asset drafts', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  addAsset(ui, 'audio', 'Voice reference kept for later.');
  ui.get('mode').value = 't2v'; ui.change('mode', 'change');
  ui.get('prompt').value = 'A silent mountain scene.';
  const pending = ui.generate();
  assert.deepEqual(ui.payload().assets, []);
  assert.equal(ui.payload().referenceNotes, '');
  ui.finish(); await pending;
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  assert.equal(cardDescription(ui.get('asset-list').children[0]).value, 'Voice reference kept for later.');
});

test('the asset limit stops additions without losing earlier descriptions', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  for (let index = 0; index < MAX_ASSETS; index += 1) addAsset(ui, 'picture', `Reference ${index + 1}.`);
  assert.equal(ui.get('asset-add').disabled, true);
  ui.click('asset-add');
  assert.equal(ui.get('asset-list').children.length, MAX_ASSETS);
  assert.equal(cardDescription(ui.get('asset-list').children[0]).value, 'Reference 1.');
  assert.equal(cardDescription(ui.get('asset-list').children.at(-1)).value, `Reference ${MAX_ASSETS}.`);
});

test('combined reference length is checked before requesting inference', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'Use these references.';
  addAsset(ui, 'picture', 'x'.repeat(MAX_ASSET_DESCRIPTION_LENGTH));
  addAsset(ui, 'audio', 'y'.repeat(MAX_ASSET_DESCRIPTION_LENGTH));
  await ui.generate();
  assert.equal(ui.payload(), undefined);
  assert.match(ui.get('error-message').textContent, /combined total/);
});

test('cross-type moves preserve numbers and boundary moves preserve the list', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'Animate Picture 1 with Audio 1.';
  const picture = addAsset(ui, 'picture', 'Character.');
  const audio = addAsset(ui, 'audio', 'Voice.');
  cardButton(ui.get('asset-list').children[1], 'Move Audio 1 up').listeners.click();
  const cards = ui.get('asset-list').children;
  assert.equal(cards[0].dataset.assetId, audio);
  assert.equal(cards[1].dataset.assetId, picture);
  assert.match(cards[0].attributes['aria-label'], /^Audio 1/);
  assert.match(cards[1].attributes['aria-label'], /^Picture 1/);
  assert.equal(ui.get('asset-review').hidden, true);
  const moveFirstUp = cardButton(cards[0], 'Move Audio 1 up');
  assert.equal(moveFirstUp.disabled, true);
  moveFirstUp.listeners.click();
  assert.equal(ui.get('asset-list').children[0].dataset.assetId, audio);
});

test('a failed asynchronous rewrite preserves every asset, draft, and previous result', async () => {
  for (const code of [undefined, 'connection_changed']) {
    const ui = await createUI();
    ui.get('mode').value = 'reference'; ui.change('mode', 'change');
    ui.get('prompt').value = 'Animate Picture 1 using Audio 1.';
    ui.get('exact-text').value = 'Keep these words.';
    ui.get('output').value = 'Previous finished result.';
    const picture = addAsset(ui, 'picture', 'Red robot identity.');
    const audio = addAsset(ui, 'audio', 'Directly reuse the voice.');
    const before = ui.get('reference-notes').value;
    const pending = ui.generate();
    assert.equal(ui.get('input-fields').disabled, true);
    assert.equal(ui.get('output').readOnly, true);
    ui.click('asset-add');
    cardButton(ui.get('asset-list').children[0], 'Remove Picture 1').listeners.click();
    assert.equal(ui.get('asset-list').children.length, 2);
    ui.fail('Ollama stopped before the prompt was complete.', code);
    await pending;
    assert.equal(ui.get('prompt').value, 'Animate Picture 1 using Audio 1.');
    assert.equal(ui.get('exact-text').value, 'Keep these words.');
    assert.equal(ui.get('output').value, 'Previous finished result.');
    assert.equal(ui.get('reference-notes').value, before);
    assert.deepEqual(ui.get('asset-list').children.map((card) => card.dataset.assetId), [picture, audio]);
    assert.equal(cardDescription(ui.get('asset-list').children[0]).value, 'Red robot identity.');
    assert.equal(cardDescription(ui.get('asset-list').children[1]).value, 'Directly reuse the voice.');
    assert.equal(ui.get('input-fields').disabled, false);
    assert.equal(ui.get('output').readOnly, false);
    assert.equal(ui.get('generate-button').disabled, false);
    assert.match(ui.get('error-message').textContent, /stopped before the prompt was complete/);
  }
});

function fixtureFile(name, type, size = 1024) { return { name, type, size, arrayBuffer: async () => new ArrayBuffer(8) }; }
const nextTask = () => new Promise(setImmediate);

test('mixed media creates cards and sequentially sends resized pictures, sampled video, and mono16k WAV', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'Use these references.';
  const pending = ui.upload([fixtureFile('robot.png', 'image/png'), fixtureFile('camera.mp4', 'video/mp4'), fixtureFile('voice.mp3', 'audio/mpeg')]);
  await nextTask();
  assert.equal(ui.get('asset-list').children.length, 3);
  assert.equal(ui.get('generate-button').disabled, true);
  assert.equal(ui.get('input-fields').disabled, false, 'Descriptions remain editable while media is analyzed');
  assert.equal(ui.mediaRequests.length, 1);
  assert.equal(ui.mediaRequests[0].input.asset.mimeType, 'image/jpeg');
  assert.equal(ui.mediaRequests[0].input.asset.data, 'cGljdHVyZQ==');
  assert.equal(ui.mediaRequests[0].input.connectionFingerprint, 'synthetic');
  assert.deepEqual(ui.canvases[0], { width: 1280, height: 640 });
  ui.completeMedia(0, { description: 'A red robot.', warnings: [] });
  await nextTask();
  assert.equal(ui.mediaRequests.length, 2);
  const video = ui.mediaRequests[1].input.asset;
  assert.equal(video.type, 'video');
  assert.equal(video.data, undefined, 'The original video is never sent');
  assert.equal(video.frames.length, 3);
  assert.deepEqual(video.frames.map((frame) => frame.timestampSeconds), [0, 1, 1.9]);
  assert.ok(ui.canvases.every((canvas) => Math.max(canvas.width, canvas.height) <= 1280));
  ui.completeMedia(1, { description: 'A locked-off garden view.', warnings: [] });
  await nextTask();
  assert.equal(ui.mediaRequests.length, 3);
  const audio = ui.mediaRequests[2].input.asset;
  assert.equal(audio.mimeType, 'audio/wav');
  assert.equal(audio.name, 'voice.mp3');
  const wav = Buffer.from(audio.data, 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  ui.completeMedia(2, { description: 'A person says hello.', warnings: [] });
  await pending;
  assert.equal(ui.get('generate-button').disabled, false);
  assert.equal(cardDescription(ui.get('asset-list').children[0]).value, 'A red robot.');
  assert.ok(descendants(ui.get('asset-list').children[1]).some((item) => item.textContent.includes('three sampled frames')));
  assert.ok(descendants(ui.get('asset-list').children[2]).some((item) => item.textContent.includes('nonverbal sounds, music, and voice timbre were not analyzed')));
});

test('editing a description during media analysis offers the late result without overwriting it', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'A red robot scene.';
  ui.get('output').value = 'Previous finished prompt.';
  const pending = ui.upload([fixtureFile('robot.png', 'image/png')]);
  await nextTask();
  let card = ui.get('asset-list').children[0];
  cardDescription(card).value = 'My carefully edited description.';
  cardDescription(card).listeners.input();
  await ui.generate();
  assert.equal(ui.payload(), undefined, 'Rewrite cannot race media analysis');
  ui.completeMedia(0, { description: 'Generated robot description.', warnings: ['Check small details.'] });
  await pending;
  card = ui.get('asset-list').children[0];
  assert.equal(cardDescription(card).value, 'My carefully edited description.');
  assert.equal(ui.get('output').value, 'Previous finished prompt.');
  const apply = cardButton(card, 'Use suggested description for Picture 1');
  assert.ok(apply);
  apply.listeners.click();
  assert.equal(cardDescription(ui.get('asset-list').children[0]).value, 'Generated robot description.');
});

test('media results cannot recreate a removed card and its local preview URL is released', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  const pending = ui.upload([fixtureFile('robot.png', 'image/png')]);
  await nextTask();
  cardButton(ui.get('asset-list').children[0], 'Remove Picture 1').listeners.click();
  ui.completeMedia(0, { description: 'Late result.', warnings: [] });
  await pending;
  assert.equal(ui.get('asset-list').children.length, 0);
  assert.deepEqual(ui.revokedUrls, ['blob:test-1']);
});

test('replacing a card file preserves its description on provider failure', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  const id = addAsset(ui, 'picture', 'Handwritten description.');
  const chooser = cardControl(ui.get('asset-list').children[0], (item) => item.tagName === 'input' && item.type === 'file');
  chooser.files = [fixtureFile('replacement.png', 'image/png')];
  const pending = chooser.listeners.change(); await nextTask();
  ui.completeMedia(0, { error: 'The model is unavailable.' }, false); await pending;
  const card = ui.get('asset-list').children[0];
  assert.equal(card.dataset.assetId, id);
  assert.equal(cardDescription(card).value, 'Handwritten description.');
  assert.ok(descendants(card).some((item) => item.textContent.includes('The model is unavailable.')));
  assert.equal(ui.get('asset-files-add').disabled, false);
});

test('oversized and unsupported files are rejected before inference', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  await ui.upload([fixtureFile('too-big.png', 'image/png', 10 * 1024 * 1024 + 1), fixtureFile('long.mp3', 'audio/mpeg', 24 * 1024 * 1024 + 1), fixtureFile('animation.gif', 'image/gif')]);
  assert.equal(ui.mediaRequests.length, 0);
  assert.equal(ui.get('asset-list').children.length, 0);
  assert.match(ui.get('error-message').textContent, /10 MiB/);
  assert.match(ui.get('error-message').textContent, /24 MiB/);
  assert.match(ui.get('error-message').textContent, /PNG, JPEG, or WebP/);
});

test('audio and video over two minutes stay as editable cards without an inference request', async () => {
  const ui = await createUI({ duration: 121 });
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  await ui.upload([fixtureFile('long.mp4', 'video/mp4'), fixtureFile('long.mp3', 'audio/mpeg')]);
  assert.equal(ui.mediaRequests.length, 0);
  assert.equal(ui.get('asset-list').children.length, 2);
  for (const card of ui.get('asset-list').children) assert.ok(descendants(card).some((item) => item.textContent.includes('two minutes or less')));
});

test('explicit brief suggestions populate empty cards, preserve numbered gaps, and preview later additions', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'Use Picture 2 for a robot.';
  let pending = ui.click('asset-suggest');
  ui.completeSuggestion(0, { assets: [{ type: 'picture', description: '' }, { type: 'picture', description: 'Robot identity guessed from brief.' }], warnings: ['Fill Picture 1 to keep upload numbering.'] });
  await pending;
  assert.equal(ui.get('asset-list').children.length, 2);
  assert.equal(cardDescription(ui.get('asset-list').children[0]).value, '');
  assert.match(ui.get('asset-notice').textContent, /Fill Picture 1/);
  const ids = ui.get('asset-list').children.map((card) => card.dataset.assetId);
  pending = ui.click('asset-suggest');
  assert.equal(ui.suggestionRequests[1].input.assets.length, 2);
  ui.completeSuggestion(1, { assets: [{ type: 'audio', description: 'An optional voice reference.' }], warnings: [] });
  await pending;
  assert.equal(ui.get('asset-list').children.length, 2);
  assert.equal(ui.get('asset-suggestions').hidden, false);
  ui.click('asset-suggestions-apply');
  assert.equal(ui.get('asset-list').children.length, 3);
  assert.deepEqual(ui.get('asset-list').children.slice(0, 2).map((card) => card.dataset.assetId), ids);
  assert.equal(cardDescription(ui.get('asset-list').children[1]).value, 'Robot identity guessed from brief.');
});

test('a brief or mode change during suggestion generation requires review before adding', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'A robot reference.';
  const pending = ui.click('asset-suggest');
  ui.get('prompt').value = 'A garden instead.'; ui.change('prompt');
  ui.get('mode').value = 'fl2v'; ui.change('mode', 'change');
  ui.completeSuggestion(0, { assets: [{ type: 'picture', description: 'A robot.' }], warnings: [] });
  await pending;
  assert.equal(ui.get('asset-list').children.length, 0);
  assert.equal(ui.get('asset-suggestions').hidden, false);
  assert.equal(ui.get('asset-suggestions-apply').disabled, true);
  assert.match(ui.get('asset-suggestions-help').textContent, /earlier brief/);
  ui.click('asset-suggestions-apply');
  assert.equal(ui.get('asset-list').children.length, 0);
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.click('asset-suggestions-apply');
  assert.equal(ui.get('asset-list').children.length, 1);
  assert.equal(ui.get('prompt').value, 'A garden instead.');
});

test('asset changes after suggestions cannot silently shift the suggested source numbers', async () => {
  const ui = await createUI();
  ui.get('mode').value = 'reference'; ui.change('mode', 'change');
  ui.get('prompt').value = 'Keep Picture 1 and add Picture 2 for the environment.';
  addAsset(ui, 'picture', 'The character.');
  const pending = ui.click('asset-suggest');
  ui.completeSuggestion(0, { assets: [{ type: 'picture', description: 'An environment for Picture 2.' }], warnings: [] });
  await pending;
  addAsset(ui, 'picture', 'A manually added second picture.');
  assert.equal(ui.get('asset-suggestions-apply').disabled, true);
  assert.match(ui.get('asset-suggestions-status').textContent, /numbering/);
  ui.click('asset-suggestions-apply');
  assert.equal(ui.get('asset-list').children.length, 2);
  assert.equal(cardDescription(ui.get('asset-list').children[1]).value, 'A manually added second picture.');
});
