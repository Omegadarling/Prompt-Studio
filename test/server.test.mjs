import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeServer, APP_ID, VERSION, isPrivateClient } from '../server.mjs';
import { createProvider } from '../provider.mjs';
import { createProviderManager } from '../settings.mjs';

const input = { prompt: 'A claymation fox opens a green door.' };
const formatted = 'integrated_multimodal_description: [Shot 1] Claymation, a small fox opens a green door. The camera holds a static shot.\n\noverall_soundscape: The hinge creaks as the door opens.\n\nnon_diegetic_music: N/A';

function fakeProvider(overrides = {}) {
  const calls = { status: 0, complete: [] };
  return {
    calls,
    async status() { calls.status++; return { available: true, label: 'Synthetic test provider', model: 'synthetic/test' }; },
    async complete(messages) {
      calls.complete.push(messages);
      return { text: formatted, model: 'synthetic/test', usage: { total_tokens: 42 } };
    },
    ...overrides,
  };
}

async function start(t, provider = fakeProvider()) {
  const server = makeServer({ provider });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  const { port } = server.address();
  const host = `127.0.0.1:${port}`;
  function request(path = '/api/health', { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method, agent: false,
        headers: { Host: host, ...(method === 'POST' ? { Origin: `http://${host}`, 'Content-Type': 'application/json' } : {}), ...headers },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data;
          try { data = JSON.parse(text); } catch { data = text; }
          resolve({ status: response.statusCode, headers: response.headers, data });
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('Synthetic local HTTP test timed out.')));
      req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
    });
  }
  return { server, provider, request, host, port };
}

test('server starts on ephemeral loopback and health does not contact a provider', async (t) => {
  const { server, provider, request } = await start(t);
  assert.equal(server.address().address, '127.0.0.1');
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { app: APP_ID, version: VERSION, pid: process.pid });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(response.headers['content-security-policy'], /media-src 'self' blob:/);
  assert.match(response.headers['content-security-policy'], /img-src 'self' data: blob:/);
  assert.equal(provider.calls.status, 0);
  assert.equal(provider.calls.complete.length, 0);
});

test('LAN deployment blocks forwarded requests and distinguishes private clients', async (t) => {
  const { request, provider } = await start(t);
  assert.equal((await request('/api/status', { headers: { 'X-Forwarded-For': '192.168.1.20' } })).status, 403);
  assert.equal(provider.calls.status, 0);
  for (const ip of ['192.168.1.9', '10.0.0.2', '172.16.2.3', '127.0.0.1', '::ffff:192.168.1.2', '::1']) assert.equal(isPrivateClient(ip), true);
  for (const ip of ['8.8.8.8', '172.32.0.1', '192.168.999.1', '0.0.0.0', 'garbage']) assert.equal(isPrivateClient(ip), false);
});

test('settings routes check origin, save only explicitly, and never request completion', async (t) => {
  let saves = 0, tests = 0;
  const config = { kind: 'ollama', baseUrl: 'http://192.168.1.20:11434', model: 'qwen3.5:latest' };
  const provider = fakeProvider({
    settings: config,
    async configure(raw) { saves++; return { settings: raw, provider: await this.status() }; },
    async test(raw) { tests++; return { settings: raw, provider: await this.status() }; }
  });
  const { request } = await start(t, provider);
  assert.equal((await request('/api/settings', { method: 'POST', headers: { Origin: 'http://elsewhere' }, body: config })).status, 403);
  assert.equal(saves, 0);
  assert.equal((await request('/api/connection/test', { method: 'POST', body: config })).status, 200);
  assert.equal(tests, 1); assert.equal(saves, 0);
  assert.equal((await request('/api/settings', { method: 'POST', body: config })).status, 200);
  assert.equal(saves, 1); assert.equal(provider.calls.complete.length, 0);
  assert.deepEqual((await request('/api/status')).data.settings, config);
});

