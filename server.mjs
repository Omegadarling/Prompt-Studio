import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { createProvider } from './provider.mjs';
import { createProviderManager, connectionFingerprint } from './settings.mjs';
import { normalizeInput, buildMessages, finalizeOutput, validateOutput } from './prompting.mjs';
import { describeMediaAsset, suggestAssetsFromBrief } from './asset-drafting.mjs';
import { normalizeJob, buildStoryboardMessages, validateStoryboard, storyboardReport, storyboardPlan } from './storyboard.mjs';
import { applyVoiceDirections } from './voices.mjs';
import { buildExpansionMessages, parseExpansion, useExpansion } from './expansion.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const VERSION = '1.5.0';
export const APP_ID = 'minimax-h3-prompt-studio';
const SOURCES = [
  { label: 'Base & keyframe guide', url: 'https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md' },
  { label: 'Full-reference guide', url: 'https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md' }
];

export async function rewrite(raw, provider = createProvider()) {
  const input = normalizeJob(raw);
  const storyboard = input.outputFormat === 'storyboard';
  let messages = storyboard ? buildStoryboardMessages(input) : buildMessages(input);
  const context = { mode: input.mode, creativity: input.creativity, ...(storyboard ? { outputFormat: 'storyboard', chunkCount: input.storyboard.chunkCount, storyboard: input.storyboard } : {}) };
  const finalize = text => applyVoiceDirections(storyboard ? text.trim() : finalizeOutput(text, input), input);
  const validate = text => storyboard ? validateStoryboard(text, input) : validateOutput(text, input);
  const extra = storyboard ? { storyboardReport: storyboardReport(input) } : {};
  const deadline = Date.now() + 300000;
  let expansionUsage = null;
  if (input.creativity === 'fluff') {
    const expansionInput = storyboard ? { ...input, duration: storyboardPlan(input.storyboard).duration, durationScope: 'whole finished story; keep supplied event times global' } : input;
    const expanded = await provider.complete(buildExpansionMessages(expansionInput), { task: 'expand', timeoutMs: Math.max(1, deadline - Date.now()) });
    messages = useExpansion(messages, parseExpansion(expanded.text), input.prompt);
    expansionUsage = expanded.usage;
  }
  const remainingForFormat = deadline - Date.now();
  if (remainingForFormat < 1000) throw new Error('The rewrite time budget ended after expansion. Your brief and previous result are unchanged. No formatting request was sent.');
  const result = await provider.complete(messages, { ...context, timeoutMs: remainingForFormat });
  if (input.creativity === 'fluff') result.usage = mergeUsage(expansionUsage, result.usage);
  const text = finalize(result.text);
  const first = { ...result, ...extra, text, validation: validate(text) };
  // A complete local draft may need one format correction. Never retry a failed
  // generation, change providers, or consume paid cloud usage automatically.
  if (result.provider !== 'Ollama' || !first.validation.errors.length) return first;
  const remaining = deadline - Date.now();
  const keepDraft = (reason, usage = first.usage) => ({ ...first, usage, repair: { attempted: reason !== 'time_budget', applied: false, reason },
    validation: { ...first.validation, warnings: [...first.validation.warnings,
      'The completed draft is shown with its format issues. Automatic correction could not improve it; review the issues below before using it.'] } });
  if (remaining < 1000) return keepDraft('time_budget');
  const correction = { role: 'user', content: `Correct the H3 format issues in the preceding draft using the ORIGINAL brief and settings above. Preserve every original creative constraint, exact dialogue, screen text, asset role, and ending. ${input.creativity === 'fluff' ? 'Keep the requested substantial descriptive expansion and compatible presentation details, while removing additions that contradict the brief or introduce new story events. Do not shorten the scene to a bare summary merely to fix formatting.' : 'Remove unsupported additions; do not invent details to make the prompt longer.'} Return the entire corrected prompt using the same selected mode and structured response format. Check all original constraints again, not only this list. Format issues:\n${first.validation.errors.map((error) => `- ${error}`).join('\n')}` };
  try {
    const corrected = await provider.complete([...messages, { role: 'assistant', content: text }, correction], { ...context, timeoutMs: remaining });
    const correctedText = finalize(corrected.text);
    const validation = validate(correctedText);
    const usage = mergeUsage(result.usage, corrected.usage);
    if (validation.errors.length >= first.validation.errors.length || validation.errors.some(error => !first.validation.errors.includes(error))) return keepDraft('not_improved', usage);
    return { ...corrected, ...extra, text: correctedText, usage, validation, repair: { attempted: true, applied: true } };
  } catch {
    return keepDraft('correction_failed', null);
  }
}

