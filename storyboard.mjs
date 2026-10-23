import { normalizeInput, buildMessages, validateOutput } from './prompting.mjs';
import { checkCharacterVoices } from './voices.mjs';

export const STORYBOARD_FIELDS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'];
const FPS = 24;
const OVERLAP = 22;

// Match Python round() in the installed Director, including half-to-even ties.
function roundEven(value) {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + floor % 2 : Math.round(value);
}

export function storyboardPlan(options = {}) {
  const secondsPerChunk = options.secondsPerChunk ?? 10;
  const chunkCount = options.chunkCount ?? 4;
  if (typeof secondsPerChunk !== 'number' || !Number.isFinite(secondsPerChunk) || secondsPerChunk <= 0 || secondsPerChunk > 15) throw new Error('Seconds per chunk must be greater than 0 and at most 15.');
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 8) throw new Error('Choose 1 through 8 storyboard chunks.');
  const frames = Math.max(39, Math.min(362, 17 * Math.ceil((roundEven(secondsPerChunk * FPS) - 5) / 17) + 5));
  const chunks = Array.from({ length: chunkCount }, (_, i) => {
    const sampleStartFrame = i * (frames - OVERLAP);
    const startFrame = sampleStartFrame + (i ? OVERLAP : 0);
    return { index: i + 1, sampleStartFrame, startFrame, endFrame: sampleStartFrame + frames,
      globalStart: startFrame / FPS, globalEnd: (sampleStartFrame + frames) / FPS,
      localStart: (i ? OVERLAP : 0) / FPS, localEnd: frames / FPS };
  });
  return { secondsPerChunk, chunkCount, frames, fps: FPS, overlap: OVERLAP, totalFrames: chunks.at(-1).endFrame,
    duration: chunks.at(-1).globalEnd, chunks };
}

export function normalizeJob(raw) {
  if (raw?.outputFormat !== undefined && !['h3', 'storyboard'].includes(raw.outputFormat)) throw new Error('Choose H3 prompt or ComfyUI Storyboard Director output.');
  if (raw?.outputFormat !== 'storyboard') return normalizeInput(raw);
  if (raw.storyboard !== undefined && (!raw.storyboard || typeof raw.storyboard !== 'object' || Array.isArray(raw.storyboard))) throw new Error('Storyboard settings must contain secondsPerChunk and chunkCount.');
  const plan = storyboardPlan(raw.storyboard);
  const input = normalizeInput({ ...raw, mode: 'reference', duration: plan.frames / FPS });
  if (input.assets?.some(a => a.type !== 'picture') || /<(?:Audio|Video)\s+\d+>|\b(?:Audio|Video)\s*\d+\s*:/i.test(input.referenceNotes)) throw new Error('This storyboard preset connects global Picture references. Use picture assets here; audio/video references require separate connections in ComfyUI.');
  if ((input.assets?.length ?? new Set([...input.referenceNotes.matchAll(/(?:Picture|Image)\s*(\d+)/gi)].map(m => Number(m[1]))).size) > 9 || /(?:Picture|Image)\s*(?:[1-9]\d+)/i.test(input.referenceNotes)) throw new Error('This storyboard workflow supports at most 9 global picture references.');
  return { ...input, outputFormat: 'storyboard', storyboard: { secondsPerChunk: plan.secondsPerChunk, chunkCount: plan.chunkCount } };
}

export function storyboardReport(input) {
  const plan = storyboardPlan(input.storyboard);
  return [`Set seconds_per_chunk = ${plan.secondsPerChunk} and chunk_count = ${plan.chunkCount}.`,
    `Paste the complete script into H3 Storyboard Director → script. Leave shared_continuity empty because the script includes [shared].`,
    `${plan.frames} sampled frames per chunk at 24 fps. Finished video: ${plan.duration.toFixed(3)} seconds (${plan.totalFrames} frames). Later chunks trim 22 overlap frames.`,
    ...plan.chunks.map(c => `Chunk ${c.index}: final video ${c.globalStart.toFixed(3)}–${c.globalEnd.toFixed(3)}s; new action uses local ${c.localStart.toFixed(3)}–${c.localEnd.toFixed(3)}s.`),
    'Prompt cues are local to each sampled chunk. For a finished-video time, subtract that chunk’s sample start (not its delivered start). Text times guide the model; they do not guarantee frame-exact actions.',
    'Keep global Picture assets in the same numbered workflow slots. Storyboard Image anchors are separate; this script does not wire images or run ComfyUI.'].join('\n');
}