test('shared manager rejects missing or stale connection fingerprints before any provider work', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'h3-shared-connection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = { status: 0, complete: [] };
  const manager = await createProviderManager({ env: {}, path: join(directory, 'settings.json'),
    providerFactory: ({ settings }) => ({
      model: settings.model,
      async status() { calls.status++; return { available: true, label: settings.kind, model: settings.model }; },
      async complete() { calls.complete.push(settings); return { text: formatted, provider: settings.kind, model: settings.model }; },
    }),
  });
  const { request } = await start(t, manager);
  const oldTab = (await request('/api/status')).data;
  assert.equal(oldTab.settings.kind, 'ollama');
  assert.match(oldTab.connectionFingerprint, /^[a-f0-9]{64}$/);
  const changed = await request('/api/settings', { method: 'POST', body: { kind: 'openrouter', model: 'synthetic/cloud' } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.data.connectionFingerprint, oldTab.connectionFingerprint);
  const statusCalls = calls.status;
  for (const connectionFingerprint of [undefined, oldTab.connectionFingerprint]) {
    const stale = await request('/api/rewrite', { method: 'POST', body: { ...input, connectionFingerprint } });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, 'connection_changed');
    assert.match(stale.data.error, /No model request was sent/);
  }
  assert.deepEqual(calls.complete, []);
  assert.equal(calls.status, statusCalls, 'a rejected rewrite does not even contact provider status');
  const reviewed = await request('/api/rewrite', { method: 'POST', body: { ...input, connectionFingerprint: changed.data.connectionFingerprint } });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.provider, 'openrouter');
  assert.equal(calls.complete.length, 1);
});

test('a delayed old status remains paired with old settings and cannot overwrite the new cache', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'h3-status-snapshot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let releaseOld;
  let enteredOld;
  let oldCheck = true;
  let statusCalls = 0;
  const started = new Promise((resolve) => { enteredOld = resolve; });
  const delayed = new Promise((resolve) => { releaseOld = resolve; });
  const manager = await createProviderManager({ env: {}, path: join(directory, 'settings.json'),
    providerFactory: ({ settings }) => ({
      model: settings.model,
      async status() {
        statusCalls++;
        if (oldCheck) { oldCheck = false; enteredOld(); await delayed; }
        return { available: true, label: settings.kind, model: settings.model };
      },
      async complete() { assert.fail('Status race must not generate anything.'); },
    }),
  });
  const { request } = await start(t, manager);
  t.after(() => releaseOld());
  const pending = request('/api/status?refresh=1');
  await started;
  const changed = await request('/api/settings', { method: 'POST', body: { kind: 'ollama', baseUrl: 'http://192.168.1.20:11434', model: 'synthetic-new' } });
  assert.equal(changed.status, 200);
  releaseOld();
  const oldResponse = (await pending).data;
  assert.equal(oldResponse.settings.model, 'qwen3.5:latest');
  assert.equal(oldResponse.provider.model, 'qwen3.5:latest');
  assert.notEqual(oldResponse.connectionFingerprint, changed.data.connectionFingerprint);
  const current = (await request('/api/status')).data;
  assert.equal(current.settings.model, 'synthetic-new');
  assert.equal(current.provider.model, 'synthetic-new');
  assert.equal(current.connectionFingerprint, changed.data.connectionFingerprint);
  assert.equal(statusCalls, 2, 'the completed old request did not invalidate the new status cache');
});

test('Host allowlist rejects foreign hosts before reading health or contacting a provider', async (t) => {
  const { request, provider, port } = await start(t);
  for (const host of [`attacker.example:${port}`, '127.0.0.1', `127.0.0.1.attacker.example:${port}`]) {
    const response = await request('/api/status', { headers: { Host: host } });
    assert.equal(response.status, 403, host);
  }
  assert.equal((await request('/api/health', { headers: { Host: `localhost:${port}` } })).status, 200);
  assert.equal(provider.calls.status, 0);
  assert.equal(provider.calls.complete.length, 0);
});

test('cross-origin and missing-origin POSTs are rejected before paid provider use', async (t) => {
  const { request, provider } = await start(t);
  for (const origin of ['https://attacker.example', 'null', '']) {
    const response = await request('/api/rewrite', { method: 'POST', headers: { Origin: origin }, body: input });
    assert.equal(response.status, 403, origin);
  }
  assert.equal(provider.calls.complete.length, 0);
});

test('POST content-type, JSON, and input validation failures never call the provider', async (t) => {
  const { request, provider } = await start(t);
  assert.equal((await request('/api/rewrite', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: input })).status, 415);
  assert.equal((await request('/api/rewrite', { method: 'POST', body: '{broken' })).status, 400);
  for (const body of [{}, null, [], { prompt: ' ' }, { ...input, duration: -1 }, { ...input, mode: 'reference' }]) {
    const response = await request('/api/rewrite', { method: 'POST', body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof response.data.error, 'string');
  }
  assert.equal(provider.calls.complete.length, 0);
});

test('local validation reports guide errors without consuming provider usage', async (t) => {
  const { request, provider } = await start(t);
  const good = await request('/api/validate', { method: 'POST', body: { ...input, text: formatted } });
  assert.equal(good.status, 200);
  assert.deepEqual(good.data.errors, []);
  assert.ok(good.data.warnings.length);
  const bad = await request('/api/validate', { method: 'POST', body: { ...input, text: 'A fox.' } });
  assert.equal(bad.status, 200);
  assert.ok(bad.data.errors.length);
  assert.equal((await request('/api/validate', { method: 'POST', body: { ...input, text: 42 } })).status, 400);
  assert.equal(provider.calls.complete.length, 0);
  assert.equal(provider.calls.status, 0);
});

