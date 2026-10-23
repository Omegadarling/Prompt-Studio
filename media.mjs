import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MEDIA_LIMITS = Object.freeze({ pictureBytes: 10 * 1024 * 1024, audioBytes: 24 * 1024 * 1024, videoBytes: 24 * 1024 * 1024, imagePixels: 20_000_000, durationSeconds: 120, videoFrames: 3, frameEdge: 1280 });

export class MediaError extends Error {
  constructor(message, code) { super(message); this.name = 'MediaError'; this.code = code; }
}

function fail(message, code = 'INVALID_MEDIA') { throw new MediaError(message, code); }

function decode(data, limit) {
  if (typeof data !== 'string' || !data.length || data.length > Math.ceil(limit / 3) * 4 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    fail('Upload a complete file as base64 data, within the media size limit. File paths and URLs are not accepted.');
  }
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > limit || bytes.toString('base64') !== data) fail('The media data is invalid or exceeds its size limit.');
  return bytes;
}

function imageInfo(bytes) {
  let mimeType, width, height;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    mimeType = 'image/png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mimeType = 'image/jpeg';
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  } else if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    mimeType = 'image/webp';
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X') {
      if (bytes[20] & 2) fail('Animated WebP is not supported as a picture. Upload a still frame or a video.');
      width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3);
    } else if (kind === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff;
    } else if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    }
  }
  if (!mimeType || !width || !height) fail('Use a readable PNG, JPEG, or still WebP picture.');
  if (width * height > MEDIA_LIMITS.imagePixels) fail('The picture is too large. Resize it to 20 megapixels or fewer.');
  return { mimeType, width, height };
}

function identify(bytes, type) {
  if (type === 'picture') return imageInfo(bytes);
  const iso = bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
  if (type === 'video') {
    if (iso) return { mimeType: bytes.toString('ascii', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4', extension: '.mp4' };
    if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) return { mimeType: 'video/webm', extension: '.webm' };
    fail('Use an MP4, MOV, or WebM video.');
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return { mimeType: 'audio/wav' };
  if (bytes.toString('ascii', 0, 4) === 'fLaC') return { mimeType: 'audio/flac' };
  if (bytes.toString('ascii', 0, 4) === 'OggS') return { mimeType: 'audio/ogg' };
  if (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes.length >= 2 && bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) return { mimeType: 'audio/mpeg' };
  if (iso) return { mimeType: 'audio/mp4' };
  fail('Use a WAV, MP3, FLAC, Ogg, or M4A audio file.');
}

function browserVideo(upload, name) {
  const duration = upload.durationSeconds;
  if (!Number.isFinite(duration) || duration <= 0 || duration > MEDIA_LIMITS.durationSeconds || !Array.isArray(upload.frames) || !upload.frames.length || upload.frames.length > MEDIA_LIMITS.videoFrames) fail('Upload one to three preview frames from a video no longer than 120 seconds.');
  let previous = -1;
  const images = upload.frames.map((frame) => {
    if (!frame || typeof frame !== 'object' || !Number.isFinite(frame.timestampSeconds) || frame.timestampSeconds < 0 || frame.timestampSeconds > duration || frame.timestampSeconds <= previous) fail('Video preview timestamps must be in order and within the clip duration.');
    previous = frame.timestampSeconds;
    const bytes = decode(frame.data, MEDIA_LIMITS.pictureBytes);
    const info = imageInfo(bytes);
    if (info.mimeType !== 'image/jpeg' || frame.mimeType !== 'image/jpeg' || info.width > MEDIA_LIMITS.frameEdge || info.height > MEDIA_LIMITS.frameEdge) fail('Video previews must be JPEG frames no larger than 1280 pixels on either edge.');
    return { data: bytes.toString('base64'), mimeType: info.mimeType, timestampSeconds: frame.timestampSeconds };
  });
  return { type: 'video', name, images, durationSeconds: duration, transcript: null, warnings: ['Only sampled video frames are available for description. Motion between frames and the audio were not analyzed.'] };
}

/** Validate browser-decoded PCM before any transcription process is started. */
export function inspectPcmWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) fail('Audio must be a complete PCM WAV file.');
  let format, dataLength;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) fail('The audio WAV file is incomplete.');
    if (id === 'fmt ' && size >= 16) format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), rate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8), block: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
    if (id === 'data') { if (dataLength !== undefined) fail('Use a WAV file with one audio data chunk.'); dataLength = size; }
    offset = start + size + (size % 2);
  }
  if (!format || format.encoding !== 1 || format.channels !== 1 || format.rate !== 16000 || format.byteRate !== 32000 || format.block !== 2 || format.bits !== 16 || !dataLength || dataLength % 2) fail('Decode audio to mono 16 kHz, 16-bit PCM WAV before uploading.');
  const durationSeconds = dataLength / 32000;
  if (durationSeconds > MEDIA_LIMITS.durationSeconds) fail('Use audio lasting no more than 120 seconds.');
  return { durationSeconds };
}