function mergeUsage(first, second) {
  if (!first || !second) return null;
  const keys = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'total_duration_ns', 'load_duration_ns'];
  if (Object.hasOwn(first, 'cost') || Object.hasOwn(second, 'cost')) keys.push('cost');
  return { ...second, ...Object.fromEntries(keys.map(key => [key,
    Number.isFinite(first[key]) && Number.isFinite(second[key]) ? first[key] + second[key] : null])),
    // Per-request breakdowns cannot describe the aggregate of multiple calls.
    ...(Object.hasOwn(first, 'cost_details') || Object.hasOwn(second, 'cost_details') ? { cost_details: null } : {}),
  };
}

async function readJson(request, limit = 160000) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw Object.assign(new Error('Use a JSON request.'), { status: 415 });
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error('This request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('The request is not valid JSON.'), { status: 400 }); }
}

export function isPrivateClient(address) {
  const ip = (address || '').replace(/^::ffff:/, '');
  if (ip === '::1') return true;
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
}

export function makeServer({ provider = createProvider(), allowedHosts = [], hostLabel = 'this computer' } = {}) {
  let busy = false;
  let configuring = false;
  let cachedStatus = null;
  let cachedFingerprint = null;
  let checkedAt = 0;
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
    try {
      const port = server.address().port;
      const hosts = ['127.0.0.1', 'localhost', ...allowedHosts].map(host => `${host.toLowerCase()}:${port}`);
      if (!hosts.includes(request.headers.host?.toLowerCase())) return send(403, { error: 'This app only accepts its configured localhost or LAN address.' });
      if (!isPrivateClient(request.socket.remoteAddress) || Object.keys(request.headers).some(key => key === 'forwarded' || key.startsWith('x-forwarded-'))) return send(403, { error: 'Open this app directly on your home network. Public proxy access is disabled.' });
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      const pathname = requestUrl.pathname;
      if (request.method === 'POST') {
        if (request.headers.origin !== `http://${request.headers.host}`) return send(403, { error: 'Open this app directly at its localhost or LAN address to submit a request.' });
        if (!['/api/rewrite', '/api/validate', '/api/settings', '/api/connection/test', '/api/assets/describe', '/api/assets/suggest'].includes(pathname)) return send(404, { error: 'Not found.' });
        const raw = await readJson(request, pathname === '/api/assets/describe' ? 36 * 1024 * 1024 : 160000);
        if (pathname === '/api/settings' || pathname === '/api/connection/test') {
          if (busy || configuring) return send(409, { error: 'Wait for the current request to finish before changing or testing the AI connection.' });
          const action = pathname === '/api/settings' ? 'configure' : 'test';
          if (typeof provider[action] !== 'function') return send(503, { error: 'Connection settings are unavailable in this server instance.' });
          configuring = true;
          try {
            const result = await provider[action](raw);
            if (action === 'configure') {
              cachedStatus = result.provider; cachedFingerprint = connectionFingerprint(provider.settings); checkedAt = Date.now();
              return send(200, { ...result, connectionFingerprint: cachedFingerprint });
            }
            return send(200, result);
          } catch (error) { return send(400, { error: error.message }); }
          finally { configuring = false; }
        }
        if (pathname.startsWith('/api/assets/')) {
          if (busy || configuring) return send(409, { error: 'Wait for the current rewrite or asset description to finish.' });
          const expected = connectionFingerprint(provider.settings);
          if (expected && raw?.connectionFingerprint !== expected) return send(409, { code: 'connection_changed', error: 'The AI connection changed. Review the refreshed connection before trying again. No model request was sent.' });
          busy = true;
          try { return send(200, await (pathname.endsWith('/describe') ? describeMediaAsset : suggestAssetsFromBrief)(raw, provider)); }
          catch (error) { return send(400, { error: error.message }); }
          finally { busy = false; }
        }
        let input;
        try { input = normalizeJob(raw); }
        catch (error) { return send(400, { error: error.message }); }
        if (pathname === '/api/validate') {
          if (typeof raw.text !== 'string' || raw.text.length > 80000) return send(400, { error: 'Output must be text under 80,000 characters.' });
          return send(200, input.outputFormat === 'storyboard' ? validateStoryboard(raw.text, input) : validateOutput(raw.text, input));
        }
        if (busy || configuring) return send(409, { error: 'A rewrite or connection update is already running. Wait for it to finish before submitting another.' });
        const expectedConnection = connectionFingerprint(provider.settings);
        if (expectedConnection && raw.connectionFingerprint !== expectedConnection) {
          return send(409, { code: 'connection_changed', error: 'The AI connection changed on the app server. Review the refreshed connection before submitting again. No model request was sent.' });
        }
        busy = true;
        try { return send(200, await rewrite(input, provider)); }
        catch (error) { return send(502, { error: error.message,
          ...(error.code === 'OLLAMA_OUTPUT_LIMIT' ? { code: error.code, retryable: true } : {}) }); }
        finally { busy = false; }
      }
      if (request.method !== 'GET') return send(405, { error: 'Method not allowed.' });
      if (pathname === '/api/health') return send(200, { app: APP_ID, version: VERSION, pid: process.pid });
      if (pathname === '/api/status') {
        // Keep status and its settings snapshot paired even if another tab saves
        // a connection while this read-only provider check is in flight.
        const settings = provider.settings || null;
        const fingerprint = connectionFingerprint(settings);
        let status = cachedStatus;
        if (!status || cachedFingerprint !== fingerprint || Date.now() - checkedAt > 60000 || requestUrl.searchParams.get('refresh') === '1') {
          status = await provider.status();
          if (connectionFingerprint(provider.settings) === fingerprint) {
            cachedStatus = status; cachedFingerprint = fingerprint; checkedAt = Date.now();
          }
        }
        return send(200, { app: APP_ID, version: VERSION, provider: status, settings, connectionFingerprint: fingerprint, hosting: { label: hostLabel, host: request.headers.host }, sources: SOURCES });
      }
      const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/assets.mjs': ['assets.mjs', 'text/javascript'], '/voices.mjs': ['voices.mjs', 'text/javascript'] };
      if (!files[pathname]) return send(404, { error: 'Not found.' });
      const [file, type] = files[pathname];
      const body = await readFile(['/assets.mjs', '/voices.mjs'].includes(pathname) ? join(ROOT, file) : join(ROOT, 'public', file));
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); response.end(body);
    } catch (error) {
      if (!response.headersSent) send(error.status || 500, { error: error.status ? error.message : 'The local app could not complete this request. Your input is unchanged.' });
      else response.end();
    }
  });
  server.requestTimeout = 330000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.H3_PORT || 17943);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('H3_PORT must be a port between 1024 and 65535.');
  const provider = await createProviderManager();
  const allowedHosts = (process.env.H3_ALLOWED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (allowedHosts.some(value => !/^[a-z0-9.-]+$/i.test(value))) throw new Error('H3_ALLOWED_HOSTS must contain only comma-separated hostnames or IPv4 addresses, without ports.');
  const bindHost = process.env.H3_BIND_HOST || '127.0.0.1';
  if (bindHost !== '127.0.0.1' && allowedHosts.length === 0) throw new Error('LAN hosting requires explicit H3_ALLOWED_HOSTS.');
  const server = makeServer({ provider, allowedHosts, hostLabel: process.env.H3_HOST_LABEL || 'this computer' });
  server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Use the launcher to open the existing app, or set H3_PORT.` : `The local server could not start (${error.code || 'unknown error'}). Try a different H3_PORT.`); process.exitCode = 1; });
  server.listen(port, bindHost, () => console.log(`Prompt Studio v${VERSION} — http://${allowedHosts[0] || '127.0.0.1'}:${port}`));
}
