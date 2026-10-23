import test from 'node:test';
import assert from 'node:assert/strict';
import { rewrite } from '../server.mjs';

const input = { prompt: 'A clay fox opens the door. No music.' };
const draft = 'integrated_multimodal_description: A clay fox opens the door.\n\noverall_soundscape: A hinge creaks.\n\nnon_diegetic_music: N/A';
const corrected = draft.replace('A clay fox', '[Shot 1] A clay fox');

test('one local format correction keeps the original brief, selected mode and shared deadline', async () => {
  const calls = [];
  const result = await rewrite(input, { async complete(messages, context) {
    calls.push({ messages, context });
    return { provider: 'Ollama', model: 'synthetic', text: calls.length === 1 ? draft : corrected,
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } };
  } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].messages.slice(0, 2), calls[0].messages);
  assert.equal(calls[1].messages[2].content, draft);
  assert.match(calls[1].messages[3].content, /must contain \[Shot 1\]/);
  assert.equal(calls[1].context.mode, 't2v');
  assert.ok(calls[1].context.timeoutMs <= calls[0].context.timeoutMs);
  assert.equal(result.text, corrected);
  assert.deepEqual(result.validation.errors, []);
  assert.deepEqual(result.repair, { attempted: true, applied: true });
  assert.equal(result.usage.total_tokens, 60);
});

test('a failed or worse correction retains the complete first draft with honest validation', async () => {
  for (const outcome of ['failed', 'worse']) {
    let calls = 0;
    const result = await rewrite(input, { async complete() {
      calls++;
      if (calls === 1) return { provider: 'Ollama', text: draft };
      if (outcome === 'failed') throw Object.assign(new Error('partial reply'), { code: 'OLLAMA_OUTPUT_LIMIT' });
      return { provider: 'Ollama', text: 'Wrong fields and no usable content.' };
    } });
    assert.equal(calls, 2);
    assert.equal(result.text, draft);
    assert.equal(result.repair.applied, false);
    assert.ok(result.validation.errors.length);
    assert.ok(result.validation.warnings.some(w => w.includes('could not improve')));
  }
});

test('valid local drafts, cloud drafts and initial incomplete responses never trigger correction', async () => {
  for (const example of [{ provider: 'Ollama', text: corrected }, { provider: 'OpenRouter', text: draft }]) {
    let calls = 0;
    const result = await rewrite(input, { async complete() { calls++; return example; } });
    assert.equal(calls, 1);
    assert.equal(result.repair, undefined);
  }
  let calls = 0;
  await assert.rejects(rewrite(input, { async complete() { calls++; throw Object.assign(new Error('Reply limit'), { code: 'OLLAMA_OUTPUT_LIMIT' }); } }), { code: 'OLLAMA_OUTPUT_LIMIT' });
  assert.equal(calls, 1);
});