export function createWhisperTranscriber(options = {}) {
  const runtime = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'whisper');
  return async ({ bytes }) => {
    inspectPcmWav(bytes);
    const root = resolve(options.tempRoot || tmpdir());
    await mkdir(root, { recursive: true });
    const temp = await mkdtemp(join(root, 'h3-media-'));
    try {
      await chmod(temp, 0o700);
      const source = join(temp, 'audio.wav'), output = join(temp, 'transcript');
      await writeFile(source, bytes, { mode: 0o600 });
      const run = options.runCommand || runMediaCommand;
      await run(options.whisperCliPath || process.env.H3_WHISPER_CLI || join(runtime, 'bin', 'whisper-cli'), ['-m', options.whisperModelPath || process.env.H3_WHISPER_MODEL || join(runtime, 'models', 'ggml-tiny.bin'), '-f', source, '-l', 'auto', '-t', '4', '-ng', '-nt', '-otxt', '-of', output], { timeoutMs: Math.min(options.timeoutMs || 120_000, 180_000) });
      const text = await readFile(`${output}.txt`, 'utf8');
      return { text };
    } catch (error) {
      if (error.code === 'ENOENT') fail('The local speech transcription runtime is unavailable. Describe this audio manually while its installation is checked.', 'AUDIO_TRANSCRIPTION_UNAVAILABLE');
      throw error;
    } finally {
      if (dirname(temp) === root && basename(temp).startsWith('h3-media-')) await rm(temp, { recursive: true, force: true });
    }
  };
}

/** Run fixed media-tool arguments without a shell; bound time and diagnostic output. */
export function runMediaCommand(command, args, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', total = 0, stoppedError;
    const timer = setTimeout(() => { stoppedError = new MediaError('Media preparation took too long. Try a shorter or smaller clip.', 'MEDIA_TIMEOUT'); child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      total += chunk.length;
      if (total > 262144) { stoppedError = new MediaError('Video inspection returned too much metadata.', 'INVALID_MEDIA'); child.kill('SIGKILL'); }
      else output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      total += chunk.length;
      if (total > 262144) { stoppedError = new MediaError('Video inspection failed.', 'INVALID_MEDIA'); child.kill('SIGKILL'); }
    });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stoppedError) reject(stoppedError);
      else if (code !== 0) reject(new MediaError('The media could not be processed. Check the file format and local media runtime.', 'INVALID_MEDIA'));
      else resolveResult(output);
    });
  });
}

