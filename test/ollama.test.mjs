import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createProvider, DEFAULT_MODEL, normalizeProviderSettings } from '../provider.mjs';

const settings = { kind: 'ollama', baseUrl: 'http://192.168.1.20:11434', model: 'qwen3.5:latest' };
const messages = [{ role: 'system', content: 'Synthetic formatting instruction.' }, { role: 'user', content: 'Synthetic scene.' }];
const completion = { done: true, done_reason: 'stop', model: 'qwen3.5:latest', message: { role: 'assistant', content: 'Synthetic formatted prompt.' }, prompt_eval_count: 100, eval_count: 20, total_duration: 12345, load_duration: 123 };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('provider defaults are local while no-settings legacy factory remains OpenRouter', () => {
  assert.deepEqual(normalizeProviderSettings(), { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.5:latest' });
  assert.deepEqual(createProvider({ env: {} }).settings, { kind: 'openrouter', baseUrl: '', model: DEFAULT_MODEL });
  assert.deepEqual(createProvider({ settings, env: { OPENROUTER_API_KEY: 'unused' } }).settings, settings);
  assert.equal(normalizeProviderSettings({ kind: 'openrouter' }).model, DEFAULT_MODEL);
});

test('only bare private addresses and local hostnames are accepted', () => {
  for (const baseUrl of ['http://127.0.0.1:11434/', 'http://localhost:11434', 'http://OLLAMA:11434', 'https://ollama.local:11434', 'http://node.home.arpa:11434', 'http://10.0.0.2:11434', 'http://172.31.255.254:11434', 'http://192.168.1.20:11434']) assert.ok(normalizeProviderSettings({ baseUrl }).baseUrl);
  for (const baseUrl of ['http://8.8.8.8:11434', 'http://172.32.0.1:11434', 'http://169.254.169.254', 'http://0.0.0.0:11434', 'https://ollama.com', 'https://example.com', 'http://node.local.attacker.com', 'ftp://127.0.0.1', 'http://user:password@127.0.0.1', 'http://127.0.0.1/api', 'http://127.0.0.1?x=1', 'http://127.0.0.1#x', 'http://[::1]:11434', 'http://127.0.0.1\\@example.com', 123, null]) assert.throws(() => normalizeProviderSettings({ baseUrl }), Error, String(baseUrl));
  for (const raw of [null, [], { kind: 'other' }, { model: 'bad model' }, { model: '../bad' }, { model: 'gpt-oss:120b-cloud' }, { model: 'minimax-m2:cloud' }]) assert.throws(() => normalizeProviderSettings(raw), Error);
  for (const baseUrl of ['http://127.0.0.1/../', 'http://127.0.0.1?', 'http://127.0.0.1#']) assert.throws(() => normalizeProviderSettings({ baseUrl }), /no login, path, query, or fragment/);
});

test('status only lists tags, reports installed models, and never loads a model', async () => {
  const calls = [];
  const provider = createProvider({ settings, fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ models: [{ name: 'qwen3.5:latest' }, { name: 'another:latest' }] }); } });
  assert.deepEqual(await provider.status(), { available: true, label: 'Ollama', model: settings.model, baseUrl: settings.baseUrl, models: ['qwen3.5:latest', 'another:latest'] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${settings.baseUrl}/api/tags`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.resolvedAddress, '192.168.1.20');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('status distinguishes missing models, unreachable servers and wrong endpoint responses', async () => {
  for (const fetchImpl of [async () => response({ models: [] }), async () => { throw new Error('private internal failure'); }, async () => response({ notModels: [] }), async () => response({ error: 'private details' }, 500)]) {
    const result = await createProvider({ settings, fetchImpl }).status();
    assert.equal(result.available, false);
    assert.equal(result.label, 'Ollama');
    assert.equal(typeof result.error, 'string');
    assert.ok(!result.error.includes('private internal failure'));
    assert.ok(!result.error.includes('private details'));
  }
});

test('default-tag aliases work and cloud-backed tags never count as local models', async () => {
  const available = createProvider({ settings: { ...settings, model: 'qwen3.5' }, fetchImpl: async () => response({ models: [{ name: 'qwen3.5:latest' }] }) });
  assert.equal((await available.status()).available, true);
  const remote = createProvider({ settings, fetchImpl: async () => response({ models: [{ name: 'qwen3.5:latest', remote_host: 'https://remote.example' }, { name: 'gpt-oss:120b-cloud' }] }) });
  assert.deepEqual((await remote.status()).models, []);
  assert.equal((await remote.status()).available, false);
});

test('completion sends one non-streaming local chat with thinking disabled and explicit limits', async () => {
  const calls = [];
  const provider = createProvider({ settings, fetchImpl: async (url, options) => { calls.push({ url, options }); return response(completion); } });
  const result = await provider.complete(messages);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${settings.baseUrl}/api/chat`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: settings.model, messages, stream: false, think: false, options: { temperature: 0.2, num_ctx: 32768, num_predict: 12288 }, keep_alive: '5m' });
  assert.equal(result.text, completion.message.content);
  assert.equal(result.provider, 'Ollama');
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, total_duration_ns: 12345, load_duration_ns: 123 });
});

