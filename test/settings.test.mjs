import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProviderManager, connectionFingerprint } from '../settings.mjs';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'h3-settings-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let completions = 0;
  const providerFactory = ({ settings }) => ({
    model: settings.model,
    async status() { return { available: true, label: settings.kind, model: settings.model }; },
    async complete() { completions++; return { text: 'fixture' }; }
  });
  return { path: join(dir, 'settings.json'), env: {}, providerFactory, completions: () => completions };
}

test('connection testing has no saved-state or generation side effects', async t => {
  const options = await setup(t);
  const manager = await createProviderManager(options);
  const original = manager.settings;
  await manager.test({ kind: 'ollama', baseUrl: 'http://192.168.1.20:11434', model: 'qwen3.5:latest' });
  assert.deepEqual(manager.settings, original);
  await assert.rejects(readFile(options.path), { code: 'ENOENT' });
  assert.equal(options.completions(), 0);
});

test('saved provider survives restart, overrides defaults, and excludes unrelated data', async t => {
  const options = await setup(t);
  const manager = await createProviderManager(options);
  const desired = { kind: 'ollama', baseUrl: 'http://192.168.1.20:11434', model: 'qwen3.5:latest' };
  await manager.configure({ ...desired, prompt: 'do not store', apiKey: 'do not store' });
  assert.deepEqual(JSON.parse(await readFile(options.path, 'utf8')), desired);
  const restarted = await createProviderManager({ ...options, env: { H3_OLLAMA_URL: 'http://127.0.0.1:11434' } });
  assert.deepEqual(restarted.settings, desired);
  assert.equal(restarted.connectionFingerprint, manager.connectionFingerprint);
  assert.equal(options.completions(), 0);
});

test('connection fingerprints cover normalized provider, destination and model without unrelated data', () => {
  const local = { kind: 'ollama', baseUrl: 'http://192.168.1.20:11434', model: 'qwen3.5:latest' };
  const original = connectionFingerprint(local);
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.equal(connectionFingerprint({ ...local, baseUrl: local.baseUrl + '/', prompt: 'excluded', apiKey: 'excluded' }), original);
  assert.notEqual(connectionFingerprint({ ...local, baseUrl: 'http://192.168.1.21:11434' }), original);
  assert.notEqual(connectionFingerprint({ ...local, model: 'other:latest' }), original);
  assert.notEqual(connectionFingerprint({ kind: 'openrouter', model: 'synthetic/cloud' }), original);
});

test('invalid new settings preserve a valid existing connection', async t => {
  const options = await setup(t);
  const manager = await createProviderManager(options);
  await manager.configure(manager.settings);
  const before = await readFile(options.path, 'utf8');
  await assert.rejects(manager.configure({ kind: 'ollama', baseUrl: 'https://public.example.com', model: 'test' }));
  assert.equal(await readFile(options.path, 'utf8'), before);
});

test('corrupt settings fail visibly and are never silently overwritten', async t => {
  const options = await setup(t);
  await writeFile(options.path, '{corrupt');
  await assert.rejects(createProviderManager(options), /not overwritten/);
  assert.equal(await readFile(options.path, 'utf8'), '{corrupt');
});