test('one rewrite returns the formatted result, metadata and independent validation', async (t) => {
  const { request, provider } = await start(t);
  const response = await request('/api/rewrite', { method: 'POST', body: input });
  assert.equal(response.status, 200);
  assert.equal(response.data.text, formatted);
  assert.equal(response.data.model, 'synthetic/test');
  assert.deepEqual(response.data.validation.errors, []);
  assert.deepEqual(response.data.usage, { total_tokens: 42 });
  assert.equal(provider.calls.complete.length, 1);
  assert.deepEqual(provider.calls.complete[0].map((message) => message.role), ['system', 'user']);
  assert.equal(JSON.parse(provider.calls.complete[0][1].content).prompt, input.prompt);
});

test('a running rewrite rejects concurrent paid work but permits local validation', async (t) => {
  let release;
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  let paidCalls = 0;
  const provider = fakeProvider({ async complete() { paidCalls++; began(); return pending; } });
  const { request } = await start(t, provider);
  t.after(() => release({ text: formatted }));
  const first = request('/api/rewrite', { method: 'POST', body: input });
  await started;
  const second = await request('/api/rewrite', { method: 'POST', body: input });
  assert.equal(second.status, 409);
  assert.equal(paidCalls, 1);
  const validation = await request('/api/validate', { method: 'POST', body: { ...input, text: formatted } });
  assert.equal(validation.status, 200);
  release({ text: formatted, model: 'synthetic/test' });
  assert.equal((await first).status, 200);
  assert.equal((await request('/api/rewrite', { method: 'POST', body: input })).status, 200);
  assert.equal(paidCalls, 2, 'busy state is cleared after completion');
});

test('provider failure is readable, has no automatic retry and releases the busy state', async (t) => {
  let calls = 0;
  const provider = fakeProvider({ async complete() { calls++; if (calls === 1) throw new Error('Synthetic provider unavailable.'); return { text: formatted }; } });
  const { request } = await start(t, provider);
  const response = await request('/api/rewrite', { method: 'POST', body: input });
  assert.equal(response.status, 502);
  assert.equal(response.data.error, 'Synthetic provider unavailable.');
  assert.equal(calls, 1);
  assert.equal((await request('/api/rewrite', { method: 'POST', body: input })).status, 200);
  assert.equal(calls, 2);
});

test('shared asset module is served as JavaScript and structured cards reach the provider once', async (t) => {
  const { request, provider } = await start(t);
  const module = await request('/assets.mjs');
  assert.equal(module.status, 200);
  assert.match(module.headers['content-type'], /text\/javascript/);
  assert.match(module.data, /export function numberAssets/);
  const response = await request('/api/rewrite', { method: 'POST', body: { ...input, mode: 'i2v', assets: [{ id: 'opening', type: 'picture', description: 'Clay fox before the closed door.' }] } });
  assert.equal(response.status, 200);
  const payload = JSON.parse(provider.calls.complete[0][1].content);
  assert.equal(payload.referenceNotes, 'Picture 1 — Clay fox before the closed door.');
  assert.equal(payload.assets, undefined);
  assert.equal(provider.calls.complete.length, 1);
});

test('output-limit failures preserve the specific code without exposing partial text or retrying', async (t) => {
  let calls = 0;
  const { request } = await start(t, fakeProvider({ async complete() { calls++; throw Object.assign(new Error('Reply limit reached.'), { code: 'OLLAMA_OUTPUT_LIMIT', retryable: true, partial: 'unfinished' }); } }));
  const response = await request('/api/rewrite', { method: 'POST', body: input });
  assert.equal(response.status, 502);
  assert.deepEqual(response.data, { error: 'Reply limit reached.', code: 'OLLAMA_OUTPUT_LIMIT', retryable: true });
  assert.equal(calls, 1);
});