/** Prepare one uploaded file. Options are trusted server configuration, never request fields. */
export async function prepareMedia(upload, options = {}) {
  if (!upload || typeof upload !== 'object' || Array.isArray(upload) || !['picture', 'audio', 'video'].includes(upload.type)) fail('Choose Picture, Audio, or Video for the uploaded file.');
  if ('path' in upload || 'url' in upload) fail('Upload media bytes; file paths and remote URLs are not accepted.');
  const type = upload.type;
  const name = typeof upload.name === 'string' && upload.name.length <= 200 ? upload.name.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).at(-1) : 'Uploaded media';
  if (type === 'video' && upload.frames !== undefined) return browserVideo(upload, name);
  const bytes = decode(upload.data, MEDIA_LIMITS[`${type}Bytes`]);
  const info = identify(bytes, type);
  if (upload.mimeType && upload.mimeType !== info.mimeType && !(info.mimeType === 'audio/wav' && ['audio/x-wav', 'audio/wave'].includes(upload.mimeType))) fail('The file contents do not match its declared media type.');
  const result = { type, name, images: [], transcript: null, warnings: [] };
  if (type === 'picture') {
    result.images.push({ data: bytes.toString('base64'), mimeType: info.mimeType });
    return result;
  }
  if (type === 'audio') {
    if (info.mimeType !== 'audio/wav') fail('The browser must decode audio to mono 16 kHz PCM WAV before uploading.');
    result.durationSeconds = inspectPcmWav(bytes).durationSeconds;
    const transcript = await (options.transcribeAudio || createWhisperTranscriber(options))({ bytes, mimeType: info.mimeType, name });
    if (typeof transcript?.text !== 'string' || transcript.text.length > 12000) fail('The transcription service returned invalid speech text.', 'INVALID_TRANSCRIPT');
    let text = transcript.text.trim();
    if (/^(?:\[(?:blank_audio|silence|no speech|music)\]|\((?:silence|music)\))$/i.test(text)) text = '';
    result.transcript = { text, ...(typeof transcript.language === 'string' && /^[a-zA-Z-]{2,20}$/.test(transcript.language) ? { language: transcript.language } : {}) };
    if (!text) result.warnings.push('No intelligible speech was transcribed. Describe music or sound effects manually; their content was not analyzed.');
    result.warnings.push('Speech transcription does not identify the speaker or describe music, tone, or other sounds. Review the words.');
    return result;
  }
  const run = options.runCommand || runMediaCommand;
  const root = resolve(options.tempRoot || tmpdir());
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(join(root, 'h3-media-'));
  try {
    await chmod(temp, 0o700);
    const source = join(temp, `source${info.extension}`);
    await writeFile(source, bytes, { mode: 0o600 });
    const metadata = await run(options.ffprobePath || 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', source]);
    let parsed;
    try { parsed = JSON.parse(metadata); } catch { fail('The video metadata could not be read.'); }
    const stream = parsed.streams?.find((item) => item.codec_type === 'video');
    const duration = Number(parsed.format?.duration);
    if (!stream || !Number.isFinite(duration) || duration <= 0 || duration > MEDIA_LIMITS.durationSeconds) fail('Use a video with a readable video track lasting no more than 120 seconds.');
    if (!Number.isInteger(stream.width) || !Number.isInteger(stream.height) || stream.width <= 0 || stream.height <= 0 || stream.width * stream.height > MEDIA_LIMITS.imagePixels) fail('The video frame size is invalid or exceeds 20 megapixels.');
    for (const fraction of [0.1, 0.5, 0.9]) {
      const timestampSeconds = Math.round(duration * fraction * 1000) / 1000;
      const frame = join(temp, `frame-${result.images.length}.jpg`);
      await run(options.ffmpegPath || 'ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-threads', '2', '-ss', String(timestampSeconds), '-i', source, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease', '-filter_threads', '1', '-threads', '2', '-q:v', '3', '-y', frame]);
      const frameBytes = await readFile(frame);
      if (frameBytes.length > MEDIA_LIMITS.pictureBytes) fail('An extracted frame exceeds the picture size limit.');
      const frameInfo = imageInfo(frameBytes);
      if (frameInfo.mimeType !== 'image/jpeg' || frameInfo.width > MEDIA_LIMITS.frameEdge || frameInfo.height > MEDIA_LIMITS.frameEdge) fail('The video tool returned an invalid preview frame.');
      result.images.push({ data: frameBytes.toString('base64'), mimeType: frameInfo.mimeType, timestampSeconds });
    }
    result.durationSeconds = duration;
    result.warnings.push('Only three sampled video frames are available for description. Motion between frames and the audio were not analyzed.');
    return result;
  } catch (error) {
    if (error.code === 'ENOENT') fail('Video preview tools are not installed on this app host. Upload a few still frames as Pictures, or describe the video manually.', 'VIDEO_TOOLS_UNAVAILABLE');
    throw error;
  } finally {
    // The cleanup target is only the freshly created private child of the trusted temp root.
    if (dirname(temp) === root && basename(temp).startsWith('h3-media-')) await rm(temp, { recursive: true, force: true });
  }
}