test('incomplete, truncated, empty, redirected and failed completions never retry', async () => {
  for (const payload of [{ ...completion, done: false }, { ...completion, done_reason: 'length' }, { ...completion, done_reason: undefined }, { ...completion, message: { content: '' } }]) {
    let calls = 0;
    const provider = createProvider({ settings, fetchImpl: async () => { calls++; return response(payload); } });
    await assert.rejects(provider.complete(messages), /No automatic retry/);
    assert.equal(calls, 1);
  }
  for (const status of [302, 404, 500]) {
    let calls = 0;
    const provider = createProvider({ settings, fetchImpl: async () => { calls++; return response({ error: 'sensitive details' }, status); } });
    await assert.rejects(provider.complete(messages), (error) => !error.message.includes('sensitive details'));
    assert.equal(calls, 1);
  }
});

test('an output-limit failure exposes a stable retryable code without returning partial JSON', async () => {
  let calls = 0;
  const provider = createProvider({ settings, fetchImpl: async () => {
    calls++;
    return response({ ...completion, done_reason: 'length', message: { content: '{"integrated_multimodal_description":"unfinished' } });
  } });
  await assert.rejects(provider.complete(messages, { mode: 't2v' }), (error) => {
    assert.equal(error.code, 'OLLAMA_OUTPUT_LIMIT');
    assert.equal(error.retryable, true);
    assert.match(error.message, /Incomplete text was not returned/);
    assert.ok(!error.message.includes('unfinished'));
    return true;
  });
  assert.equal(calls, 1);
});

test('caller time budgets reach the local transport, are capped, and cancel without retry', async (t) => {
  const timeouts = [];
  const originalTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => { timeouts.push(milliseconds); return originalTimeout(milliseconds); });
  let calls = 0;
  const provider = createProvider({ settings, fetchImpl: async (_url, options) => {
    calls++;
    if (calls > 1) return response(completion);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(response(completion)), 1000);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    });
  } });
  await assert.rejects(provider.complete(messages, { timeoutMs: 20 }), /generation limit/);
  assert.equal(calls, 1, 'a timeout must not retry internally');
  await provider.complete(messages, { timeoutMs: 500000 });
  assert.deepEqual(timeouts, [20, 300000]);
  for (const timeoutMs of [0, -1, 1.5, '1000', NaN, Infinity]) {
    await assert.rejects(provider.complete(messages, { timeoutMs }), /positive whole number/);
  }
  assert.equal(calls, 2, 'invalid budgets must not send a request');
});

