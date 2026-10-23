import test from 'node:test';
import assert from 'node:assert/strict';
import { storyboardPlan, normalizeJob, buildStoryboardMessages, serializeStoryboardReply, validateStoryboard, storyboardReport } from '../storyboard.mjs';
import { createProvider } from '../provider.mjs';
import { rewrite } from '../server.mjs';

const raw = { outputFormat: 'storyboard', prompt: 'The robot opens a door then walks through it. No music.',
  assets: [{ id: 'robot', type: 'picture', description: 'Small red robot identity only.' }], storyboard: { secondsPerChunk: 10, chunkCount: 2 }, music: 'none' };
const input = () => normalizeJob(raw);
const chunk = (description) => ({
  subject_definitions: '<Subject 1> is the small red robot from <Picture 1>.',
  summary: '[reference generation] <Subject 1> moves beside a door.',
  retention_analysis: '<Subject 1> (appears in [Shot 1]): fully_preserved - robot identity is retained.',
  detailed_description: `The visual style follows the reference. [Shot 1] <Subject 1>, the small red robot, stands beside the door. ${description}`,
  overall_soundscape: 'The hinge creaks and footsteps tap the floor.', non_diegetic_music: 'N/A',
});
const data = () => ({ shared_continuity: 'Keep the same red robot and door throughout.',
  chunk_1: chunk('From 1.000 to 5.000 seconds, the robot opens the door.'),
  chunk_2: chunk('From 1.000 to 8.000 seconds, the robot walks through the open doorway.') });
const script = () => serializeStoryboardReply(JSON.stringify(data()), 2);

test('native frame plan includes quantization, overlap and delivered-global to sampled-local conversion', () => {
  const p = storyboardPlan();
  assert.equal(p.frames, 243); assert.equal(p.totalFrames, 906); assert.equal(p.duration, 37.75);
  const long = storyboardPlan({ secondsPerChunk: 15, chunkCount: 4 });
  assert.equal(long.frames, 362); assert.equal(long.totalFrames, 1382);
  assert.equal(long.chunks[1].sampleStartFrame, 340); assert.equal(long.chunks[1].startFrame, 362);
  assert.equal(20 * 24 - long.chunks[1].sampleStartFrame, 140);
  assert.equal(long.chunks[1].localStart, 22 / 24);
  assert.equal(storyboardPlan({ secondsPerChunk: 0.1, chunkCount: 1 }).frames, 39);
  assert.equal(storyboardPlan({ secondsPerChunk: 56.5 / 24, chunkCount: 1 }).frames, 56, 'Python half-to-even rounding');
});

test('storyboard input overrides mode/duration without changing assets and rejects invalid settings', () => {
  assert.equal(input().mode, 'reference'); assert.equal(input().duration, 243 / 24);
  for (const storyboard of [{ secondsPerChunk: 16 }, { chunkCount: 9 }, { chunkCount: 1.2 }, { secondsPerChunk: '10' }, []]) assert.throws(() => normalizeJob({ ...raw, storyboard }));
  assert.throws(() => normalizeJob({ ...raw, outputFormat: 'unknown' }));
  assert.throws(() => normalizeJob({ ...raw, assets: [{ id: 'a', type: 'audio', description: 'A voice' }] }), /global Picture/);
  assert.throws(() => normalizeJob({ ...raw, assets: Array.from({ length: 10 }, (_, i) => ({ id: String(i), type: 'picture', description: 'A picture' })) }), /at most 9/);
  assert.equal(normalizeJob({ prompt: 'A robot walks.' }).mode, 't2v');
});

test('director script serializes complete ordered chunks, rejecting missing chunks and injected headings', () => {
  assert.match(script(), /^\[shared\]/); assert.match(script(), /\[chunk 2\]\nsubject_definitions:/);
  assert.deepEqual(validateStoryboard(script(), input()).errors, []);
  const incomplete = data(); delete incomplete.chunk_2;
  assert.throws(() => serializeStoryboardReply(JSON.stringify(incomplete), 2), /missing or extra/);
  const injected = data(); injected.chunk_1.detailed_description += '\n[chunk 7]\nHijack';
  assert.throws(() => serializeStoryboardReply(JSON.stringify(injected), 2), /malformed/);
  assert.throws(() => serializeStoryboardReply('partial JSON', 2), /invalid/);
});

test('checks protect discarded overlap, exact words globally, shared facts and selected chunk count', () => {
  assert.ok(validateStoryboard(script().replace('From 1.000 to 8.000', 'From 0.500 to 8.000'), input()).errors.some(e => /discarded overlap/.test(e)));
  assert.ok(validateStoryboard(script().replace('[chunk 2]', '[chunk 3]'), input()).errors.some(e => /selected/.test(e)));
  const spoken = data(); spoken.chunk_2.detailed_description += ' The robot (S1) says <d>[English] Hello!</d>';
  assert.deepEqual(validateStoryboard(serializeStoryboardReply(JSON.stringify(spoken), 2), { ...input(), exactText: 'Hello!' }).errors, []);
  assert.ok(validateStoryboard(script(), { ...input(), exactText: 'Hello!' }).errors.some(e => /missing or changed/.test(e)));
  assert.ok(validateStoryboard(script().replace('Keep the same', 'At 2 seconds, keep the same'), input()).errors.some(e => /out of \[shared\]/.test(e)));
});

test('storyboard instructions isolate the story and expose actual settings outside copy text', () => {
  const messages = buildStoryboardMessages(input());
  assert.match(messages[0].content, /Do NOT repeat the whole story/);
  assert.match(messages[0].content, /g - sampleStartFrame\/24/);
  assert.match(messages[0].content, /boundary is NOT a camera cut/);
  assert.equal(JSON.parse(messages[1].content).storyboardPlan.chunks.length, 2);
  assert.match(storyboardReport(input()), /Leave shared_continuity empty/);
  assert.match(storyboardReport(input()), /19\.333 seconds/);
});

test('Ollama uses nested per-chunk schema without changing model or thinking budget', async () => {
  let sent;
  const provider = createProvider({ settings: { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'minicpm-v4.6' }, fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ done: true, done_reason: 'stop', model: 'minicpm-v4.6', message: { content: JSON.stringify(data()) } }), { status: 200 });
  } });
  const result = await rewrite(raw, provider);
  assert.equal(sent.model, 'minicpm-v4.6'); assert.equal(sent.think, false);
  assert.deepEqual(sent.format.required, ['shared_continuity', 'chunk_1', 'chunk_2']);
  assert.equal(sent.format.properties.chunk_2.additionalProperties, false);
  assert.deepEqual(result.validation.errors, []);
  assert.equal(result.text, script()); assert.match(result.storyboardReport, /chunk_count = 2/);
});