test('asset suggestions use the saved connection, preserve numbered slots and share the inference lock', async (t) => {
  let finish, began;
  const started = new Promise(resolve => { began = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  let assetCalls = 0;
  const config = { kind: 'ollama', baseUrl: 'http://192.168.1.20:11434', model: 'synthetic' };
  const { request, provider } = await start(t, fakeProvider({ settings: config, async describeAssets() { assetCalls++; began(); return pending; } }));
  t.after(() => finish({ assets: [], warnings: [] }));
  const { connectionFingerprint } = (await request('/api/status')).data;
  assert.equal((await request('/api/assets/suggest', { method: 'POST', body: input })).data.code, 'connection_changed');
  assert.equal(assetCalls, 0);
  const first = request('/api/assets/suggest', { method: 'POST', body: { ...input, mode: 'reference', connectionFingerprint } });
  await started;
  assert.equal((await request('/api/rewrite', { method: 'POST', body: { ...input, connectionFingerprint } })).status, 409);
  assert.equal(provider.calls.complete.length, 0);
  finish({ assets: [{ type: 'picture', sourceNumber: 2, description: 'The door.' }], warnings: [] });
  const response = await first;
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.assets.map(a => a.description), ['', 'Suggested asset: The door.']);
  assert.equal(assetCalls, 1);
});

test('media routes reject wrong origin and file paths without model inference', async (t) => {
  let assetCalls = 0;
  const { request } = await start(t, fakeProvider({ async describeAssets() { assetCalls++; } }));
  assert.equal((await request('/api/assets/describe', { method: 'POST', headers: { Origin: 'https://outside.invalid' }, body: {} })).status, 403);
  const bad = await request('/api/assets/describe', { method: 'POST', body: { asset: { type: 'picture', path: 'C:/private.png' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /file paths/i);
  assert.equal(assetCalls, 0);
});

test('provider status is cached and does not submit a completion', async (t) => {
  const { request, provider } = await start(t);
  for (let i = 0; i < 2; i++) {
    const response = await request('/api/status');
    assert.equal(response.status, 200);
    assert.equal(response.data.provider.available, true);
    assert.equal(response.data.sources.length, 2);
  }
  assert.equal(provider.calls.status, 1);
  assert.equal(provider.calls.complete.length, 0);
});

const messages = [{ role: 'system', content: 'Synthetic formatting instruction.' }, { role: 'user', content: 'Synthetic scene.' }];
const dummyEnv = { OPENROUTER_API_KEY: 'synthetic-test-key-do-not-use', H3_REWRITE_MODEL: 'synthetic/test' };
function fakeResponse(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }); }

test('direct provider sends exactly one bounded request and returns complete text', async () => {
  const requests = [];
  const provider = createProvider({ env: dummyEnv, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return fakeResponse({ choices: [{ finish_reason: 'stop', message: { content: formatted } }], model: 'synthetic/test', usage: { total_tokens: 42 } });
  } });
  const result = await provider.complete(messages);
  assert.equal(result.text, formatted);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(requests[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(requests[0].options.body).messages, messages);
  assert.ok(requests[0].options.signal instanceof AbortSignal);
});

test('truncated, missing and refused completions never become successful results or retry', async () => {
  for (const finish_reason of ['length', 'content_filter', 'tool_calls', undefined]) {
    let calls = 0;
    const provider = createProvider({ env: dummyEnv, fetchImpl: async () => { calls++; return fakeResponse({ choices: [{ finish_reason, message: { content: formatted } }] }); } });
    await assert.rejects(provider.complete(messages), /did not return a complete rewrite/);
    assert.equal(calls, 1);
  }
  const empty = createProvider({ env: dummyEnv, fetchImpl: async () => fakeResponse({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }) });
  await assert.rejects(empty.complete(messages), /no prompt text/);
});

test('direct provider errors are sanitized and ambiguous network failure never retries', async () => {
  for (const failure of ['network', 'http', 'invalid-json']) {
    let calls = 0;
    const provider = createProvider({ env: dummyEnv, fetchImpl: async () => {
      calls++;
      if (failure === 'network') throw new Error(`Do not leak ${dummyEnv.OPENROUTER_API_KEY}`);
      if (failure === 'invalid-json') return new Response('not json', { status: 200 });
      return fakeResponse({ error: { message: `Do not leak ${dummyEnv.OPENROUTER_API_KEY}` } }, 401);
    } });
    await assert.rejects(provider.complete(messages), (error) => {
      assert.ok(!error.message.includes(dummyEnv.OPENROUTER_API_KEY));
      assert.match(error.message, failure === 'network' ? /may still incur usage/ : /could not complete/);
      return true;
    });
    assert.equal(calls, 1, failure);
  }
});

test('direct provider status checks authentication only and reports configuration failures', async () => {
  const requests = [];
  const provider = createProvider({ env: dummyEnv, fetchImpl: async (url, options) => { requests.push({ url, method: options.method }); return fakeResponse({ data: {} }); } });
  assert.equal((await provider.status()).available, true);
  assert.deepEqual(requests, [{ url: 'https://openrouter.ai/api/v1/key', method: 'GET' }]);
  const unavailable = createProvider({ env: dummyEnv, fetchImpl: async () => fakeResponse({ error: {} }, 401) });
  assert.equal((await unavailable.status()).available, false);
});
