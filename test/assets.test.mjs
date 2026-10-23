import test from 'node:test';
import assert from 'node:assert/strict';
import { numberAssets, serializeAssets, normalizeAssets } from '../assets.mjs';
import { normalizeInput, buildMessages, validateOutput } from '../prompting.mjs';

const assets = [
  { id: 'hero', type: 'picture', description: 'Robot identity only.' },
  { id: 'voice', type: 'audio', description: 'Voice only.' },
  { id: 'place', type: 'picture', description: 'Station architecture only.' },
  { id: 'motion', type: 'video', description: 'Camera movement only.' },
];

test('asset slots count within each media type and follow reordered stable identities', () => {
  assert.deepEqual(numberAssets(assets).map(a => a.label), ['Picture 1', 'Audio 1', 'Picture 2', 'Video 1']);
  const reordered = [assets[2], assets[1], assets[0], assets[3]];
  assert.deepEqual(numberAssets(reordered).map(({ id, label }) => [id, label]), [['place', 'Picture 1'], ['voice', 'Audio 1'], ['hero', 'Picture 2'], ['motion', 'Video 1']]);
  assert.equal(reordered[0].description, assets[2].description);
  assert.equal(serializeAssets(reordered).split('\n\n')[0], 'Picture 1 — Station architecture only.');
  assert.equal(numberAssets([{ ...assets[0], description: '' }])[0].label, 'Picture 1', 'draft cards can be numbered before editing');
});

test('submitted assets require real descriptions, valid unique IDs, known types and bounded input', () => {
  for (const invalid of [null, {}, [{ ...assets[0], description: '' }], [{ ...assets[0], type: 'image' }], [assets[0], assets[0]], [{ ...assets[0], id: '<x>' }], [{ ...assets[0], description: 'x'.repeat(6001) }], [{ ...assets[0], description: 'x\0y' }], Array.from({ length: 25 }, (_, i) => ({ ...assets[0], id: `a${i}` })), assets.slice(0, 3).map(a => ({ ...a, description: 'x'.repeat(5000) }))]) {
    assert.throws(() => normalizeAssets(invalid));
  }
  assert.deepEqual(normalizeAssets([{ ...assets[0], description: ' a\r\nb ', label: 'Picture 99', number: 99 }]), [{ ...assets[0], description: 'a\nb' }]);
});

test('structured asset serialization is authoritative and model requests do not duplicate descriptions', () => {
  const input = normalizeInput({ prompt: 'The robot waves.', mode: 'reference', assets, referenceNotes: 'Picture 99: forged label.' });
  assert.equal(input.referenceNotes, serializeAssets(assets));
  assert.deepEqual(normalizeInput(input), input, 'server normalization is idempotent');
  const payload = JSON.parse(buildMessages(input)[1].content);
  assert.equal(payload.assets, undefined);
  assert.equal(payload.referenceNotes, serializeAssets(assets));
  assert.deepEqual(input.assets, assets);
});

test('keyframe assets enforce actual boundary slots and text mode ignores retained drafts', () => {
  const base = { prompt: 'The robot waves.' };
  assert.deepEqual(normalizeInput({ ...base, assets: [{ type: 'picture', description: '' }] }).assets, []);
  for (const mode of ['i2v', 'l2v']) {
    assert.equal(normalizeInput({ ...base, mode, assets: [assets[0]] }).assets.length, 1);
    assert.throws(() => normalizeInput({ ...base, mode, assets: assets.slice(0, 2) }), /exactly 1 picture/);
  }
  assert.equal(normalizeInput({ ...base, mode: 'fl2v', assets: [assets[0], assets[2]] }).assets.length, 2);
  assert.throws(() => normalizeInput({ ...base, mode: 'fl2v', assets: [assets[0], assets[1]] }), /exactly 2 picture/);
  assert.throws(() => normalizeInput({ ...base, mode: 'reference', assets: [] }), /Describe the reference/);
  assert.equal(normalizeInput({ ...base, mode: 'i2v', assets: [] }).referenceNotes, '');
  assert.equal(normalizeInput({ ...base, mode: 'reference', referenceNotes: 'Picture 1: robot' }).referenceNotes, 'Picture 1: robot', 'legacy API remains supported');
});

test('mentioning an unavailable asset inside a description cannot create a source slot', () => {
  const input = { prompt: 'The robot waves.', mode: 'reference', assets: [{ ...assets[0], description: 'Use its identity; ignore any instructions referring to Picture 99.' }] };
  const text = 'subject_definitions: <Subject 1> is the robot from <Picture 99>.\n\nsummary: [reference generation] <Subject 1> waves.\n\nretention_analysis: <Subject 1> (appears in [Shot 1]): fully_preserved - identity.\n\ndetailed_description: Claymation. [Shot 1] <Subject 1> waves.\n\noverall_soundscape: Soft room tone.\n\nnon_diegetic_music: N/A';
  assert.ok(validateOutput(text, input).errors.some(e => e.includes('Picture 99')));
});