test('hostnames are checked each time and no public or mixed result is contacted', async () => {
  let fetches = 0;
  let lookups = 0;
  const provider = createProvider({ settings: { ...settings, baseUrl: 'http://ollama.local:11434' }, lookupImpl: async () => { lookups++; return [{ address: '192.168.1.20', family: 4 }]; }, fetchImpl: async (_url, options) => { fetches++; assert.equal(options.resolvedAddress, '192.168.1.20'); return response({ models: [{ name: settings.model }] }); } });
  assert.equal((await provider.status()).available, true);
  assert.equal((await provider.status()).available, true);
  assert.equal(lookups, 2);
  assert.equal(fetches, 2);
  for (const addresses of [[{ address: '8.8.8.8', family: 4 }], [{ address: '192.168.1.20', family: 4 }, { address: '8.8.8.8', family: 4 }], [{ address: '2001:4860:4860::8888', family: 6 }], []]) {
    const blocked = createProvider({ settings: { ...settings, baseUrl: 'http://ollama.local:11434' }, lookupImpl: async () => addresses, fetchImpl: async () => { assert.fail('Unsafe hostname must not be contacted'); } });
    assert.equal((await blocked.status()).available, false);
    await assert.rejects(blocked.complete(messages), /private|IPv4/);
  }
});

test('oversized context is rejected without truncation or a request', async () => {
  let calls = 0;
  const provider = createProvider({ settings, fetchImpl: async () => { calls++; return response(completion); } });
  await assert.rejects(provider.complete([{ role: 'user', content: 'x'.repeat(100000) }]), /Nothing was truncated/);
  await assert.rejects(provider.complete([{ role: 'user', content: '猫'.repeat(20000) }]), /Nothing was truncated/);
  await assert.rejects(provider.complete([{ role: 'user', content: null }]), /text messages/);
  assert.equal(calls, 0);
});

test('native local transport pins resolved IPv4 and refuses redirects', async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, host: req.headers.host });
    if (req.url === '/api/chat') { res.writeHead(302, { Location: 'http://8.8.8.8/' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: settings.model }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const port = server.address().port;
  const provider = createProvider({ settings: { ...settings, baseUrl: `http://synthetic.local:${port}` }, lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }] });
  assert.equal((await provider.status()).available, true);
  await assert.rejects(provider.complete(messages), /no automatic retry/i);
  assert.deepEqual(requests, [{ url: '/api/tags', host: `synthetic.local:${port}` }, { url: '/api/chat', host: `synthetic.local:${port}` }]);
});

const baseSections = {
  integrated_multimodal_description: '[Shot 1] Claymation, a fox opens a green door.',
  overall_soundscape: 'The door hinge creaks.',
  non_diegetic_music: 'N/A',
};
const referenceSections = {
  subject_definitions: '<Subject 1> is the courier identity in <Picture 1>.\n<Subject 2> is the Art Deco environment in <Picture 2>.',
  summary: '[reference generation] <Subject 1> walks through <Subject 2>.',
  retention_analysis: '<Subject 1> (appears in [Shot 1]): fully_preserved - identity is retained.\n<Subject 2> (appears in [Shot 1]): fully_preserved - the environment is retained.',
  detailed_description: 'The video uses a cinematic live-action style.\n[Shot 1] <Subject 1>, the referenced courier, walks through <Subject 2>, the Art Deco environment.',
  overall_soundscape: 'Footsteps echo softly in the hall.',
  non_diegetic_music: 'N/A',
};

test('every explicit base mode requests an exact three-field schema and returns ordered plain text', async () => {
  for (const mode of ['t2v', 'i2v', 'fl2v', 'l2v']) {
    let request;
    const provider = createProvider({ settings, fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      // Deliberately return keys in reverse order; serialization owns the final order.
      return response({ ...completion, message: { content: JSON.stringify(Object.fromEntries(Object.entries(baseSections).reverse())) } });
    } });
    const result = await provider.complete(messages, { mode });
    assert.equal(request.think, false);
    assert.equal(request.format.type, 'object');
    assert.equal(request.format.additionalProperties, false);
    assert.deepEqual(request.format.required, Object.keys(baseSections));
    assert.deepEqual(Object.keys(request.format.properties), Object.keys(baseSections));
    for (const property of Object.values(request.format.properties)) {
      assert.equal(property.type, 'string');
      assert.equal(property.minLength, 1);
      assert.ok(property.description.length > 30);
    }
    assert.match(request.messages[0].content, new RegExp(`selected H3 mode: ${mode}`));
    assert.match(request.messages[0].content, /Do not include a base keyframe alignment line/);
    assert.equal(result.text, Object.entries(baseSections).map(([key, value]) => `${key}:\n${value}`).join('\n\n'));
    assert.equal(messages[0].content, 'Synthetic formatting instruction.', 'caller messages must not be mutated');
  }
});

