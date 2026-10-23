// Fictional preset names describe vocal performances, not real people's voices.
export const VOICE_GROUPS = Object.freeze(['Adult female', 'Adult male']);
export const MAX_CHARACTER_VOICES = 16;
export const MAX_CHARACTER_NAME_LENGTH = 80;
export const MAX_VOICE_DESCRIPTION_LENGTH = 1000;
export const MAX_VOICE_TOTAL_LENGTH = 8000;

const entries = [
  ['nora', 'Nora', 'Adult female', 'Warm storyteller', 'Adult female voice with a warm lower-middle register, velvety resonance, rounded vowels, a relaxed moderate pace, and gentle pauses between thoughts.'],
  ['maya', 'Maya', 'Adult female', 'Bright quick thinker', 'Adult female voice in a bright middle-high register, with clear forward resonance, crisp consonants, brisk conversational pacing, and lively changes in pitch.'],
  ['vera', 'Vera', 'Adult female', 'Calm authority', 'Adult female voice in a low register, with steady chest resonance, firm clean articulation, measured pacing, and controlled downward inflections at sentence endings.'],
  ['iris', 'Iris', 'Adult female', 'Airy and reflective', 'Adult female voice in a soft middle-high register, with an airy breath texture, gently lengthened vowels, an unhurried pace, and quiet reflective pauses.'],
  ['june', 'June', 'Adult female', 'Understated dry wit', 'Adult female voice in a middle register, with a slightly grainy texture, understated pitch variation, precise short phrases, and dry, lightly clipped sentence endings.'],
  ['clara', 'Clara', 'Adult female', 'Clear presenter', 'Adult female voice in a clear middle register, with bright even resonance, careful consonants, steady medium pacing, and clean professional enunciation.'],
  ['sylvie', 'Sylvie', 'Adult female', 'Smooth and poised', 'Adult female voice in a smooth lower-middle register, with rounded resonance, connected phrasing, restrained volume, and deliberate, poised sentence endings.'],
  ['maeve', 'Maeve', 'Adult female', 'Lilting conversational', 'Adult female voice in a middle register, with a light Irish English accent, lilting pitch movement, softly rounded vowels, and fluid conversational pacing.'],
  ['tess', 'Tess', 'Adult female', 'Smoky rasp', 'Adult female voice in a low register, with a smoky rasp, textured breath at phrase endings, strong consonants, and a deliberate, grounded pace.'],
  ['elena', 'Elena', 'Adult female', 'Lyrical warmth', 'Adult female voice in a full middle register, with warm rounded resonance, musical rises and falls in speech, smoothly connected vowels, and measured expressive pacing.'],
  ['phoebe', 'Phoebe', 'Adult female', 'Sparkling energy', 'Adult female voice in a clear high register, with bright ringing resonance, springy rhythms, quick expressive pitch changes, and buoyant conversational energy.'],
  ['ruth', 'Ruth', 'Adult female', 'Earthy mentor', 'Adult female voice in a rich low register, with a lightly weathered grain, spacious vowels, slow deliberate phrasing, and patient pauses that give each thought weight.'],
  ['audrey', 'Audrey', 'Adult female', 'Crisp classic diction', 'Adult female voice in a middle register, with a light standard southern British English accent, precise consonants, carefully shaped vowels, and composed medium-paced delivery.'],
  ['sloane', 'Sloane', 'Adult female', 'Cool minimalist', 'Adult female voice in a low-middle register, with a dry close texture, narrow pitch range, relaxed short phrases, and quiet, matter-of-fact endings.'],
  ['wren', 'Wren', 'Adult female', 'Energetic adventurer', 'Adult female voice in a strong middle-high register, with a lightly gritty edge, punchy consonants, quick decisive pacing, and clear emphatic stresses.'],
  ['theo', 'Theo', 'Adult male', 'Warm conversational', 'Adult male voice in a warm baritone register, with rounded resonance, relaxed vowels, easy medium pacing, and natural friendly rises and falls.'],
  ['adrian', 'Adrian', 'Adult male', 'Polished narrator', 'Adult male voice in a smooth middle-baritone register, with a light standard southern British English accent, precise diction, measured phrasing, and restrained resonant endings.'],
  ['jonah', 'Jonah', 'Adult male', 'Gentle tenor', 'Adult male voice in a light tenor register, with a soft breath texture, smooth vowels, low vocal pressure, and calm, unhurried conversational pacing.'],
  ['marcus', 'Marcus', 'Adult male', 'Commanding bass', 'Adult male voice in a deep bass register, with strong chest resonance, firm consonants, slow measured pacing, and decisive downward sentence endings.'],
  ['elliot', 'Elliot', 'Adult male', 'Nimble dry wit', 'Adult male voice in a light middle-high register, with crisp consonants, quick agile phrasing, restrained pitch changes, and dry, precisely timed pauses.'],
  ['rafael', 'Rafael', 'Adult male', 'Rhythmic storyteller', 'Adult male voice in a textured baritone register, with warm grain, rounded vowels, rolling rhythmic phrasing, and expressive changes between quick and unhurried speech.'],
  ['dorian', 'Dorian', 'Adult male', 'Cool precision', 'Adult male voice in a low-middle register, with smooth dry resonance, tightly controlled pitch, exact consonants, and deliberate evenly spaced phrases.'],
  ['samuel', 'Samuel', 'Adult male', 'Seasoned warmth', 'Adult male voice in a rich lower-baritone register, with a lightly weathered rasp, rounded chest resonance, patient pacing, and gently weighted pauses.'],
  ['finn', 'Finn', 'Adult male', 'Bright adult tenor', 'Adult male voice in a bright tenor register, with clear ringing vowels, quick animated pacing, energetic pitch movement, and lightly percussive consonants.'],
  ['graham', 'Graham', 'Adult male', 'Rough gravel', 'Adult male voice in a low bass-baritone register, with a coarse gravelly texture, dense resonance, short deliberate phrases, and strong breathy releases at sentence endings.'],
  ['miles', 'Miles', 'Adult male', 'Laid-back and soft', 'Adult male voice in a relaxed middle register, with soft breathy resonance, loosely connected vowels, an unhurried pace, and understated changes in pitch.'],
  ['callum', 'Callum', 'Adult male', 'Lilting and grounded', 'Adult male voice in a light baritone register, with a light Scottish English accent, gently rolled rhotic sounds, lilting phrase contours, and steady conversational pacing.'],
  ['hugo', 'Hugo', 'Adult male', 'Expressive theatrical', 'Adult male voice in a full middle register, with open resonant vowels, a broad expressive pitch range, clearly shaped consonants, and deliberate dramatic pauses.'],
  ['leon', 'Leon', 'Adult male', 'Smooth intimate bass', 'Adult male voice in a smooth low register, with close velvety resonance, softened consonants, slow connected phrasing, and quiet controlled delivery.'],
  ['owen', 'Owen', 'Adult male', 'Steady plainspoken', 'Adult male voice in a middle register, with a light General American English accent, clear uncomplicated diction, even conversational pacing, and direct natural sentence endings.'],
];
export const VOICE_PRESETS = Object.freeze(entries.map(([id, name, group, style, description]) => Object.freeze({ id, name, group, style, description })));

