import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareMedia, inspectPcmWav, runMediaCommand } from '../media.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6k1sAAAAASUVORK5CYII=', 'base64');
// Minimal dimension headers are sufficient for these metadata-only unit tests.
function jpeg(width = 640, height = 360) { const bytes = Buffer.from('ffd8ffc00011080000000003011100021100031100ffd9', 'hex'); bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9); return bytes; }
function wav(seconds = 1) { const bytes = Buffer.alloc(44 + seconds * 32000); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes; }
const picture = { type: 'picture', name: 'image.png', mimeType: 'image/png', data: png.toString('base64') };
const video = { type: 'video', name: 'clip.mp4', mimeType: 'video/mp4', durationSeconds: 10, frames: [1, 5, 9].map(timestampSeconds => ({ data: jpeg().toString('base64'), mimeType: 'image/jpeg', timestampSeconds })) };
const rawVideo = { type: 'video', data: Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex').toString('base64'), mimeType: 'video/mp4' };
const audio = { type: 'audio', data: wav().toString('base64'), mimeType: 'audio/wav', name: 'voice.wav' };
async function withTemp(fn) { const root = await mkdtemp(join(tmpdir(), 'h3-media-tests-')); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }

test('picture preparation uses real bytes, normalizes filenames, and makes no subprocess call', async () => {
  const result = await prepareMedia({ ...picture, name: '../secret/image.png' }, { runCommand() { assert.fail('No subprocess for pictures'); } });
  assert.equal(result.name, 'image.png'); assert.deepEqual(result.images, [{ data: picture.data, mimeType: 'image/png' }]); assert.equal(result.transcript, null);
});

test('paths, URLs, malformed base64, wrong MIME, unsupported media and oversized dimensions are rejected', async () => {
  const huge = Buffer.from(png); huge.writeUInt32BE(10000, 16); huge.writeUInt32BE(10000, 20);
  for (const upload of [{ ...picture, path: '/etc/passwd' }, { ...picture, url: 'http://example.com' }, { ...picture, data: 'data:image/png;base64,' + picture.data }, { ...picture, data: 'AB==' }, { ...picture, mimeType: 'image/jpeg' }, { ...picture, data: Buffer.from('GIF89a').toString('base64') }, { ...picture, data: huge.toString('base64') }]) await assert.rejects(prepareMedia(upload), { code: 'INVALID_MEDIA' });
});

test('browser video previews retain timestamps and disclose unseen motion and audio', async () => {
  const result = await prepareMedia(video, { runCommand() { assert.fail('Browser frames need no ffmpeg'); } });
  assert.deepEqual(result.images.map(x => x.timestampSeconds), [1, 5, 9]); assert.equal(result.durationSeconds, 10); assert.match(result.warnings[0], /audio were not analyzed/);
});

test('video preview count, size, duration, order and image type are bounded', async () => {
  for (const upload of [{ ...video, frames: [] }, { ...video, frames: [...video.frames, video.frames[2]] }, { ...video, durationSeconds: 121 }, { ...video, frames: [video.frames[1], video.frames[0]] }, { ...video, frames: [{ ...video.frames[0], timestampSeconds: 11 }] }, { ...video, frames: [{ ...video.frames[0], data: jpeg(1281).toString('base64') }] }, { ...video, frames: [{ ...video.frames[0], data: picture.data, mimeType: 'image/png' }] }]) await assert.rejects(prepareMedia(upload), { code: 'INVALID_MEDIA' });
});

test('PCM WAV metadata is validated before transcription and speech-only limitations are returned', async () => {
  let calls = 0;
  const transcribeAudio = async ({ bytes }) => { calls++; assert.equal(inspectPcmWav(bytes).durationSeconds, 1); return { text: ' Hello world. ', language: 'en' }; };
  const result = await prepareMedia(audio, { transcribeAudio });
  assert.deepEqual(result.transcript, { text: 'Hello world.', language: 'en' }); assert.match(result.warnings[0], /music/); assert.equal(calls, 1);
  const stereo = wav(); stereo.writeUInt16LE(2, 22);
  for (const bytes of [stereo, wav(121), wav().subarray(0, 100)]) await assert.rejects(prepareMedia({ ...audio, data: bytes.toString('base64') }, { transcribeAudio }), { code: 'INVALID_MEDIA' });
  assert.equal(calls, 1);
});

test('empty speech output and no-speech markers return honest warnings without invented audio facts', async () => {
  for (const text of ['  ', '[BLANK_AUDIO]', '[Music]']) {
    const result = await prepareMedia(audio, { transcribeAudio: async () => ({ text }) });
    assert.equal(result.transcript.text, ''); assert.match(result.warnings[0], /No intelligible speech/);
  }
  for (const text of [null, 'x'.repeat(12001)]) await assert.rejects(prepareMedia(audio, { transcribeAudio: async () => ({ text }) }), { code: 'INVALID_TRANSCRIPT' });
});

test('whisper subprocess uses fixed CPU arguments and removes all transient files', async () => withTemp(async (tempRoot) => {
  const result = await prepareMedia(audio, { tempRoot, whisperCliPath: 'test-whisper', whisperModelPath: 'test-model', runCommand: async (command, args, options) => {
    assert.equal(command, 'test-whisper'); assert.equal(args[args.indexOf('-t') + 1], '4'); assert.ok(args.includes('-ng')); assert.ok(options.timeoutMs <= 180000);
    assert.equal((await readFile(args[args.indexOf('-f') + 1])).length, wav().length);
    await writeFile(`${args[args.indexOf('-of') + 1]}.txt`, 'Synthetic speech.'); return '';
  } });
  assert.equal(result.transcript.text, 'Synthetic speech.'); assert.deepEqual(await readdir(tempRoot), []);
}));

test('missing transcription runtime has a clear error and leaves no temporary files', async () => withTemp(async (tempRoot) => {
  await assert.rejects(prepareMedia(audio, { tempRoot, runCommand: async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); } }), { code: 'AUDIO_TRANSCRIPTION_UNAVAILABLE' });
  assert.deepEqual(await readdir(tempRoot), []);
}));

test('raw video extracts three bounded frames and cleans up on success and failure', async () => withTemp(async (tempRoot) => {
  let calls = 0;
  const runCommand = async (command, args) => { calls++; if (command === 'ffprobe') return JSON.stringify({ format: { duration: '10' }, streams: [{ codec_type: 'video', width: 1920, height: 1080 }] }); await writeFile(args.at(-1), jpeg()); return ''; };
  const result = await prepareMedia(rawVideo, { tempRoot, runCommand });
  assert.equal(calls, 4); assert.deepEqual(result.images.map(x => x.timestampSeconds), [1, 5, 9]); assert.deepEqual(await readdir(tempRoot), []);
  await assert.rejects(prepareMedia(rawVideo, { tempRoot, runCommand: async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); } }), { code: 'VIDEO_TOOLS_UNAVAILABLE' });
  assert.deepEqual(await readdir(tempRoot), []);
}));

test('media command timeout terminates its child without exposing tool output', async () => {
  await assert.rejects(runMediaCommand(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 50 }), { code: 'MEDIA_TIMEOUT' });
});