test('full-reference schema forces six separate fields and keeps two references from becoming boundary frames', async () => {
  const requests = [];
  const provider = createProvider({ settings, fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response({ ...completion, message: { content: JSON.stringify(referenceSections) } });
  } });
  const result = await provider.complete(messages, { mode: 'reference' });
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.think, false);
  assert.deepEqual(request.format.required, Object.keys(referenceSections));
  assert.deepEqual(Object.keys(request.format.properties), Object.keys(referenceSections));
  assert.equal(request.format.additionalProperties, false);
  assert.ok(!Object.hasOwn(request.format.properties, 'integrated_multimodal_description'));
  assert.match(request.format.properties.subject_definitions.description, /identity from Picture 1 and an environment from Picture 2/);
  assert.match(request.format.properties.detailed_description.description, /BEFORE \[Shot 1\]/);
  assert.match(request.messages[0].content, /Picture 1 and Picture 2 does NOT mean opening and ending frames/);
  assert.match(request.messages[0].content, /FULL-REFERENCE MODE, NOT FL2VA/);
  assert.match(result.text, /^subject_definitions:\n<Subject 1>/);
  assert.match(result.text, /\ndetailed_description:\nThe video uses a cinematic live-action style\.\n\[Shot 1\]/);
  assert.ok(!result.text.includes('integrated_multimodal_description'));
});

test('structured responses reject invalid JSON, wrong schemas, empty values and types without retry', async () => {
  const missing = { ...referenceSections };
  delete missing.subject_definitions;
  const invalid = ['not JSON', '```json\n' + JSON.stringify(referenceSections) + '\n```', 'null', '[]',
    JSON.stringify(baseSections), JSON.stringify(missing), JSON.stringify({ ...referenceSections, extra: 'not allowed' }),
    JSON.stringify({ ...referenceSections, subject_definitions: [] }), JSON.stringify({ ...referenceSections, summary: null }),
    JSON.stringify({ ...referenceSections, detailed_description: '   ' })];
  for (const content of invalid) {
    let calls = 0;
    const provider = createProvider({ settings, fetchImpl: async () => { calls++; return response({ ...completion, message: { content } }); } });
    await assert.rejects(provider.complete(messages, { mode: 'reference' }), /No automatic retry/);
    assert.equal(calls, 1);
  }
});

test('the transport instruction is included in the context budget and invalid modes never send requests', async () => {
  let calls = 0;
  const provider = createProvider({ settings, fetchImpl: async () => { calls++; return response(completion); } });
  const nearLimit = [{ role: 'system', content: 'x'.repeat(79500) }];
  await assert.rejects(provider.complete(nearLimit, { mode: 'reference' }), /Nothing was truncated/);
  await assert.rejects(provider.complete(messages, { mode: 'invalid' }), /valid H3 mode/);
  assert.equal(calls, 0);
});

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sQAAAABJRU5ErkJggg==';
const assetReply = { assets: [{ type: 'picture', description: 'A small ceramic fox on a mossy stone.' }], warnings: [] };
const visionMessages = [{ role: 'system', content: 'Describe the supplied asset.' }, { role: 'user', content: 'Picture 1, for identity.', images: [tinyPng] }];