export function buildStoryboardMessages(input) {
  const plan = storyboardPlan(input.storyboard);
  const messages = buildMessages(input);
  if (input.characterVoices?.length) messages[0].content += '\n\nSTORYBOARD CHARACTER VOICES\nKeep each selected character voice and its global speaker ID consistent across all chunks. Persistent voice traits may be included in shared continuity, but repeat the exact selected description beside the named speaker at their first vocal appearance in EACH chunk where they vocalize. Preserve the same matching Subject definition across chunks. Do not require a silent or absent character to speak, repeat dialogue, or reset speaker IDs at a chunk boundary. A voice description only in shared continuity or subject_definitions does not replace its placement in that chunk\'s detailed_description.';
  messages[0].content += `\n\nSTORYBOARD DIRECTOR OUTPUT OVERRIDE\nThe target is MiniMax H3 Storyboard Long Reference to Video - Turbo 4-Step v1.0.0, using H3 Storyboard Director 1.0.0. The whole story is ${plan.duration.toFixed(6)} seconds, not one clip. Divide the requested action into exactly ${plan.chunkCount} sequential chunks. Do NOT repeat the whole story in every chunk. Keep the requested order, all supplied times, dialogue, outcomes and exclusions. Do not put future events or the whole plot into shared continuity.\nReturn a plain script with [shared] followed by persistent identity/style/setting facts only, then [chunk 1] through [chunk ${plan.chunkCount}] on their own lines. Each chunk contains its own complete six-field full-reference H3 prompt. A later transport override may request equivalent JSON. Never put chunk headings inside a field. Shared prose must not contain field headers, dialogue, action beats or timestamps. Each chunk is independently conditioned; retain the SAME Subject/Picture/speaker IDs and exact reference ownership across chunks. Use the same definition text for a recurring Subject. Only apply references actually visible in that chunk. Reference pictures are global identity/appearance assets, NOT first/last frames. Do not invent Video or Audio assets for the generated previous clip.\nEach chunk starts with its current scene/pose and ends in a state the next chunk can continue. Don't replay earlier actions. A chunk boundary is NOT a camera cut: keep continuous camera/pose/motion unless the brief explicitly requests a cut. Restart shot numbering at [Shot 1] in each chunk; the opening composition has no timestamp. Keep global story times OUT of the final prose; use local sampled-clip event cues after the opening composition. Preserve explicitly timed events by converting global time g to local g - sampleStartFrame/24. Never schedule a new event in a continuation's discarded local 0–${(OVERLAP / FPS).toFixed(6)} seconds. Ranges spanning a join must be split into their appropriate continuous phases, without duplicating the event onset. Later cuts also use local times. The final state must be reached in the last delivered chunk.\nUse 'At 2.000 seconds, ...' or 'From 2.000 to 3.000 seconds, ...' for within-shot event cues. Put these only in detailed_description after its style/opening composition. Apply timing cues for storyboard output even when natural timing was selected for ordinary H3 prompts. Keep exact words in their correct chunk only; do not repeat dialogue in every chunk. If the supplied timing cannot fit the actual finished duration, flag that conflict rather than move or omit the event. Keep each chunk concise enough to finish the entire response; never invent detail to reach 350 words.\nThe application-calculated frame plan is authoritative:\n${JSON.stringify(plan)}\nPlain-script output uses only [shared] and [chunk N] top-level headings. Do not emit global [at ...] sections because this format keeps each chunk's events INSIDE its detailed_description field. Do not include a timing report, copy instructions or settings in the script.`;
  messages[1].content = JSON.stringify({ ...input, duration: plan.duration, storyboardPlan: plan });
  return messages;
}

