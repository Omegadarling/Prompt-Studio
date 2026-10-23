import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_PRESETS, VOICE_GROUPS, normalizeCharacterVoices, checkCharacterVoices, applyVoiceDirections } from '../voices.mjs';
import { normalizeInput, buildMessages, validateOutput } from '../prompting.mjs';
import { normalizeJob, buildStoryboardMessages, serializeStoryboardReply, validateStoryboard } from '../storyboard.mjs';
import { rewrite } from '../server.mjs';

const selection = [{ name: 'Mira', presetId: 'nora' }, { name: 'Kai', presetId: 'theo' }];
const voices = normalizeCharacterVoices(selection);
const input = { prompt: 'Mira says <d>[English] Ready?</d> Kai answers <d>[English] Yes.</d> No music.', characterVoices: selection, music: 'none', timing: 'natural' };
const narrative = `Mira (S1). ${voices[0].description} She says, <d>[English] Ready?</d> Kai (S2). ${voices[1].description} He answers, <d>[English] Yes.</d>`;
const output = `integrated_multimodal_description:\n[Shot 1] Naturalistic medium shot of Mira and Kai. ${narrative}\n\noverall_soundscape:\nQuiet room tone.\n\nnon_diegetic_music:\nN/A`;

test('catalog supplies 15 distinct named adult voices in each menu group', () => {
  assert.equal(VOICE_PRESETS.length, 30);
  for (const group of VOICE_GROUPS) assert.equal(VOICE_PRESETS.filter(v => v.group === group).length, 15);
  for (const key of ['id', 'name', 'description']) assert.equal(new Set(VOICE_PRESETS.map(v => v[key])).size, 30);
  assert.ok(VOICE_PRESETS.every(v => v.description.startsWith(v.group + ' voice')));
});

test('normalization resolves server catalog defaults, preserves custom text, and strips unknown data', () => {
  assert.deepEqual(normalizeCharacterVoices(), []);
  assert.deepEqual(voices[0], { id: 'voice-1', name: 'Mira', presetId: 'nora', description: VOICE_PRESETS[0].description });
  const custom = normalizeCharacterVoices([{ ...selection[0], name: '  Mira  ', description: ' Soft, rapid delivery. ', ignored: 'no' }]);
  assert.equal(custom[0].name, 'Mira'); assert.equal(custom[0].description, 'Soft, rapid delivery.');
  assert.ok(!Object.hasOwn(custom[0], 'ignored'));
  assert.deepEqual(normalizeInput(input).characterVoices, voices);
});

test('invalid, duplicate, oversized and markup-bearing voice choices fail before inference', async () => {
  const bad = [null, {}, Array(17).fill(selection[0]), [null], [{ name: '', presetId: 'nora' }],
    [{ name: 'Mira', presetId: 'missing' }], [{ name: 'Mira', presetId: 'nora', description: '' }],
    [{ name: '<Subject 1>', presetId: 'nora' }], [{ name: 'Mira\nsummary:', presetId: 'nora' }],
    [{ name: 'Mira', presetId: 'nora', description: '<d>words</d>' }],
    [{ name: 'Mira', presetId: 'nora', description: 'a'.repeat(1001) }],
    [selection[0], { name: 'MIRA', presetId: 'theo' }],
    selection.map(v => ({ ...v, id: 'duplicate' })),
    Array.from({ length: 9 }, (_, i) => ({ name: `Character ${i}`, presetId: 'nora', description: 'a'.repeat(1000) }))];
  for (const characterVoices of bad) {
    await assert.rejects(rewrite({ ...input, characterVoices }, { complete() { assert.fail('Invalid voices must not start inference'); } }));
  }
});