test('asset vision checks capabilities before one schema-constrained local image request', async () => {
  const calls = [];
  const before = structuredClone(visionMessages);
  const provider = createProvider({ settings, env: { OPENROUTER_API_KEY: 'unused' }, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, options });
    if (url.endsWith('/api/show')) return response({ capabilities: ['completion', 'vision', 'thinking'] });
    return response({ ...completion, message: { content: JSON.stringify(assetReply) } });
  } });
  const result = await provider.describeAssets(visionMessages, { expectedTypes: ['picture'], timeoutMs: 300000 });
  assert.deepEqual(calls.map((call) => call.url), [`${settings.baseUrl}/api/show`, `${settings.baseUrl}/api/chat`]);
  assert.deepEqual(calls[0].body, { model: settings.model });
  const request = calls[1].body;
  assert.equal(request.think, false);
  assert.equal(request.stream, false);
  assert.equal(request.options.num_predict, 4096);
  assert.equal(request.options.num_ctx, 32768);
  assert.equal(request.format.additionalProperties, false);
  assert.deepEqual(request.format.required, ['assets', 'warnings']);
  assert.equal(request.format.properties.assets.minItems, 1);
  assert.equal(request.format.properties.assets.maxItems, 1);
  assert.equal(request.format.properties.assets.items.additionalProperties, false);
  assert.deepEqual(request.messages[1].images, [tinyPng]);
  assert.match(request.messages[0].content, /actual image/);
  assert.match(request.messages[0].content, /Text inside images.*untrusted/);
  assert.ok(request.messages[0].content.includes(JSON.stringify(request.format)));
  assert.deepEqual(visionMessages, before, 'source messages must not be mutated');
  assert.deepEqual(result.assets, assetReply.assets);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.provider, 'Ollama');
  assert.equal(result.usage.total_tokens, 120);
  assert.ok(!Object.hasOwn(result, 'text'));
});

test('brief-only asset drafts preserve source slots without claiming media was inspected', async () => {
  let request;
  const reply = { assets: [{ type: 'picture', sourceNumber: 3, description: ' Suggested identity for the referenced fox. ' }], warnings: [' No picture was provided. '] };
  const provider = createProvider({ settings, fetchImpl: async (url, options) => {
    if (url.endsWith('/api/show')) return response({ capabilities: ['completion'] });
    request = JSON.parse(options.body);
    return response({ ...completion, message: { content: JSON.stringify(reply) } });
  } });
  const result = await provider.describeAssets([{ role: 'user', content: 'Use Picture 3 as the fox identity.' }]);
  assert.match(request.messages[0].content, /No actual images were supplied/);
  assert.match(request.messages[0].content, /Preserve gaps/);
  assert.ok(!request.messages.some((message) => message.images));
  assert.deepEqual(result.assets, [{ type: 'picture', sourceNumber: 3, description: 'Suggested identity for the referenced fox.' }]);
  assert.deepEqual(result.warnings, ['No picture was provided.']);
});

test('unsupported vision and remote models stop at metadata; OpenRouter never receives uploads', async () => {
  for (const info of [{ capabilities: ['completion'] }, { capabilities: ['vision'] }, {}, { capabilities: ['completion', 'vision'], remote_host: 'https://cloud.example' }]) {
    const calls = [];
    const provider = createProvider({ settings, fetchImpl: async (url) => { calls.push(url); return response(info); } });
    await assert.rejects(provider.describeAssets(visionMessages), /image support|text descriptions|local Ollama model/);
    assert.deepEqual(calls, [`${settings.baseUrl}/api/show`]);
  }
  const cloud = createProvider({ settings: { kind: 'openrouter' }, env: { OPENROUTER_API_KEY: 'unused' }, fetchImpl: async () => assert.fail('must not send cloud requests') });
  await assert.rejects(cloud.describeAssets(visionMessages), /no cloud request was sent/);
});

test('bad, oversized or misplaced asset images and oversized text never make requests', async () => {
  let calls = 0;
  const provider = createProvider({ settings, fetchImpl: async () => { calls++; return response({}); } });
  const badMessages = [
    [], [{ role: 'user', content: null }], [{ role: 'system', content: '', images: [tinyPng] }],
    [{ role: 'user', content: '', images: tinyPng }],
    ...['', `data:image/png;base64,${tinyPng}`, 'not base64!', 'abc', 'A'.repeat(13981020)].map((data) => [{ role: 'user', content: '', images: [data] }]),
    [{ role: 'user', content: '', images: [tinyPng, tinyPng, tinyPng, tinyPng] }],
    [{ role: 'user', content: 'x'.repeat(100000), images: [tinyPng] }],
  ];
  for (const invalid of badMessages) await assert.rejects(provider.describeAssets(invalid), Error);
  for (const expectedTypes of ['picture', ['other'], Array(25).fill('picture')]) await assert.rejects(provider.describeAssets(messages, { expectedTypes }), /Expected asset types/);
  assert.equal(calls, 0);
});