export function normalizeCharacterVoices(raw = []) {
  if (!Array.isArray(raw) || raw.length > MAX_CHARACTER_VOICES) throw new Error(`Add at most ${MAX_CHARACTER_VOICES} character voices.`);
  const names = new Set(), ids = new Set();
  let total = 0;
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each character voice must include a name and a preset.');
    const id = item.id ?? `voice-${index + 1}`;
    if (typeof id !== 'string' || !id || id.length > 100 || /[\r\n\0]/.test(id) || ids.has(id)) throw new Error('Character voice IDs must be unique, short text.');
    ids.add(id);
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name || name.length > MAX_CHARACTER_NAME_LENGTH || /[\r\n\0<>\[\]]/.test(name)) throw new Error(`Enter a character name of 1–${MAX_CHARACTER_NAME_LENGTH} characters without line breaks or markup.`);
    const key = name.normalize('NFKC').toLowerCase();
    if (names.has(key)) throw new Error(`Choose only one voice for ${name}; character names must be unique.`);
    names.add(key);
    const preset = VOICE_PRESETS.find(p => p.id === item.presetId);
    if (!preset) throw new Error(`Choose a voice preset for ${name}.`);
    const description = item.description === undefined ? preset.description : typeof item.description === 'string' ? item.description.trim() : '';
    if (!description || description.length > MAX_VOICE_DESCRIPTION_LENGTH || /[\r\n\0<>\[\]]/.test(description)) throw new Error(`Give ${name} a voice description of 1–${MAX_VOICE_DESCRIPTION_LENGTH} characters without line breaks or markup.`);
    total += name.length + description.length;
    if (total > MAX_VOICE_TOTAL_LENGTH) throw new Error(`Keep character names and voice descriptions under ${MAX_VOICE_TOTAL_LENGTH.toLocaleString('en-US')} characters combined.`);
    return { id, name, presetId: preset.id, description };
  });
}

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const comparable = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function descriptionLocations(body, description) {
  const spans = [...body.matchAll(/<d>[\s\S]*?<\/d>|"[^"\n]*"/g)];
  const pattern = escapePattern(description).replace(/\s+/g, '\\s+');
  return [...body.matchAll(new RegExp(pattern, 'giu'))].filter(m => !spans.some(span =>
    // A descriptive phrase may itself contain a quoted adjective. A whole
    // description inside spoken or visible text does not count as direction.
    span[0].startsWith('<d>') ? m.index < span.index + span[0].length && m.index + m[0].length > span.index
      : m.index >= span.index && m.index + m[0].length <= span.index + span[0].length));
}

function voiceAnchors(body, definitions, voices) {
  const clean = body.replace(/<d>[\s\S]*?<\/d>|"[^"\n]*"/g, match => ' '.repeat(match.length));
  const anchors = [];
  for (const voice of voices) {
    const name = `(?<![\\p{L}\\p{N}_])${escapePattern(voice.name)}(?![\\p{L}\\p{N}_])`;
    const patterns = [`${name}\\s*\\((S[1-9]\\d*)\\)`, `\\((S[1-9]\\d*)\\),?\\s+${name}`,
      `${name}(?=\\s+(?:says|answers|asks|replies|speaks|sings|whispers|shouts|exclaims|narrates|laughs|gasps|sobs|hums|yells|calls|announces)\\b|\\s+\\(speaking voice:)`];
    const named = [...new Set(definitions.split('\n').filter(line => new RegExp(name, 'iu').test(line)))];
    if (named.length === 1 && !voices.some(other => other.name !== voice.name && new RegExp(`(?<![\\p{L}\\p{N}_])${escapePattern(other.name)}(?![\\p{L}\\p{N}_])`, 'iu').test(named[0]))) {
      const subject = named[0].match(/^\s*(<Subject [1-9]\d*>)/)?.[1];
      if (subject) patterns.push(`${escapePattern(subject)}\\s*\\((S[1-9]\\d*)\\)(?:,?\\s+${name})?`);
    }
    for (const pattern of patterns) for (const m of clean.matchAll(new RegExp(pattern, 'giu'))) {
      anchors.push({ name: voice.name, speaker: m[1]?.toUpperCase() ?? null, start: m.index, end: m.index + m[0].length });
    }
  }
  return anchors.sort((a, b) => a.start - b.start || b.end - a.end);
}

function descriptionForVoice(body, voice, anchors) {
  return descriptionLocations(body, voice.description).some(m => {
    const preceding = anchors.filter(a => a.end <= m.index).sort((a, b) => b.end - a.end);
    return preceding[0]?.name === voice.name;
  });
}

/** Mechanical placement checks only; character ownership still needs review. */
export function checkCharacterVoices(body, definitions, voices, { silent = false } = {}) {
  const errors = [], warnings = [], bindings = [];
  if (!voices.length) return { errors, warnings, bindings };
  if (silent) return { errors, warnings: ['Character voice presets are inactive because complete silence is selected or requested.'], bindings };
  const anchors = voiceAnchors(body, definitions, voices);
  const quotes = [...body.matchAll(/<d>[\s\S]*?<\/d>|"[^"\n]*"/g)].map(m => m[0]).join('\n');
  for (const voice of voices) {
    const ids = new Set(anchors.filter(a => a.name === voice.name && a.speaker).map(a => a.speaker));
    if (ids.size > 1) errors.push(`${voice.name} has multiple speaker IDs; keep one stable ID for this character.`);
    bindings.push(...[...ids].map(speaker => ({ name: voice.name, speaker })));
    if (comparable(quotes).includes(comparable(voice.description))) errors.push(`${voice.name}'s voice description belongs outside dialogue and visible-text quotes.`);
    if (ids.size && !descriptionForVoice(body, voice, anchors)) {
      errors.push(`Include ${voice.name}'s exact selected voice description with their first vocal identity in the main narrative, outside dialogue.`);
    } else if (!ids.size) {
      warnings.push(`Voice preset for ${voice.name}: no matching named speaker ID was found. If this character vocalizes, include their name, stable speaker ID and selected voice description; otherwise leave them silent.`);
    }
  }
  const owners = new Map();
  for (const { name, speaker } of bindings) {
    if (owners.has(speaker) && owners.get(speaker) !== name) errors.push(`${speaker} is assigned to more than one selected character; give each vocal source its own stable ID.`);
    owners.set(speaker, name);
  }
  warnings.push('Review that each selected voice belongs to the intended character and fits any audio reference. Text directions guide a performance; they do not guarantee an identical voice.');
  return { errors: [...new Set(errors)], warnings, bindings };
}

/** Insert only the explicitly selected performance text for an identifiable
 * vocal source. Never rewrite dialogue, invent an ID, or guess an absent name. */
export function applyVoiceDirections(text, input) {
  if (typeof text !== 'string' || !input.characterVoices?.length || input.audio === 'silent'
    || /\b(?:complete|total|absolute) silence\b|\b(?:completely|entirely|fully) silent\b|\bsilent video\b|\bno audio\b/i.test(input.prompt)) return text;
  const voices = normalizeCharacterVoices(input.characterVoices);
  // Each chunk is handled separately; shared continuity cannot satisfy a chunk.
  return text.split(/(?=^\[chunk [1-8]\][ \t]*$)/m).map(section => {
    const definitions = section.match(/(?:^|\n)subject_definitions:[ \t]*\n?([\s\S]*?)(?=\nsummary:|$)/)?.[1] ?? '';
    const pattern = /((?:^|\n)(?:integrated_multimodal_description|detailed_description):[ \t]*\n?)([\s\S]*?)(?=\n(?:overall_soundscape|non_diegetic_music):|$)/;
    section = section.replace(pattern, (field, heading, body) => {
      const check = checkCharacterVoices(body, definitions, voices);
      const anchors = voiceAnchors(body, definitions, voices);
      const additions = [];
      for (const voice of voices) {
        if (descriptionForVoice(body, voice, anchors)) continue;
        const ids = [...new Set(check.bindings.filter(b => b.name === voice.name).map(b => b.speaker))];
        if (ids.length > 1) continue; // conflicting identity needs review
        if (ids.some(id => check.bindings.some(b => b.speaker === id && b.name !== voice.name))) continue;
        const anchor = anchors.find(a => a.name === voice.name);
        if (!anchor) continue;
        additions.push({ at: anchor.end, text: ` (speaking voice: ${voice.description})` });
      }
      if (!additions.length) return field;
      // Parenthetical performance text stays at the matched vocal identity,
      // including a first appearance in a later shot. No event is moved.
      for (const addition of additions.sort((a, b) => b.at - a.at)) body = body.slice(0, addition.at) + addition.text + body.slice(addition.at);
      return heading + body;
    });
    return section;
  }).join('');
}