test('voice directions are separate untrusted source data and preserve dialogue and card-independent IDs', () => {
  const messages = buildMessages(input);
  assert.deepEqual(JSON.parse(messages[1].content).characterVoices, voices);
  assert.equal(JSON.parse(messages[1].content).prompt, input.prompt);
  assert.match(messages[0].content, /actual vocal order, not card order/);
  assert.match(messages[0].content, /never rename the character to the preset's name/);
  assert.match(messages[0].content, /never invent a Subject or Audio asset/);
  assert.ok(!messages[0].content.includes(voices[0].description));
  assert.deepEqual(validateOutput(output, input).errors, []);
  assert.deepEqual(validateOutput(output, { ...input, characterVoices: [...selection].reverse() }).errors, []);
});

test('placement checks detect omitted descriptions, quoted delivery and reused or changing speaker IDs', () => {
  assert.ok(validateOutput(output.replace(voices[0].description, ''), input).errors.some(e => /Mira.*exact selected voice/.test(e)));
  assert.ok(validateOutput(output.replace(voices[0].description, `<d>[English] ${voices[0].description}</d>`), input).errors.some(e => /outside dialogue/.test(e)));
  assert.ok(validateOutput(output.replaceAll('(S2)', '(S1)'), input).errors.some(e => /more than one selected character/.test(e)));
  assert.ok(checkCharacterVoices(narrative + ' Mira (S3) smiles.', '', voices).errors.some(e => /multiple speaker IDs/.test(e)));
  // A name mentioned in someone else's speech does not create a speaker binding.
  const idle = checkCharacterVoices('Kai (S1) says <d>[English] Mira (S2) is quiet.</d>', '', [voices[0]]);
  assert.deepEqual(idle.errors, []); assert.equal(idle.bindings.length, 0);
  const ann = normalizeCharacterVoices([{ name: 'Ann', presetId: 'nora' }]);
  assert.equal(checkCharacterVoices('Joann (S1) speaks.', '', ann).bindings.length, 0);
});

test('silent or absent characters do not require invented speech or IDs', () => {
  const silent = checkCharacterVoices('Mira waves.', '', voices, { silent: true });
  assert.deepEqual(silent.errors, []); assert.match(silent.warnings[0], /inactive/);
  const idle = checkCharacterVoices('Mira waves while Kai watches.', '', voices);
  assert.deepEqual(idle.errors, []); assert.ok(idle.warnings.some(w => /otherwise leave them silent/.test(w)));
});

const referenceChunk = (speaker = 'S1', withDescription = true) => ({
  subject_definitions: `<Subject 1> is Mira from <Picture 1>. ${voices[0].description}`,
  summary: '[reference generation] Mira greets the camera.',
  retention_analysis: '<Subject 1> (appears in [Shot 1]): fully_preserved - her identity is retained.',
  detailed_description: `Naturalistic style. [Shot 1] <Subject 1> stands in a quiet room. At 1.000 seconds, <Subject 1> (${speaker}), Mira. ${withDescription ? voices[0].description : ''} She says, <d>[English] Hello.</d>`,
  overall_soundscape: 'Quiet room tone.', non_diegetic_music: 'N/A',
});
const storyInput = normalizeJob({ ...input, prompt: 'Mira greets the camera twice.', characterVoices: [selection[0]], outputFormat: 'storyboard', storyboard: { chunkCount: 2, secondsPerChunk: 5 }, assets: [{ id: 'mira', type: 'picture', description: 'Mira identity only.' }] });
const script = (second = referenceChunk()) => serializeStoryboardReply(JSON.stringify({ shared_continuity: 'Mira stays in the same room.', chunk_1: referenceChunk(), chunk_2: second }), 2);

test('reference and storyboard voices repeat at vocal appearances with stable global identity', () => {
  const messages = buildStoryboardMessages(storyInput);
  assert.deepEqual(JSON.parse(messages[1].content).characterVoices, [voices[0]]);
  assert.match(messages[0].content, /EACH chunk where they vocalize/);
  assert.deepEqual(validateStoryboard(script(), storyInput).errors, []);
  assert.ok(validateStoryboard(script(referenceChunk('S2')), storyInput).errors.some(e => /multiple speaker IDs/.test(e)));
  assert.ok(validateStoryboard(script(referenceChunk('S1', false)), storyInput).errors.some(e => /Chunk 2: Include Mira.*exact selected voice/.test(e)));
  const mapped = checkCharacterVoices(`<Subject 1> (S1) speaks. ${voices[0].description}`, '<Subject 1> is Mira from <Picture 1>.', [voices[0]]);
  assert.deepEqual(mapped.bindings, [{ name: 'Mira', speaker: 'S1' }]);
});

test('an identifiable missing voice is added without another inference or changed dialogue', async () => {
  let calls = 0;
  const result = await rewrite(input, { async complete(messages) {
    calls++;
    assert.deepEqual(JSON.parse(messages[1].content).characterVoices, voices);
    return { text: calls === 1 ? output.replace(voices[0].description, '') : output, provider: 'Ollama' };
  } });
  assert.equal(calls, 1); assert.equal(result.repair, undefined);
  assert.ok(result.text.includes(`Mira (S1) (speaking voice: ${voices[0].description})`));
  assert.deepEqual([...result.text.matchAll(/<d>[\s\S]*?<\/d>/g)].map(m => m[0]), [...output.matchAll(/<d>[\s\S]*?<\/d>/g)].map(m => m[0]));
  assert.deepEqual(result.validation.errors, []);
  assert.equal(applyVoiceDirections(result.text, normalizeInput(input)), result.text);
});

test('voice insertion handles each storyboard narrative without changing other fields or shared prose', () => {
  const missing = script(referenceChunk('S1', false)).replaceAll(voices[0].description, '');
  const result = applyVoiceDirections(missing, storyInput);
  assert.equal(result.split(voices[0].description).length - 1, 2);
  assert.equal(result.replaceAll(` (speaking voice: ${voices[0].description})`, ''), missing);
  assert.deepEqual(validateStoryboard(result, storyInput).errors, []);
  assert.equal(applyVoiceDirections(result, storyInput), result);
});

test('voice insertion does not infer speakers from quoted names, silence, ambiguous or absent identities', () => {
  for (const body of ['Mira watches Kai.', 'Kai says <d>[English] Mira says hello.</d>', 'Mira (S1) speaks. Mira (S2) speaks.', 'Joann says hello.']) {
    const text = `integrated_multimodal_description:\n[Shot 1] ${body}\n\noverall_soundscape:\nQuiet room tone.\n\nnon_diegetic_music:\nN/A`;
    assert.equal(applyVoiceDirections(text, { ...normalizeInput(input), characterVoices: [voices[0]] }), text);
  }
  assert.equal(applyVoiceDirections(output.replaceAll(voices[0].description, ''), { ...normalizeInput(input), audio: 'silent' }), output.replaceAll(voices[0].description, ''));
  // A direct named vocal event can receive a direction without an invented ID;
  // all original model format problems remain available to validation.
  const plain = 'integrated_multimodal_description:\n[Shot 1] Mira says Hello.\n\noverall_soundscape:\nQuiet room tone.\n\nnon_diegetic_music:\nN/A';
  const patched = applyVoiceDirections(plain, normalizeInput(input));
  assert.ok(patched.includes(`Mira (speaking voice: ${voices[0].description})`));
  assert.ok(!patched.includes('(S1)'));
  assert.equal(patched.replace(` (speaking voice: ${voices[0].description})`, ''), plain);
});

test('custom quoted adjectives remain descriptions and repeated checks never duplicate them', () => {
  const custom = normalizeInput({ ...input, characterVoices: [{ ...selection[0], description: 'A warm "smoky" adult voice, with slow pacing.' }] });
  const missing = output.replace(voices[0].description, '');
  const patched = applyVoiceDirections(missing, custom);
  assert.equal(applyVoiceDirections(patched, custom), patched);
  assert.deepEqual(validateOutput(patched, custom).errors, []);
  const ambiguous = missing.replaceAll('(S2)', '(S1)');
  assert.equal(applyVoiceDirections(ambiguous, normalizeInput(input)), ambiguous);
});

test('characters sharing a preset each receive their own direction at the correct shot identity', () => {
  const same = normalizeInput({ ...input, characterVoices: selection.map(v => ({ ...v, presetId: 'nora' })) });
  const text = output.replace(voices[1].description, '').replace('Kai (S2)', '[Shot 2] At 00:02.000, the camera cuts to Kai (S2)');
  assert.ok(validateOutput(text, same).errors.some(e => /Kai.*exact selected voice/.test(e)));
  const patched = applyVoiceDirections(text, same);
  assert.equal(patched.split(voices[0].description).length - 1, 2);
  assert.ok(patched.includes(`[Shot 2] At 00:02.000, the camera cuts to Kai (S2) (speaking voice: ${voices[0].description})`));
  assert.equal(patched.replace(` (speaking voice: ${voices[0].description})`, ''), text);
  assert.equal(applyVoiceDirections(patched, same), patched);
  assert.deepEqual(validateOutput(patched, same).errors, []);
});