export function storyboardTransport(chunkCount, descriptions = {}, options = {}) {
  const properties = { shared_continuity: { type: 'string', description: 'Persistent identity, setting and style only. No action timeline, dialogue, timestamps or H3 field headers.' } };
  const plan = storyboardPlan({ ...options, chunkCount });
  for (const c of plan.chunks) {
    const sections = Object.fromEntries(STORYBOARD_FIELDS.map(key => [key, { type: 'string', minLength: 1, description: descriptions[key] || key }]));
    sections.detailed_description.description += ` This chunk covers ONLY final-video ${c.globalStart.toFixed(6)} to ${c.globalEnd.toFixed(6)} seconds. Do not copy the whole brief. Include only events occurring here. Convert each global time to local by subtracting ${(c.sampleStartFrame / FPS).toFixed(6)}. New events use local ${c.localStart.toFixed(3)} through ${c.localEnd.toFixed(3)} seconds. Start with style, then [Shot 1] composition and <Subject N> labels, then local event cues. Complete silence means no audible events.`;
    properties[`chunk_${c.index}`] = { type: 'object', properties: sections, required: STORYBOARD_FIELDS, additionalProperties: false };
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export function serializeStoryboardReply(text, count) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Ollama returned incomplete or invalid storyboard JSON. Your existing result is unchanged.'); }
  const keys = ['shared_continuity', ...Array.from({ length: count }, (_, i) => `chunk_${i + 1}`)];
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== keys.length || keys.some(k => !Object.hasOwn(data, k)) || typeof data.shared_continuity !== 'string') throw new Error('Ollama returned missing or extra storyboard sections. Your existing result is unchanged.');
  const heading = /^\s*\[(?:chunk\b|shared\b|at\b|\d)/im;
  if (heading.test(data.shared_continuity)) throw new Error('Ollama placed storyboard headings inside shared continuity. Your existing result is unchanged.');
  const script = [`[shared]\n${data.shared_continuity.trim()}`];
  for (let i = 1; i <= count; i++) {
    const chunk = data[`chunk_${i}`];
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk) || Object.keys(chunk).length !== STORYBOARD_FIELDS.length || STORYBOARD_FIELDS.some(k => typeof chunk[k] !== 'string' || !chunk[k].trim() || heading.test(chunk[k]))) throw new Error(`Ollama returned incomplete or malformed sections in chunk ${i}. Your existing result is unchanged.`);
    script.push(`[chunk ${i}]\n${STORYBOARD_FIELDS.map(k => `${k}:\n${chunk[k].trim()}`).join('\n\n')}`);
  }
  const result = script.join('\n\n');
  if (result.length > 80000) throw new Error('The storyboard is too long. Use fewer chunks or a shorter brief.');
  return result;
}

