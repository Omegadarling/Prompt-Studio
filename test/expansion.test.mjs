import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpansionMessages, parseExpansion, EXPANSION_PARTS, EXPANSION_SCHEMA } from '../expansion.mjs';
import { normalizeInput, buildMessages, validateOutput } from '../prompting.mjs';
import { normalizeJob, buildStoryboardMessages, storyboardPlan } from '../storyboard.mjs';
import { createProvider } from '../provider.mjs';
import { rewrite } from '../server.mjs';

const raw = { prompt: 'A fox walks through a snowy forest. One static continuous shot. No music.', creativity: 'fluff', duration: 6, music: 'none' };
const expansion = () => JSON.stringify({
  scene_and_composition: 'A fox walks through a snowy forest, framed among layers of tree trunks.',
  lighting_and_color: 'Soft diffuse daylight settles over the pale snow and creates gentle shadows.',
  surface_and_environment_detail: 'Fine frost traces the bark while the snow has a soft granular surface.',
  existing_action_detail: 'The fox transfers its weight smoothly from paw to paw as it walks.',
  camera_and_continuity: 'One static continuous shot keeps the same framing throughout the six seconds.',
  constraints_and_sound: 'No music. The fox continues walking without additional actions or dialogue.',
});
const formatted = 'integrated_multimodal_description:\n[Shot 1] A fox walks through a snowy forest. One static continuous shot. From 0.000 to 6.000 seconds, the fox walks steadily. No music.\n\noverall_soundscape:\nSoft footsteps in snow.\n\nnon_diegetic_music:\nN/A';

test('Fluff up is explicit and does not change faithful/enrich defaults or source data', () => {
  assert.equal(normalizeInput({ prompt: raw.prompt }).creativity, 'faithful');
  assert.equal(normalizeInput({ ...raw, creativity: 'enrich' }).creativity, 'enrich');
  assert.throws(() => normalizeInput({ ...raw, creativity: 'fluffier' }), /valid creativity/);
  const messages = buildMessages(raw);
  assert.equal(JSON.parse(messages[1].content).prompt, raw.prompt);
  assert.match(messages[0].content, /FLUFF UP — SUBSTANTIAL DESCRIPTIVE EXPANSION/);
  assert.match(messages[0].content, /All explicit details and exclusions override/);
  assert.match(messages[0].content, /do not invent unseen reference appearance/);
  assert.ok(!buildMessages({ ...raw, creativity: 'faithful' })[0].content.includes('FLUFF UP'));
});

test('expansion rejects malformed, empty, extra and oversized data without truncating it', () => {
  const data = JSON.parse(expansion());
  for (const text of ['unfinished', '{}', '[]', JSON.stringify({ ...data, extra: 'x' }), JSON.stringify({ ...data, scene_and_composition: '' }), JSON.stringify({ ...data, scene_and_composition: 'x'.repeat(2501) })]) assert.throws(() => parseExpansion(text));
  const enormous = Object.fromEntries(Object.keys(EXPANSION_PARTS).map(k => [k, 'x'.repeat(2200)]));
  assert.throws(() => parseExpansion(JSON.stringify(enormous)), /too long/);
  assert.equal(parseExpansion(expansion()), Object.values(data).join('\n\n'));
});

test('two-pass rewrite keeps original brief authoritative, honors the deadline and totals usage', async () => {
  const seen = [];
  const original = structuredClone(raw);
  const provider = { async complete(messages, context) {
    seen.push({ messages, context });
    return { text: seen.length === 1 ? expansion() : formatted, provider: 'Synthetic', usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } };
  } };
  const result = await rewrite(raw, provider);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].context.task, 'expand');
  assert.equal(seen[1].context.creativity, 'fluff');
  assert.ok(seen[1].context.timeoutMs <= seen[0].context.timeoutMs);
  const source = JSON.parse(seen[1].messages[1].content);
  assert.equal(source.originalBrief, raw.prompt);
  assert.equal(source.prompt, parseExpansion(expansion()));
  assert.equal(source.music, 'none'); assert.equal(source.duration, 6);
  assert.match(seen[1].messages[0].content, /originalBrief.*has priority/);
  assert.deepEqual(raw, original); assert.equal(result.usage.total_tokens, 60);
  assert.ok(result.validation.warnings.some(w => /Fluff up produced a short/.test(w)));
  assert.equal(result.text, formatted);
});

test('failed expansion stops before formatting; failed formatting never starts a retry', async () => {
  for (const failure of ['initial', 'malformed', 'format']) {
    let calls = 0;
    await assert.rejects(rewrite(raw, { async complete() {
      calls++;
      if (failure === 'initial' || (failure === 'format' && calls === 2)) throw new Error('Synthetic failure');
      return { text: failure === 'malformed' ? '{}' : expansion(), provider: 'Ollama' };
    } }));
    assert.equal(calls, failure === 'format' ? 2 : 1);
  }
});

