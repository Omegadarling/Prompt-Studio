import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createProvider, normalizeProviderSettings } from './provider.mjs';

/** Non-secret identity for the exact destination/model the browser reviewed. */
export function connectionFingerprint(settings) {
  if (!settings) return null;
  const { kind, baseUrl, model } = normalizeProviderSettings(settings);
  return createHash('sha256').update(JSON.stringify({ kind, baseUrl, model })).digest('hex');
}

/** Persist only provider/address/model. Prompts and API keys never enter this file. */
export async function createProviderManager({ env = process.env, path = env.H3_SETTINGS_PATH || fileURLToPath(new URL('./.runtime/settings.json', import.meta.url)), providerFactory = createProvider } = {}) {
  const defaults = {
    kind: env.H3_PROVIDER || 'ollama',
    baseUrl: env.H3_OLLAMA_URL || 'http://127.0.0.1:11434',
    model: (env.H3_PROVIDER === 'openrouter' ? env.H3_REWRITE_MODEL : env.H3_OLLAMA_MODEL) || (env.H3_PROVIDER === 'openrouter' ? 'google/gemini-2.5-flash' : 'qwen3.5:latest')
  };
  let settings;
  try { settings = normalizeProviderSettings(JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('The saved AI settings could not be read. Restore the settings file or move it aside before restarting; it was not overwritten.');
    settings = normalizeProviderSettings(defaults);
  }
  let current = providerFactory({ env, settings });
  return {
    get settings() { return { ...settings }; },
    get connectionFingerprint() { return connectionFingerprint(settings); },
    get model() { return current.model; },
    status: () => current.status(),
    complete: (messages, context) => current.complete(messages, context),
    describeAssets: (messages, context) => {
      if (typeof current.describeAssets !== 'function') throw new Error('This provider does not support asset descriptions. Choose Ollama.');
      return current.describeAssets(messages, context);
    },
    async test(raw) {
      const candidate = normalizeProviderSettings(raw);
      return { settings: candidate, provider: await providerFactory({ env, settings: candidate }).status() };
    },
    async configure(raw) {
      const candidate = normalizeProviderSettings(raw);
      const next = providerFactory({ env, settings: candidate });
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(candidate, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
      } catch {
        await rm(temporary, { force: true }).catch(() => {});
        throw new Error('Could not save the AI connection. The previous connection is unchanged.');
      }
      settings = candidate; current = next;
      return { settings: { ...settings }, connectionFingerprint: connectionFingerprint(settings), provider: await current.status() };
    }
  };
}
