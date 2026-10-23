import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, normalizeInput, validateOutput } from '../prompting.mjs';
const input = { prompt: 'A robot waves. No music.', duration: 5, music: 'none' };
const prompt = body => `integrated_multimodal_description: ${body}\n\noverall_soundscape: The robot joints softly click.\n\nnon_diegetic_music: N/A`;
const errors = body => validateOutput(prompt(body), input).errors;

test('timing defaults to cues, preserves explicit times, and natural disables estimates only', () => {
  assert.equal(normalizeInput(input).timing, 'cued');
  assert.throws(() => normalizeInput({ ...input, timing: 'unknown' }));
  const cued = buildMessages(input)[0].content;
  assert.match(cued, /Preserve any explicit times and ranges/);
  assert.match(cued, /estimate a sensible schedule/);
  assert.match(cued, /BEFORE the first cue/);
  assert.match(buildMessages({ ...input, timing: 'natural' })[0].content, /Do not add estimated timestamps/);
});

test('cues must stay in the duration and ordered ranges must be nonempty', () => {
  assert.deepEqual(errors('[Shot 1] A robot stands still. From 0.000 to 2.000 seconds, it lifts one hand. At 3.000 seconds, it waves.'), []);
  for (const cue of ['At 12 seconds into the finished video it waves.', 'From 3 to 7 seconds it waves.', 'At -1 seconds, it waves.', 'From 4 to 2 seconds, it waves.', 'From 2 to 2 seconds, it waves.']) assert.ok(errors(`[Shot 1] A robot stands still. ${cue}`).length, cue);
  assert.ok(errors('[Shot 1] From 0 to 2 seconds, the robot waves.').some(e => /must not begin/.test(e)));
});

test('cut windows constrain cues and quoted content is never interpreted as timing', () => {
  assert.ok(errors('[Shot 1] A robot stands still. From 1 to 4 seconds, it waves. [Shot 2] At 00:03.000, the camera cuts to its hand.').some(e => /outside \[Shot 1\]/.test(e)));
  assert.deepEqual(errors('[Shot 1] A robot stands still. At 1 seconds, it waves. [Shot 2] At 00:03.000, the camera cuts to its hand. From 3 to 5 seconds, the hand lowers.'), []);
  assert.deepEqual(errors('[Shot 1] A robot (S1) says <d>[English] At 50 seconds we leave.</d> beside a sign reading "From 40 to 60 seconds".'), []);
});

test('missing cues produce review notes, not fabricated timestamps or a failed rewrite', () => {
  const text = prompt('[Shot 1] A robot waves.');
  const result = validateOutput(text, input);
  assert.deepEqual(result.errors, []); assert.ok(result.warnings.some(w => /No action time cues/.test(w)));
  assert.ok(!validateOutput(text, { ...input, timing: 'natural' }).warnings.some(w => /No action time cues/.test(w)));
});