test('asset replies reject truncation, malformed schemas, wrong types, duplicate slots and excessive descriptions', async () => {
  const invalid = [null, [], {}, { ...assetReply, extra: true }, { assets: [], warnings: [] },
    { assets: [{ type: 'video', description: 'Wrong type.' }], warnings: [] },
    { assets: [{ type: 'picture', description: '' }], warnings: [] },
    { assets: [{ type: 'picture', description: 'x'.repeat(6001) }], warnings: [] },
    { assets: [{ type: 'picture', description: 'x', extra: 'unknown' }], warnings: [] },
    { assets: [{ type: 'picture', description: 'x', sourceNumber: 0 }], warnings: [] },
    { assets: [{ type: 'picture', description: 'x', sourceNumber: 1.5 }], warnings: [] },
    { assets: [{ type: 'picture', description: 'x', sourceNumber: 25 }], warnings: [] },
    { ...assetReply, warnings: [null] }, { ...assetReply, warnings: [''] }, { ...assetReply, warnings: Array(13).fill('warning') }];
  for (const reply of invalid) {
    let generations = 0;
    const provider = createProvider({ settings, fetchImpl: async (url) => {
      if (url.endsWith('/api/show')) return response({ capabilities: ['completion', 'vision'] });
      generations++;
      return response({ ...completion, message: { content: JSON.stringify(reply) } });
    } });
    await assert.rejects(provider.describeAssets(visionMessages, { expectedTypes: ['picture'] }), /No draft was applied/);
    assert.equal(generations, 1);
  }
  for (const assets of [Array(2).fill({ type: 'picture', sourceNumber: 1, description: 'Same slot.' }), Array(3).fill({ type: 'picture', description: 'x'.repeat(4500) })]) {
    const provider = createProvider({ settings, fetchImpl: async (url) => response(url.endsWith('/api/show') ? { capabilities: ['completion'] } : { ...completion, message: { content: JSON.stringify({ assets, warnings: [] }) } }) });
    await assert.rejects(provider.describeAssets(messages), /duplicate source slots|12000 characters/);
  }
  const truncated = createProvider({ settings, fetchImpl: async (url) => response(url.endsWith('/api/show') ? { capabilities: ['completion'] } : { ...completion, done_reason: 'length', message: { content: '{"assets":[' } }) });
  await assert.rejects(truncated.describeAssets(messages), (error) => error.code === 'OLLAMA_OUTPUT_LIMIT');
});

test('image decoding failures return useful errors without leaking raw server details or retrying', async () => {
  let generations = 0;
  const provider = createProvider({ settings, fetchImpl: async (url) => {
    if (url.endsWith('/api/show')) return response({ capabilities: ['completion', 'vision'] });
    generations++;
    return response({ error: 'image decode failed: sensitive filesystem details' }, 400);
  } });
  await assert.rejects(provider.describeAssets(visionMessages), (error) => /could not read these pictures/.test(error.message) && !error.message.includes('sensitive'));
  assert.equal(generations, 1);
});

test('asset metadata and generation share the caller deadline', async (t) => {
  const timeouts = [];
  const originalTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => { timeouts.push(milliseconds); return originalTimeout(milliseconds); });
  const provider = createProvider({ settings, fetchImpl: async (url) => {
    if (url.endsWith('/api/show')) { await new Promise((resolve) => setTimeout(resolve, 15)); return response({ capabilities: ['completion'] }); }
    return response({ ...completion, message: { content: JSON.stringify(assetReply) } });
  } });
  await provider.describeAssets(messages, { timeoutMs: 1000 });
  assert.equal(timeouts.length, 2);
  assert.ok(timeouts[0] <= 1000 && timeouts[0] > 900);
  assert.ok(timeouts[1] <= 985 && timeouts[1] > 0);
});