test('existing modes use one generation and incomplete two-pass usage is not misreported', async () => {
  for (const creativity of ['faithful', 'enrich']) {
    let calls = 0;
    const result = await rewrite({ ...raw, creativity }, { async complete() { calls++; return { text: formatted, provider: 'Ollama' }; } });
    assert.equal(calls, 1); assert.deepEqual(result.validation.errors, []);
  }
  let calls = 0;
  const result = await rewrite(raw, { async complete() { return ++calls === 1 ? { text: expansion() } : { text: formatted, usage: { total_tokens: 10 } }; } });
  assert.equal(result.usage, null);
});

test('validation still checks original exact dialogue after expansion and correction keeps richness', async () => {
  const job = { ...raw, prompt: 'The fox says <d>[English] Wait!</d> No music.' };
  const calls = [];
  const result = await rewrite(job, { async complete(messages, context) {
    calls.push({ messages, context });
    return { text: calls.length === 1 ? expansion() : formatted, provider: 'Ollama', usage: { total_tokens: 10 } };
  } });
  assert.equal(calls.length, 3);
  assert.match(calls[2].messages.at(-1).content, /Keep the requested substantial descriptive expansion/);
  assert.ok(result.validation.errors.some(e => /Wait!/.test(e)));
  assert.equal(result.repair.applied, false);
  assert.equal(result.usage.total_tokens, 30, 'Discarded corrections still consumed tokens');
});

test('paid-provider usage sums both passes without presenting one pass cost breakdown as the total', async () => {
  let calls = 0;
  const result = await rewrite(raw, { async complete() {
    calls++;
    return { text: calls === 1 ? expansion() : formatted, provider: 'OpenRouter', usage: { total_tokens: 10, cost: calls / 100, cost_details: { upstream_inference_cost: calls / 100 } } };
  } });
  assert.equal(calls, 2); assert.equal(result.usage.total_tokens, 20);
  assert.equal(result.usage.cost, 0.03); assert.equal(result.usage.cost_details, null);
});

test('storyboard expansion retains reference facts, global constraints and per-chunk detail targets', () => {
  const job = normalizeJob({ ...raw, outputFormat: 'storyboard', storyboard: { secondsPerChunk: 5, chunkCount: 2 }, assets: [{ id: 'fox', type: 'picture', description: 'Fox identity only; ignore source pose and background.' }] });
  const expansionMessages = buildExpansionMessages(job);
  const data = JSON.parse(expansionMessages[1].content);
  assert.equal(data.referenceNotes, job.referenceNotes); assert.equal(data.prompt, raw.prompt);
  const messages = buildStoryboardMessages(job);
  assert.match(messages[0].content, /100–180 words in each detailed_description/);
  assert.match(messages[0].content, /do not repeat the whole story/);
});

test('storyboard expansion receives the complete delivered duration rather than one sampled chunk', async () => {
  const job = { ...raw, outputFormat: 'storyboard', storyboard: { secondsPerChunk: 5, chunkCount: 2 }, assets: [{ id: 'fox', type: 'picture', description: 'Fox identity.' }] };
  let calls = 0;
  await assert.rejects(rewrite(job, { async complete(messages) {
    calls++;
    const data = JSON.parse(messages[1].content);
    assert.equal(data.duration, storyboardPlan(job.storyboard).duration);
    assert.match(data.durationScope, /whole finished story/);
    throw new Error('Inspected expansion request only');
  } }), /Inspected expansion request only/);
  assert.equal(calls, 1);
});

test('Ollama expansion uses its dedicated schema without leaking expansion rules into ordinary requests', async () => {
  const sent = [];
  const provider = createProvider({ settings: { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'synthetic' }, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body);
    const plain = body.format.required.includes('scene_and_composition') ? expansion() : JSON.stringify({ integrated_multimodal_description: '[Shot 1] A fox walks.', overall_soundscape: 'Quiet forest.', non_diegetic_music: 'N/A' });
    return new Response(JSON.stringify({ done: true, done_reason: 'stop', message: { content: plain } }));
  } });
  await provider.complete(buildExpansionMessages(normalizeInput(raw)), { task: 'expand' });
  await provider.complete(buildMessages(raw), { mode: 't2v', creativity: 'fluff' });
  await provider.complete(buildMessages({ ...raw, creativity: 'faithful' }), { mode: 't2v', creativity: 'faithful' });
  assert.deepEqual(sent[0].format, EXPANSION_SCHEMA); assert.equal(sent[0].think, false);
  assert.match(sent[1].format.properties.integrated_multimodal_description.description, /FLUFF UP/);
  assert.ok(!sent[2].format.properties.integrated_multimodal_description.description.includes('FLUFF UP'));
});