export function validateStoryboard(text, input) {
  const errors = [], warnings = [];
  const plan = storyboardPlan(input.storyboard);
  const value = typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
  const headings = [...value.matchAll(/^\[(shared|chunk ([1-8]))\]\s*$/gm)];
  if (headings.map(m => m[1]).join('|') !== ['shared', ...plan.chunks.map(c => `chunk ${c.index}`)].join('|') || value.slice(0, headings[0]?.index).trim()) errors.push('Use [shared] once, then exactly the selected [chunk 1] through [chunk N] sections in order.');
  const shared = headings[0]?.[1] === 'shared' ? value.slice(headings[0].index + headings[0][0].length, headings[1]?.index).trim() : '';
  if (STORYBOARD_FIELDS.some(f => new RegExp(`^${f}:`, 'm').test(shared))) errors.push('Shared continuity must contain persistent prose only, not H3 field headers.');
  if (/<d>|\b(?:At|From) \d+(?:\.\d+)? seconds?\b/.test(shared)) errors.push('Move dialogue and timed events out of [shared] into their individual chunks.');
  const chunkTexts = [];
  const narratives = [], allDefinitions = [];
  const definitions = new Map();
  for (const c of plan.chunks) {
    const index = headings.findIndex(m => m[1] === `chunk ${c.index}`);
    if (index < 0) continue;
    const body = value.slice(headings[index].index + headings[index][0].length, headings[index + 1]?.index).trim();
    chunkTexts.push(body);
    const perChunk = validateOutput(body, { ...input, prompt: input.prompt.replace(/<d>[\s\S]*?<\/d>/g, ''), exactText: '', duration: plan.frames / FPS, timing: 'cued' });
    errors.push(...perChunk.errors.map(e => `Chunk ${c.index}: ${e}`));
    warnings.push(...perChunk.warnings.filter(w => !/350–500|^Voice preset for |^Review that each selected voice|^Character voice presets are inactive/.test(w)).map(w => `Chunk ${c.index}: ${w}`));
    const desc = body.match(/(?:^|\n)detailed_description:\s*([\s\S]*?)(?=\noverall_soundscape:|$)/)?.[1] ?? '';
    narratives.push(desc);
    const unquoted = desc.replace(/<d>[\s\S]*?<\/d>|"[^"\n]*"/g, '');
    if (c.index > 1) {
      for (const time of unquoted.matchAll(/\b(?:At|From)\s+(\d+(?:\.\d+)?)(?:\s+to\s+\d+(?:\.\d+)?)?\s+seconds?\b/gi)) {
        // Three-decimal seconds may round down by less than one millisecond.
        if (Number(time[1]) + 0.0005 < c.localStart) errors.push(`Chunk ${c.index}: a new action starts in the discarded overlap; use local times at or after ${c.localStart.toFixed(3)} seconds.`);
      }
    }
    const defs = body.match(/(?:^|\n)subject_definitions:\s*([\s\S]*?)(?=\nsummary:|$)/)?.[1] ?? '';
    allDefinitions.push(defs);
    for (const d of defs.matchAll(/^<(Subject \d+)>\s*([^\n]+)/gm)) {
      const definition = d[2].trim();
      if (definitions.has(d[1]) && definitions.get(d[1]) !== definition) warnings.push(`<${d[1]}> has different definition wording across chunks. Check that identity and source ownership remain unchanged.`);
      else definitions.set(d[1], definition);
    }
  }
  for (const match of value.matchAll(/^\s*\[(?:at\b|\d|chunk\b|shared\b)[^\n]*$/gmi)) {
    if (!/^\[(?:shared|chunk [1-8])\]$/.test(match[0].trim())) errors.push('Use only [shared] and [chunk N] top-level headings in this export. Keep local event times inside detailed_description.');
  }
  const all = chunkTexts.join('\n');
  const voiceCheck = checkCharacterVoices(narratives.join('\n'), allDefinitions.join('\n'), input.characterVoices ?? [], {
    silent: input.audio === 'silent' || /\b(?:complete|total|absolute) silence\b|\b(?:completely|entirely|fully) silent\b|\bsilent video\b|\bno audio\b/i.test(input.prompt),
  });
  // Missing per-chunk descriptions are already checked above; this catches IDs
  // changing or being reassigned across independently conditioned chunks.
  errors.push(...voiceCheck.errors.filter(e => /multiple speaker IDs|assigned to more than one/.test(e)));
  warnings.push(...voiceCheck.warnings);
  for (const line of [...input.exactText.split('\n'), ...[...input.prompt.matchAll(/<d>\[[^\]]+\]\s*([\s\S]*?)<\/d>/g)].map(m => m[1])].map(s => s.trim()).filter(Boolean)) {
    if (!all.includes(line)) errors.push(`Required exact text is missing or changed across the storyboard: ${JSON.stringify(line)}.`);
  }
  warnings.push('Review chunk-to-chunk pose, camera and audio continuity, placement of explicit story times, and shared facts. Format checks cannot prove semantic fidelity or exact action timing.');
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], wordCount: value ? value.split(/\s+/).length : 0, charCount: value.length };
}
