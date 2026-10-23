import { readFile, writeFile, access } from 'node:fs/promises';
import { rewrite } from './server.mjs';
import { createProviderManager } from './settings.mjs';

// A JSON job is optional; a plain text file uses the same defaults as the app.
const [inputFile, outputFile] = process.argv.slice(2);
if (!inputFile || ['-h', '--help'].includes(inputFile)) {
  console.log('Usage: node cli.mjs brief.txt [prompt-output.txt]\n       node cli.mjs job.json [prompt-output.txt]\n\nJSON fields: prompt, mode (t2v/i2v/fl2v/l2v/reference), duration, referenceNotes or assets,\ncreativity (faithful/enrich), audio (natural/silent), music (auto/none), exactText,\ntiming (cued/natural), outputFormat (h3/storyboard),\nstoryboard: { secondsPerChunk: 10, chunkCount: 4 }.\nUses the saved AI connection (Ollama by default). No video is generated.');
} else {
  try {
    const content = await readFile(inputFile, 'utf8');
    const input = inputFile.toLowerCase().endsWith('.json') ? JSON.parse(content.replace(/^\uFEFF/, '')) : { prompt: content };
    if (outputFile) {
      let exists = false;
      try { await access(outputFile); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (exists) throw new Error('That output file already exists. Choose a new filename; no rewrite was submitted.');
    }
    const result = await rewrite(input, await createProviderManager());
    if (outputFile) await writeFile(outputFile, result.text + '\n', { encoding: 'utf8', flag: 'wx' });
    else process.stdout.write(result.text + '\n');
    if (result.storyboardReport) console.error(result.storyboardReport);
    for (const error of result.validation.errors) console.error(`CHECK: ${error}`);
    for (const warning of result.validation.warnings) console.error(`NOTE: ${warning}`);
    if (result.validation.errors.length) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
