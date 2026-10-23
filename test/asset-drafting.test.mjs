import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMediaAsset, suggestAssetsFromBrief } from '../asset-drafting.mjs';

const provider = (assets, capture = []) => ({ settings: { kind: 'ollama' }, async describeAssets(messages, context) { capture.push({ messages, context }); return { assets, warnings: [], provider: 'Ollama', model: 'synthetic' }; } });
test('brief guesses preserve explicit numbered gaps, order and existing descriptions', async () => {
  const raw = { prompt: 'Picture 3 is the background and Picture 2 is the robot.', mode: 'reference', assets: [{ id: 'a', type: 'picture', description: 'My edited hero.' }] };
  const result = await suggestAssetsFromBrief(raw, provider([{ type: 'picture', sourceNumber: 3, description: 'Station.' }, { type: 'picture', sourceNumber: 2, description: 'Robot.' }, { type: 'picture', sourceNumber: 1, description: 'Do not replace it.' }]));
  assert.deepEqual(result.assets, [{ type: 'picture', description: 'Suggested asset: Robot.' }, { type: 'picture', description: 'Suggested asset: Station.' }]);
  assert.equal(raw.assets[0].description, 'My edited hero.');
  const gaps = await suggestAssetsFromBrief({ prompt: 'Use Picture 3.', mode: 'reference' }, provider([{ type: 'picture', sourceNumber: 3, description: 'A proposed reference.' }]));
  assert.deepEqual(gaps.assets.map(a => a.description), ['', '', 'Suggested asset: A proposed reference.']);
  assert.ok(gaps.warnings.some(w => w.includes('empty card')));
  assert.ok(gaps.warnings.some(w => w.includes('no media was inspected')));
});

test('keyframe suggestions cannot add mixed types or extra frame slots', async () => {
  const result = await suggestAssetsFromBrief({ prompt: 'A fox sits.', mode: 'l2v' }, provider([{ type: 'picture', sourceNumber: 1, description: 'Final fox pose.' }, { type: 'audio', sourceNumber: 1, description: 'Forest.' }, { type: 'picture', sourceNumber: 2, description: 'Another view.' }]));
  assert.equal(result.assets.length, 1);
  assert.match(result.assets[0].description, /Final fox pose/);
  assert.ok(result.warnings.some(w => w.includes('omitted')));
});

test('media description sends only prepared evidence and selected type with shared deadline', async () => {
  const calls = [];
  const result = await describeMediaAsset({ prompt: 'Use the courier.', mode: 'reference', asset: { type: 'video', data: 'not-sent-directly' } }, provider([{ type: 'video', description: 'A robot in a station.' }], calls), {
    prepare: async () => ({ type: 'video', name: 'robot.mp4', images: [{ data: 'prepared-frame', timestampSeconds: 1.2 }], transcript: null, durationSeconds: 3, warnings: ['Three sampled frames; soundtrack not analyzed.'] }),
  });
  assert.equal(result.description, 'A robot in a station.');
  assert.deepEqual(calls[0].context.expectedTypes, ['video']);
  assert.ok(calls[0].context.timeoutMs <= 300000);
  assert.deepEqual(calls[0].messages[1].images, ['prepared-frame']);
  assert.equal(JSON.parse(calls[0].messages[1].content).frames[0].timestampSeconds, 1.2);
  assert.ok(!JSON.stringify(calls).includes('not-sent-directly'));
  assert.ok(!JSON.stringify(calls).includes('Use the courier.'), 'creative plans must not contaminate observed media descriptions');
  assert.ok(result.warnings[0].includes('soundtrack'));
});

test('cloud media processing and malformed briefs are rejected before preparing or inference', async () => {
  let prepared = false, generated = false;
  const cloud = { settings: { kind: 'openrouter' }, describeAssets() { generated = true; } };
  await assert.rejects(describeMediaAsset({ asset: {} }, cloud, { prepare: async () => { prepared = true; } }), /Choose Ollama/);
  await assert.rejects(suggestAssetsFromBrief({ prompt: ' ' }, provider([])), /Add a video brief/);
  assert.equal(prepared, false); assert.equal(generated, false);
});

test('audio preserves actual speech verbatim without turning narration into observed events', async () => {
  const calls = [];
  const result = await describeMediaAsset({ asset: { type: 'audio' } }, provider([], calls), {
    prepare: async () => ({ type: 'audio', name: 'speech.wav', images: [], durationSeconds: 3.69, transcript: { text: 'The little robot walks across the room and waves hello.' }, warnings: ['Speech only.'] }),
  });
  assert.equal(calls.length, 0);
  assert.match(result.description, /Detected speech: "The little robot walks across the room and waves hello\."/);
  assert.equal(result.model, 'whisper-tiny');
});
