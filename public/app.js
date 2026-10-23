import { numberAssets, serializeAssets, MAX_ASSETS, MAX_ASSET_DESCRIPTION_LENGTH, MAX_REFERENCE_NOTES_LENGTH } from '/assets.mjs';

'use strict';

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'rewrite-form', 'input-fields', 'prompt', 'mode', 'duration', 'reference-field',
  'reference-notes', 'reference-label', 'reference-help', 'creativity', 'audio',
  'music', 'exact-text', 'drop-area', 'file-input', 'import-button', 'example-button',
  'input-count', 'output', 'output-count', 'generate-button', 'generate-label',
  'generate-arrow', 'generate-spinner', 'copy-button', 'copy-label', 'download-button',
  'validate-button', 'validation-box', 'validation-title', 'validation-icon',
  'validation-description', 'validation-details', 'connection', 'connection-message',
  'connection-retry', 'version', 'format-badge', 'mode-help', 'feedback', 'error-message',
  'hosting-label', 'connection-settings', 'connection-summary', 'connection-form',
  'connection-fields', 'connection-kind', 'connection-url-field', 'connection-url',
  'connection-model', 'connection-models', 'connection-host-help', 'connection-provider-help',
  'connection-model-help', 'connection-test', 'connection-save', 'connection-result',
  'example-label', 'example-confirmation', 'example-cancel',
  'asset-count', 'asset-mode-help', 'asset-new-type', 'asset-add', 'asset-list',
  'asset-empty', 'asset-review', 'asset-review-message', 'asset-review-confirm', 'asset-notice',
  'asset-files-add', 'asset-files-input', 'asset-suggest', 'asset-media-help', 'asset-suggestions',
  'asset-suggestions-help', 'asset-suggestions-list', 'asset-suggestions-apply', 'asset-suggestions-dismiss', 'asset-suggestions-status',
  'output-format', 'timing', 'timing-field', 'timing-help', 'storyboard-settings', 'seconds-per-chunk', 'chunk-count', 'duration-field',
  'output-heading', 'storyboard-paste-help', 'paste-seconds-per-chunk', 'paste-chunk-count', 'storyboard-settings-note',
  'storyboard-report-section', 'storyboard-report', 'storyboard-report-status',
].map((id) => [id, $(id)]));

const modes = {
  t2v: {
    help: 'Start with words. H3’s base format structures your visuals, action, and sound.',
    example: 'A handmade clay robot sits on a workbench beside a tiny potted fern. It gently waters the plant with a miniature watering can, then tilts its head to admire a new leaf. Warm afternoon window light, tactile stop-motion look. One continuous shot with a very slow, small push in. Soft water drops and quiet room tone. No dialogue or music.',
    references: '',
  },
  i2v: {
    help: 'Begin exactly at your first frame, then develop the action forward.',
    label: 'Describe your opening frame',
    placeholder: 'Picture 1 — first frame: describe the subject, pose, composition, and lighting.',
    example: 'Continue from the opening frame. The paper boat drifts slowly from left to right as raindrops create small ripples. The camera tracks sideways just enough to keep the boat near the center. Preserve the paper texture and soft gray morning light. Gentle rain and water sounds; no music.',
    references: 'Picture 1 — first frame: a small yellow paper boat floats left of center in a shallow puddle. Low water-level viewpoint, soft gray morning light, wet pavement in the background. No people or writing.',
  },
  fl2v: {
    help: 'Connect two frames with a continuous visual path. Picture 1 opens; Picture 2 ends.',
    label: 'Describe your first and last frames',
    placeholder: 'Picture 1 — first frame: …\nPicture 2 — last frame: …',
    example: 'A single continuous shot connects the two frames. The mechanical flower unfolds its brass petals one at a time, revealing a warm light in its center. Keep the camera locked and the tabletop, background, and lighting consistent. Quiet, delicate mechanical clicks. No dialogue or music.',
    references: 'Picture 1 — first frame: a closed brass mechanical flower stands in a small black base on a walnut table. Medium close-up, centered, warm side lighting, dark neutral background.\nPicture 2 — last frame: the same flower is fully open, its brass petals spread evenly around a softly glowing amber center. Same composition, camera, table, and lighting.',
  },
  l2v: {
    help: 'Build a plausible opening, then arrive at your reference as the final frame.',
    label: 'Describe your final frame',
    placeholder: 'Picture 1 — last frame: describe the exact ending pose and composition.',
    example: 'A ceramic fox takes two small steps onto the mossy stone, then settles into the seated pose shown in the ending frame. One continuous shot. The camera makes a slow, slight push in to reach the reference composition. Overcast forest light, subtle leaf rustle, no dialogue or music.',
    references: 'Picture 1 — last frame: a small orange glazed ceramic fox sits centered on a mossy stone, looking toward the right. Its tail wraps around its front paws. Close-up with a soft green forest background and diffuse overcast light.',
  },
  reference: {
    help: 'Track the subjects, settings, motion, or audio you want to carry across from references.',
    label: 'Describe each asset and what H3 should use from it',
    placeholder: 'Picture 1 — character appearance: …\nPicture 2 — environment: …\nVideo 1 — camera movement only: …\nAudio 1 — voice only: …',
    example: 'Place the courier character from Picture 1 in the station environment from Picture 2. The courier walks toward the platform edge, pauses, and looks up at the glowing departure board. Keep the character design and station architecture faithful to the references. One medium-wide shot with a slow lateral tracking move. Quiet ventilation and footsteps. No dialogue, added text, or music.',
    references: 'Picture 1 — character identity: a compact stylized courier robot with a cream ceramic shell, two round blue eyes, a red canvas shoulder bag, and short articulated legs. Preserve these features.\nPicture 2 — environment: a spacious Art Deco railway platform with pale green tiled walls, brass arches, a glowing departure board with abstract unlettered bars, and warm overhead lamps. Use this architecture and lighting.',
  },
};

let providerAvailable = false;
let generating = false;
let validating = false;
let revision = 0;
let copyTimer;
let dragDepth = 0;
let pendingExample = null;
let assets = [];
let assetSequence = 0;
let assetReviewRequired = false;
let assetBusy = '';
let suggestedAssets = [];
let suggestionMode = '';
let suggestionBase = '';
let previousH3Mode = 't2v';
let activeOutputFormat = 'h3';
let resultOutputFormat = null;
let resultStoryboardSettings = null;
let resultNeedsCheck = false;
let mediaControls = [];
const assetMedia = new Map();
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const mediaHelp = 'Media analysis uses your selected Ollama computer. Prompt Studio does not save files; add the originals to H3 separately. PNG/JPEG/WebP: up to 10 MiB each. Audio/video: up to 24 MiB and 2 minutes each. Video uses three sampled frames without audio. Audio descriptions use speech transcription; music and sound qualities need your notes.';
const assetReviewChanges = new Set();
let connectionBusy = '';
let savedConnection = null;
let savedConnectionFingerprint = null;
let connectionKind = 'ollama';
let hostingLabel = 'this computer';
const connectionDrafts = {
  ollama: { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.5:latest' },
  openrouter: { kind: 'openrouter', baseUrl: '', model: 'google/gemini-2.5-flash' },
};

function announce(message) { els.feedback.textContent = message; }
function showError(message) {
  els['error-message'].textContent = message;
  els['error-message'].hidden = false;
}
function clearError() { els['error-message'].hidden = true; els['error-message'].textContent = ''; }

function isStoryboard() { return els['output-format'].value === 'storyboard'; }
function getStoryboardSettings() { return { secondsPerChunk: Number(els['seconds-per-chunk'].value), chunkCount: Number(els['chunk-count'].value) }; }

function getInput() {
  const storyboard = isStoryboard();
  const mode = storyboard ? 'reference' : els.mode.value;
  return {
    prompt: els.prompt.value,
    outputFormat: storyboard ? 'storyboard' : 'h3',
    timing: storyboard ? 'cued' : els.timing.value || 'cued',
    ...(storyboard ? { storyboard: getStoryboardSettings() } : {}),
    mode,
    duration: Number(els.duration.value),
    referenceNotes: mode === 't2v' ? '' : els['reference-notes'].value,
    assets: mode === 't2v' ? [] : assets.map(({ id, type, description }) => ({ id, type, description })),
    creativity: els.creativity.value,
    audio: els.audio.value,
    music: els.music.value,
    exactText: els['exact-text'].value,
  };
}

function updateActions() {
  const hasOutput = Boolean(els.output.value.trim());
  const aiBusy = generating || Boolean(assetBusy) || Boolean(connectionBusy);
  const assetAIReady = providerAvailable && savedConnection?.kind === 'ollama';
  els['generate-button'].disabled = aiBusy || connectionIsDirty() || !providerAvailable || (assetReviewRequired && els.mode.value !== 't2v');
  els['input-fields'].disabled = generating;
  els.mode.disabled = generating || isStoryboard();
  els.timing.disabled = generating || isStoryboard();
  els.duration.disabled = generating || isStoryboard();
  els['seconds-per-chunk'].disabled = generating || !isStoryboard();
  els['chunk-count'].disabled = generating || !isStoryboard();
  els['example-button'].disabled = generating || Boolean(assetBusy);
  els['example-cancel'].disabled = generating || Boolean(assetBusy);
  els['asset-add'].disabled = generating || assets.length >= MAX_ASSETS;
  els['asset-files-add'].disabled = aiBusy || connectionIsDirty() || !assetAIReady || assets.length >= MAX_ASSETS;
  els['asset-suggest'].disabled = aiBusy || connectionIsDirty() || !assetAIReady || !els.prompt.value.trim() || assets.length >= MAX_ASSETS;
  els['asset-suggest'].textContent = assetBusy === 'suggest' ? 'Suggesting assets…' : 'Suggest from brief';
  els['asset-files-add'].textContent = assetBusy === 'describe' ? 'Describing files…' : 'Add assets from files';
  for (const control of mediaControls) control.disabled = aiBusy || (!control.dataset.localAction && (connectionIsDirty() || !assetAIReady));
  els['asset-suggestions-apply'].disabled = generating || Boolean(assetBusy) || suggestionMode !== els.mode.value || suggestionBase !== assetSlotSnapshot();
  els['asset-suggestions-status'].textContent = !suggestedAssets.length ? '' : suggestionBase !== assetSlotSnapshot()
    ? 'Your asset order or types changed. Suggest from brief again to preserve the new numbering.'
    : suggestionMode !== els.mode.value ? 'Return to the mode used for these suggestions before adding them.' : '';
  els['copy-button'].disabled = generating || !hasOutput;
  els['download-button'].disabled = generating || !hasOutput;
  els['validate-button'].disabled = generating || validating || !hasOutput;
  els.output.readOnly = generating;
  els['connection-retry'].disabled = aiBusy;
  els['connection-fields'].disabled = aiBusy;
  els['connection-test'].textContent = connectionBusy === 'test' ? 'Testing…' : 'Test connection';
  els['connection-save'].textContent = connectionBusy === 'save' ? 'Saving…' : 'Save connection';
  els['connection-form'].setAttribute('aria-busy', String(Boolean(connectionBusy)));
  els['generate-label'].textContent = generating ? 'Shaping your prompt…' : isStoryboard() ? 'Build storyboard script' : 'Format for H3';
  els['generate-arrow'].toggleAttribute('hidden', generating);
  els['generate-spinner'].hidden = !generating;
  els['validate-button'].textContent = validating ? 'Checking…' : 'Check format';
  els['rewrite-form'].setAttribute('aria-busy', String(generating));
}

function updateCounts() {
  els['input-count'].textContent = `${els.prompt.value.length.toLocaleString()} characters`;
  const text = els.output.value.trim();
  const words = text ? text.split(/\s+/u).length : 0;
  els['output-count'].textContent = `${words.toLocaleString()} words · ${els.output.value.length.toLocaleString()} characters`;
  updateActions();
}

function markChanged() {
  cancelExampleReplacement();
  revision += 1;
  clearTimeout(copyTimer);
  els['copy-label'].textContent = 'Copy prompt';
  if (els.output.value.trim()) {
    resultNeedsCheck = true;
    els['validation-box'].dataset.state = 'warning';
    els['validation-title'].textContent = 'Changes need a check';
    els['validation-icon'].textContent = '○';
    els['validation-description'].textContent = 'The brief, settings, or result changed. Check the result against your current settings.';
    els['validation-details'].replaceChildren();
  } else {
    els['validation-box'].dataset.state = 'empty';
    els['validation-title'].textContent = 'Ready when you are';
    els['validation-icon'].textContent = '○';
    els['validation-description'].textContent = 'Your result will be checked for the selected H3 structure.';
    els['validation-details'].replaceChildren();
  }
  updateCounts();
  updateStoryboardPresentation();
}

function updateMode() {
  if (isStoryboard()) els.mode.value = 'reference';
  const mode = modes[els.mode.value];
  const needsReference = els.mode.value !== 't2v';
  els['reference-field'].hidden = !needsReference;
  els['reference-notes'].required = false;
  els['reference-label'].textContent = 'Reference assets';
  els['mode-help'].textContent = isStoryboard() ? 'Storyboard Director uses Full reference mode across all chunks. Keep reference ownership and continuity clear.' : mode.help;
  els['format-badge'].textContent = isStoryboard() ? 'STORYBOARD' : els.mode.value === 'reference' ? 'FULL REFERENCE' : 'BASE FORMAT';
  els['reference-help'].textContent = 'Add media to draft descriptions, or guess starter assets from your brief. Every description stays editable.';
  renderAssets();
  renderSuggestions();
  updateStoryboardPresentation();
}

function updateStoryboardPresentation() {
  const storyboard = isStoryboard();
  els['storyboard-settings'].hidden = !storyboard;
  els['duration-field'].hidden = storyboard;
  els['timing-field'].hidden = storyboard;
  els['output-heading'].textContent = storyboard ? 'Your storyboard script' : 'Your H3 prompt';
  els.output.setAttribute('aria-label', storyboard ? 'Editable Storyboard Director script' : 'Editable H3 prompt');
  els['timing-help'].textContent = storyboard
    ? 'Storyboards always use local event-time cues. Review and edit them; generated video timing is not guaranteed.'
    : els.timing.value === 'natural'
      ? 'Follow natural scene progression without adding event-time cues. Any timing already in your brief stays part of the request.'
      : 'Estimated event cues are editable. Their timing guides H3; final video adherence is not guaranteed.';
  const generatedStoryboard = resultOutputFormat === 'storyboard' && resultStoryboardSettings && els.output.value.trim();
  els['storyboard-paste-help'].hidden = !storyboard && !generatedStoryboard;
  const settings = generatedStoryboard ? resultStoryboardSettings : getStoryboardSettings();
  els['paste-seconds-per-chunk'].textContent = String(settings.secondsPerChunk);
  els['paste-chunk-count'].textContent = String(settings.chunkCount);
  els['storyboard-settings-note'].textContent = generatedStoryboard
    ? resultNeedsCheck ? 'These values belong to the last generated script. Your draft or settings changed; generate again to use the updated settings.' : 'Use these values with the generated script above.'
    : 'These are your current settings. Generate a storyboard script before pasting it into the workflow.';
  els['storyboard-report-status'].textContent = resultNeedsCheck ? 'This report describes the last generated script. Your draft, settings, or output changed; check or generate again.' : 'Timeline and workflow details for the generated script.';
}

function changeOutputFormat() {
  if (generating) return;
  const next = isStoryboard() ? 'storyboard' : 'h3';
  if (next === 'storyboard' && activeOutputFormat !== 'storyboard') previousH3Mode = els.mode.value;
  if (next === 'h3' && activeOutputFormat === 'storyboard') els.mode.value = previousH3Mode;
  activeOutputFormat = next;
  updateMode();
  markChanged();
}

function syncAssetNotes() {
  els['reference-notes'].value = serializeAssets(assets);
  els['asset-count'].textContent = `${assets.length} ${assets.length === 1 ? 'asset' : 'assets'}`;
}

function assetModeMessage() {
  if (els.mode.value === 'i2v') return 'Use exactly one Picture: the opening frame. For audio or video references, choose Full reference.';
  if (els.mode.value === 'l2v') return 'Use exactly one Picture: the final frame. For audio or video references, choose Full reference.';
  if (els.mode.value === 'fl2v') return 'Use exactly two Pictures: Picture 1 opens, Picture 2 ends. Their order determines the frame roles. Choose Full reference to include audio or video.';
  return 'Describe what each asset contributes: character identity, environment, camera motion, voice, music, or a frame anchor.';
}

function assetRole(asset) {
  if (els.mode.value === 'reference') return 'Describe its role below';
  if (asset.type !== 'picture') return 'Requires Full reference mode';
  if (els.mode.value === 'i2v' && asset.number === 1) return 'Opening frame';
  if (els.mode.value === 'l2v' && asset.number === 1) return 'Final frame';
  if (els.mode.value === 'fl2v' && asset.number <= 2) return asset.number === 1 ? 'Opening frame' : 'Final frame';
  return 'Not used in this keyframe mode';
}

function assetProblems() {
  if (els.mode.value === 't2v') return [];
  const problems = [];
  if (!assets.length) problems.push('Add at least one reference asset and describe what H3 should use from it.');
  if (els.mode.value !== 'reference') {
    const count = els.mode.value === 'fl2v' ? 2 : 1;
    if (assets.length !== count || assets.some((asset) => asset.type !== 'picture')) problems.push(`This mode needs exactly ${count === 1 ? 'one Picture' : 'two Pictures'}. Use Full reference for mixed asset types.`);
  }
  if (assets.some((asset) => !asset.description.trim())) problems.push('Describe every asset before formatting.');
  if (serializeAssets(assets).length > MAX_REFERENCE_NOTES_LENGTH) problems.push(`Shorten your asset descriptions to a combined total of ${MAX_REFERENCE_NOTES_LENGTH.toLocaleString()} characters.`);
  if (assetReviewRequired) problems.push('Review the changed asset numbers below, then choose “I reviewed the references”.');
  return problems;
}

function assetTextMentions(text, label) {
  const [kind, number] = label.split(' ');
  const names = kind === 'Picture' ? '(?:Picture|Image)' : kind;
  return new RegExp(`\\b${names}\\s*${number}(?!\\d)`, 'i').test(text);
}

function flagAssetRenumbering(before, after) {
  const next = new Map(numberAssets(after).map((asset) => [asset.id, asset.label]));
  const text = [els.prompt.value, els['exact-text'].value, ...after.map((asset) => asset.description)].join('\n');
  const changes = numberAssets(before).filter((asset) => next.get(asset.id) !== asset.label);
  if (!changes.some((asset) => assetTextMentions(text, asset.label))) return;
  for (const asset of changes) assetReviewChanges.add(`${asset.label} → ${next.get(asset.id) || 'removed'}`);
  assetReviewRequired = true;
  els['asset-review'].hidden = false;
  els['asset-review-message'].textContent = `Asset numbers changed: ${[...assetReviewChanges].join('; ')}. Review mentions in your brief and asset descriptions before formatting. Your wording, protected text, and previous result have not been changed.`;
}

function applyAssetChange(next, notice, focusId, control = 'description') {
  if (generating) return;
  flagAssetRenumbering(assets, next);
  assets = next;
  syncAssetNotes();
  renderAssets(focusId, control);
  markChanged();
  els['asset-notice'].textContent = notice;
}

function moveAsset(id, direction) {
  const index = assets.findIndex((asset) => asset.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= assets.length || generating) return;
  const next = assets.slice();
  [next[index], next[target]] = [next[target], next[index]];
  const label = numberAssets(next).find((asset) => asset.id === id).label;
  applyAssetChange(next, `Moved to position ${target + 1}. This asset is now ${label}.`, id, direction < 0 ? 'up' : 'down');
}

function removeAsset(id) {
  if (generating) return;
  const index = assets.findIndex((asset) => asset.id === id);
  if (index < 0) return;
  const label = numberAssets(assets)[index].label;
  discardAssetMedia(id);
  const next = assets.filter((asset) => asset.id !== id);
  applyAssetChange(next, `${label} removed. Remaining assets have been renumbered.`, next[Math.min(index, next.length - 1)]?.id);
  if (!next.length) els['asset-add'].focus();
}

function renderAssets(focusId, focusControl = 'description') {
  const focusedId = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart == null ? null : [document.activeElement.selectionStart, document.activeElement.selectionEnd];
  mediaControls = [];
  els['asset-list'].replaceChildren();
  els['asset-empty'].hidden = assets.length > 0;
  els['asset-mode-help'].textContent = assetModeMessage();
  els['asset-mode-help'].dataset.state = els.mode.value !== 'reference' && assets.length && assetProblems().some((problem) => problem.startsWith('This mode')) ? 'error' : '';
  const items = numberAssets(assets);
  let focusTarget;
  for (const [index, asset] of items.entries()) {
    const card = document.createElement('article');
    card.className = 'asset-card';
    card.dataset.assetId = asset.id;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `${asset.label}, position ${index + 1}`);
    const heading = document.createElement('div');
    heading.className = 'asset-card-heading';
    const identity = document.createElement('div');
    identity.className = 'asset-identity';
    const number = document.createElement('span');
    number.className = 'asset-position';
    number.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('strong');
    label.textContent = `<${asset.label}>`;
    identity.append(number, label);
    const actions = document.createElement('div');
    actions.className = 'asset-card-actions';
    const controls = {};
    for (const [key, text, title, action, disabled] of [
      ['up', '↑', `Move ${asset.label} up`, () => moveAsset(asset.id, -1), index === 0],
      ['down', '↓', `Move ${asset.label} down`, () => moveAsset(asset.id, 1), index === items.length - 1],
      ['remove', 'Remove', `Remove ${asset.label}`, () => removeAsset(asset.id), false],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = key === 'remove' ? 'text-button asset-remove' : 'asset-move';
      button.textContent = text;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.disabled = disabled || generating;
      button.addEventListener('click', action);
      controls[key] = button;
      actions.append(button);
    }
    heading.append(identity, actions);
    const typeRow = document.createElement('div');
    typeRow.className = 'asset-type-row';
    const type = document.createElement('select');
    type.setAttribute('aria-label', `Asset type for ${asset.label}`);
    for (const [value, text] of [['picture', 'Picture'], ['audio', 'Audio'], ['video', 'Video']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      type.append(option);
    }
    type.value = asset.type;
    type.addEventListener('change', () => {
      if (generating) return;
      discardAssetMedia(asset.id);
      applyAssetChange(assets.map((item) => item.id === asset.id ? { ...item, type: type.value } : item), 'Asset type changed. Review its new number and role; choose a matching file if needed.', asset.id, 'type');
    });
    controls.type = type;
    const role = document.createElement('span');
    role.className = 'asset-role';
    role.textContent = assetRole(asset);
    role.dataset.state = els.mode.value !== 'reference' && asset.type !== 'picture' ? 'error' : '';
    typeRow.append(type, role);
    const descriptionLabel = document.createElement('label');
    const description = document.createElement('textarea');
    description.id = `asset-description-${asset.id}`;
    descriptionLabel.htmlFor = description.id;
    descriptionLabel.textContent = `${asset.label} description & role`;
    description.rows = 3;
    description.maxLength = MAX_ASSET_DESCRIPTION_LENGTH;
    description.required = els.mode.value !== 't2v';
    description.value = asset.description;
    description.placeholder = asset.type === 'audio'
      ? 'Describe the voice, sound, or music. Say whether H3 should reuse it or imitate a quality.'
      : asset.type === 'video'
        ? 'Describe the video and what to use: character, motion, camera work, editing, or continuation.'
        : 'Describe what the picture shows and what to preserve: subject, appearance, scene, lighting, or frame composition.';
    description.addEventListener('input', () => {
      if (assetMedia.has(asset.id)) assetMedia.get(asset.id).edited = true;
      assets = assets.map((item) => item.id === asset.id ? { ...item, description: description.value } : item);
      syncAssetNotes();
      markChanged();
    });
    controls.description = description;
    card.append(heading, typeRow, renderAssetMedia(asset), descriptionLabel, description);
    els['asset-list'].append(card);
    if (asset.id === focusId) focusTarget = controls[focusControl]?.disabled ? description : controls[focusControl];
    else if (!focusId && focusedId === description.id) focusTarget = description;
  }
  if (focusTarget) {
    focusTarget.focus({ preventScroll: !focusId });
    if (!focusId && selection && focusTarget.setSelectionRange) focusTarget.setSelectionRange(...selection);
  }
  updateActions();
}

function loadExampleAssets(referenceText) {
  for (const id of assetMedia.keys()) discardAssetMedia(id);
  suggestedAssets = [];
  renderSuggestions();
  assets = referenceText ? referenceText.split('\n').map((line) => ({
    id: `asset-${++assetSequence}`,
    type: /^Audio/i.test(line) ? 'audio' : /^Video/i.test(line) ? 'video' : 'picture',
    description: line.replace(/^(?:Picture|Audio|Video)\s+\d+\s*[—:\-]\s*/i, ''),
  })) : [];
  assetReviewRequired = false;
  assetReviewChanges.clear();
  els['asset-review'].hidden = true;
  els['asset-notice'].textContent = '';
  syncAssetNotes();
  renderAssets();
}

function warningText(warnings) {
  return Array.isArray(warnings) ? warnings.filter((item) => typeof item === 'string').join(' ') : '';
}

function discardAssetMedia(id) {
  const media = assetMedia.get(id);
  if (media?.url) URL.revokeObjectURL(media.url);
  assetMedia.delete(id);
}

function mediaType(file) {
  const mime = file.type?.toLowerCase() || '';
  const extension = file.name.split('.').pop().toLowerCase();
  const known = { jpg: ['picture', 'image/jpeg'], jpeg: ['picture', 'image/jpeg'], png: ['picture', 'image/png'], webp: ['picture', 'image/webp'], mp3: ['audio', 'audio/mpeg'], wav: ['audio', 'audio/wav'], m4a: ['audio', 'audio/mp4'], flac: ['audio', 'audio/flac'], ogg: ['audio', 'audio/ogg'], aac: ['audio', 'audio/aac'], mp4: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'], webm: ['video', 'video/webm'], mkv: ['video', 'video/x-matroska'] };
  const kind = mime.startsWith('image/') ? 'picture' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : known[extension]?.[0];
  if (!kind) throw new Error(`${file.name}: choose a picture, audio, or video file.`);
  if (kind === 'picture' && !['image/png', 'image/jpeg', 'image/webp'].includes(mime || known[extension]?.[1])) throw new Error(`${file.name}: use a PNG, JPEG, or WebP picture.`);
  const limit = kind === 'picture' ? MAX_PICTURE_BYTES : MAX_MEDIA_BYTES;
  if (!file.size) throw new Error(`${file.name}: this file is empty.`);
  if (file.size > limit) throw new Error(`${file.name}: keep ${kind === 'picture' ? 'pictures under 10 MiB' : 'audio/video under 24 MiB'} per file.`);
  return { type: kind, mimeType: mime || known[extension]?.[1] };
}

function sampleImage(source, width, height) {
  if (!width || !height) throw new Error('The browser could not decode this picture or video frame.');
  const scale = Math.min(1, 1280 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare the media preview. You can describe the asset manually.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL('image/jpeg', 0.86).split(',')[1], mimeType: 'image/jpeg' };
}

function mediaEvent(element, name, begin, message = 'This browser could not read the video codec. Try a short MP4/H.264 or WebM file, or describe it manually.') {
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); element.removeEventListener(name, done); element.removeEventListener('error', fail); };
    const done = () => { clean(); resolve(); };
    const fail = () => { clean(); reject(new Error(message)); };
    const timer = setTimeout(fail, 30000);
    element.addEventListener(name, done, { once: true });
    element.addEventListener('error', fail, { once: true });
    try { begin(); } catch { fail(); }
  });
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let index = 0; index < bytes.length; index += 32768) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
  return btoa(chunks.join(''));
}

async function prepareAudio(media) {
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  let context;
  try {
    await mediaEvent(audio, 'loadedmetadata', () => { audio.src = media.url; audio.load(); }, 'This browser could not read the audio. Try a short WAV, MP3, or M4A file, or describe it manually.');
    if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 120) throw new Error('Use audio of two minutes or less. You can describe longer recordings manually.');
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AudioContextClass || !OfflineContextClass) throw new Error('This browser cannot prepare audio for transcription. You can describe the reference manually.');
    context = new AudioContextClass();
    const decoded = await context.decodeAudioData(await media.file.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 120) throw new Error('Use audio of two minutes or less. You can describe longer recordings manually.');
    const mono = context.createBuffer(1, decoded.length, decoded.sampleRate);
    const mixed = mono.getChannelData(0);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const samples = decoded.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) mixed[index] += samples[index] / decoded.numberOfChannels;
    }
    const offline = new OfflineContextClass(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = mono; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const wav = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(wav);
    const write = (offset, text) => { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); };
    write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let index = 0; index < samples.length; index += 1) { const sample = Math.max(-1, Math.min(1, samples[index])); view.setInt16(44 + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true); }
    return { type: 'audio', name: media.file.name, mimeType: 'audio/wav', data: bytesToBase64(wav) };
  } catch (error) { throw new Error(`Could not prepare ${media.file.name}: ${error.message}`); }
  finally { if (context) await context.close().catch(() => {}); audio.removeAttribute('src'); audio.load(); }
}

async function prepareMedia(media) {
  if (media.type === 'audio') return prepareAudio(media);
  if (media.type === 'picture') {
    let picture;
    try {
      picture = await createImageBitmap(media.file);
      return { type: 'picture', name: media.file.name, ...sampleImage(picture, picture.width, picture.height) };
    } catch (error) {
      throw new Error(`Could not read ${media.file.name} as a picture. Try PNG, JPEG, or WebP, or describe it manually. ${error.message || ''}`);
    } finally { picture?.close(); }
  }
  const video = document.createElement('video');
  video.muted = true; video.preload = 'auto'; video.playsInline = true;
  try {
    await mediaEvent(video, 'loadeddata', () => { video.src = media.url; video.load(); });
    const durationSeconds = video.duration;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('The video duration could not be read. Try another file or describe it manually.');
    if (durationSeconds > 120) throw new Error('Use a video of two minutes or less, or describe this reference manually.');
    const frames = [];
    for (const time of [0, durationSeconds / 2, durationSeconds - Math.min(0.1, durationSeconds * 0.05)]) {
      if (Math.abs(video.currentTime - time) > 0.001) await mediaEvent(video, 'seeked', () => { video.currentTime = time; });
      frames.push({ ...sampleImage(video, video.videoWidth, video.videoHeight), timestampSeconds: Number(time.toFixed(3)) });
    }
    return { type: 'video', name: media.file.name, mimeType: media.mimeType, frames, durationSeconds };
  } finally { video.removeAttribute('src'); video.load(); }
}

function renderAssetMedia(asset) {
  const section = document.createElement('div');
  section.className = 'asset-media';
  const media = assetMedia.get(asset.id);
  const chooser = document.createElement('input');
  chooser.type = 'file';
  chooser.hidden = true;
  chooser.tabIndex = -1;
  chooser.accept = asset.type === 'picture' ? 'image/png,image/jpeg,image/webp' : `${asset.type}/*`;
  chooser.addEventListener('change', () => {
    const file = chooser.files?.[0];
    chooser.value = '';
    if (file) return importAssetFiles([file], asset.id);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'text-button';
  add.textContent = media ? 'Replace file' : 'Add file to describe';
  add.setAttribute('aria-label', `${media ? 'Replace file for' : 'Add file for'} ${asset.label}`);
  add.addEventListener('click', () => { if (!add.disabled) chooser.click(); });
  mediaControls.push(add);
  section.append(chooser, add);
  if (!media) return section;
  const name = document.createElement('p');
  name.className = 'asset-file-name';
  name.textContent = `${media.file.name} · ${(media.file.size / 1024 / 1024).toFixed(1)} MiB`;
  section.append(name);
  const preview = document.createElement(asset.type === 'picture' ? 'img' : asset.type);
  preview.className = 'asset-preview';
  preview.src = media.url;
  if (asset.type === 'picture') preview.alt = `Preview of ${asset.label}: ${media.file.name}`;
  else { preview.controls = true; preview.preload = 'metadata'; }
  section.append(preview);
  const status = document.createElement('p');
  status.className = 'asset-media-status';
  status.dataset.state = media.error ? 'error' : '';
  status.setAttribute('role', 'status');
  status.textContent = media.status || '';
  section.append(status);
  if (media.proposal) {
    const proposal = document.createElement('div');
    proposal.className = 'asset-description-proposal';
    const text = document.createElement('p');
    text.textContent = media.proposal;
    const apply = document.createElement('button');
    apply.type = 'button'; apply.className = 'text-button'; apply.textContent = 'Use this description';
    apply.dataset.localAction = 'true';
    apply.setAttribute('aria-label', `Use suggested description for ${asset.label}`);
    apply.addEventListener('click', () => {
      if (generating || assetBusy || assetMedia.get(asset.id) !== media) return;
      assets = assets.map((item) => item.id === asset.id ? { ...item, description: media.proposal } : item);
      media.proposal = ''; media.status = `Description applied. Review it against your file. ${media.warnings || ''}`.trim();
      syncAssetNotes(); renderAssets(asset.id); markChanged();
    });
    const keep = document.createElement('button');
    keep.type = 'button'; keep.className = 'text-button'; keep.textContent = 'Keep my description';
    keep.dataset.localAction = 'true';
    keep.addEventListener('click', () => {
      if (generating || assetBusy || assetMedia.get(asset.id) !== media) return;
      media.proposal = ''; media.status = 'Your description was kept.'; renderAssets(asset.id);
    });
    mediaControls.push(apply, keep);
    proposal.append(text, apply, keep); section.append(proposal);
  } else if (media.error) {
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'text-button'; retry.textContent = 'Try describing again';
    retry.addEventListener('click', () => importAssetFiles([media.file], asset.id));
    mediaControls.push(retry); section.append(retry);
  }
  return section;
}

async function importAssetFiles(files, targetId) {
  if (generating || assetBusy || connectionBusy || connectionIsDirty() || !providerAvailable || savedConnection?.kind !== 'ollama') return;
  clearError();
  cancelExampleReplacement();
  const context = { prompt: els.prompt.value, mode: els.mode.value, connectionFingerprint: savedConnectionFingerprint };
  const jobs = [];
  const errors = [];
  let next = assets.slice();
  for (const file of Array.from(files)) {
    try {
      const info = mediaType(file);
      let asset = targetId ? next.find((item) => item.id === targetId) : null;
      if (targetId && (!asset || asset.type !== info.type)) throw new Error(`${file.name}: choose a file matching this card’s type, or change the card type first.`);
      if (!targetId && next.length >= MAX_ASSETS) throw new Error(`You can add up to ${MAX_ASSETS} assets. ${file.name} was not added.`);
      if (!asset) { asset = { id: `asset-${++assetSequence}`, type: info.type, description: '' }; next.push(asset); }
      discardAssetMedia(asset.id);
      const media = { file, ...info, url: URL.createObjectURL(file), status: 'Waiting to describe this file…', proposal: '', error: false, edited: false };
      assetMedia.set(asset.id, media);
      jobs.push({ id: asset.id, media, initialDescription: asset.description });
    } catch (error) { errors.push(error.message); }
  }
  if (!jobs.length) { if (errors.length) showError(errors.join(' ')); return; }
  assetBusy = 'describe';
  applyAssetChange(next, 'Files added. Drafting descriptions one at a time; you can still edit the cards.');
  if (errors.length) showError(errors.join(' '));
  let refreshConnection = false;
  try {
    for (const { id, media, initialDescription } of jobs) {
      if (!assets.some((item) => item.id === id) || assetMedia.get(id) !== media) continue;
      media.status = 'Reading media and drafting a description…'; renderAssets();
      try {
        const prepared = await prepareMedia(media);
        if (!assets.some((item) => item.id === id) || assetMedia.get(id) !== media) continue;
        const result = await requestJson('/api/assets/describe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...context, asset: prepared }),
        });
        const current = assets.find((item) => item.id === id);
        if (!current || assetMedia.get(id) !== media) continue;
        if (typeof result.description !== 'string' || !result.description.trim() || result.description.length > MAX_ASSET_DESCRIPTION_LENGTH) throw new Error('No usable description was returned. You can describe this file yourself.');
        media.warnings = warningText(result.warnings);
        if (media.type === 'audio') media.warnings = `Based on speech transcription; nonverbal sounds, music, and voice timbre were not analyzed. ${media.warnings}`.trim();
        if (media.type === 'video') media.warnings = `Based on three sampled frames, without video audio; check motion and continuity yourself. ${media.warnings}`.trim();
        const unchanged = !media.edited && current.description === initialDescription && els.prompt.value === context.prompt && els.mode.value === context.mode;
        if (unchanged && !initialDescription.trim()) {
          assets = assets.map((item) => item.id === id ? { ...item, description: result.description.trim() } : item);
          syncAssetNotes(); markChanged();
          media.status = `Drafted from media. Review the description and intended role. ${media.warnings}`.trim();
        } else {
          media.proposal = result.description.trim();
          media.status = `Your wording was kept. Review this proposed description before using it. ${media.warnings}`.trim();
        }
      } catch (error) {
        if (assetMedia.get(id) !== media) continue;
        media.error = true;
        media.status = `${error.message} Your existing description has been kept.`;
        refreshConnection ||= error.code === 'connection_changed';
      }
      renderAssets();
      if (refreshConnection) {
        for (const job of jobs) if (job.media.status === 'Waiting to describe this file…') { job.media.error = true; job.media.status = 'Connection changed. Choose Try describing again after checking the connection.'; }
        break;
      }
    }
  } finally {
    assetBusy = ''; renderAssets(); updateActions();
    announce('Media description requests finished. Review each card; your brief and previous result were kept.');
    if (refreshConnection) await loadStatus();
  }
}

function renderSuggestions() {
  els['asset-suggestions'].hidden = !suggestedAssets.length;
  els['asset-suggestions-list'].replaceChildren();
  for (const asset of suggestedAssets) {
    const item = document.createElement('div');
    item.className = 'asset-suggestion';
    const type = document.createElement('strong'); type.textContent = asset.type === 'picture' ? 'Picture' : asset.type === 'audio' ? 'Audio' : 'Video';
    const description = document.createElement('p'); description.textContent = asset.description || 'Numbered placeholder — add its description after adding this card.';
    item.append(type, description); els['asset-suggestions-list'].append(item);
  }
}

function assetSlotSnapshot() { return JSON.stringify(assets.map(({ id, type }) => [id, type])); }

function applySuggestions() {
  if (generating || assetBusy || suggestionMode !== els.mode.value) return;
  if (suggestionBase !== assetSlotSnapshot()) { showError('Your asset order or types changed. Suggest from brief again to keep the new numbering correct.'); return; }
  if (assets.length + suggestedAssets.length > MAX_ASSETS) { showError(`These suggestions exceed the ${MAX_ASSETS}-asset limit. Narrow the brief and suggest again.`); return; }
  const added = suggestedAssets.map((asset) => ({ ...asset, id: `asset-${++assetSequence}` }));
  if (serializeAssets([...assets, ...added]).length > MAX_REFERENCE_NOTES_LENGTH) { showError('These suggestions exceed the combined description limit. Shorten existing descriptions or narrow the brief and suggest again.'); return; }
  suggestedAssets = [];
  applyAssetChange([...assets, ...added], 'Added guesses from your brief. Review them against the references you plan to use.', added[0]?.id);
  renderSuggestions();
}

async function suggestAssets() {
  if (generating || assetBusy || connectionBusy || connectionIsDirty() || !providerAvailable || savedConnection?.kind !== 'ollama') return;
  if (!els.prompt.value.trim()) { showError('Add a video brief before suggesting assets.'); els.prompt.focus(); return; }
  const snapshot = JSON.stringify([els.prompt.value, els.mode.value, assets]);
  const slots = assetSlotSnapshot();
  const initiallyEmpty = !assets.length;
  const input = { prompt: els.prompt.value, mode: els.mode.value, assets: assets.map(({ id, type, description }) => ({ id, type, description })), connectionFingerprint: savedConnectionFingerprint };
  assetBusy = 'suggest'; cancelExampleReplacement(); clearError(); updateActions(); renderSuggestions();
  let refreshConnection = false;
  try {
    const result = await requestJson('/api/assets/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!Array.isArray(result.assets) || result.assets.length > MAX_ASSETS || result.assets.some((asset) => !['picture', 'audio', 'video'].includes(asset.type) || typeof asset.description !== 'string' || asset.description.length > MAX_ASSET_DESCRIPTION_LENGTH)) throw new Error('No usable asset suggestions were returned. Your existing cards were kept.');
    suggestedAssets = result.assets.map(({ type, description }) => ({ type, description: description.trim() }));
    suggestionMode = input.mode;
    suggestionBase = slots;
    const unchanged = snapshot === JSON.stringify([els.prompt.value, els.mode.value, assets]);
    els['asset-suggestions-help'].textContent = `${unchanged ? 'Review these guesses before adding them. Existing cards stay unchanged.' : 'Your draft changed during the request. These guesses used the earlier brief; review them before adding. Return to the original mode to apply them.'} ${slots !== assetSlotSnapshot() ? 'Your asset order or types also changed; suggest again to preserve their numbering.' : ''} ${warningText(result.warnings)}`.trim();
    assetBusy = '';
    if (initiallyEmpty && unchanged && suggestedAssets.length) applySuggestions();
    else renderSuggestions();
    const message = result.assets.length ? 'Asset guesses are ready. Review descriptions, numbering, and intended roles.' : 'No additional reference assets were suggested. You can add cards or files yourself.';
    els['asset-notice'].textContent = `${message} ${warningText(result.warnings)}`.trim();
  } catch (error) {
    refreshConnection = error.code === 'connection_changed'; showError(error.message);
  } finally {
    assetBusy = ''; updateActions(); renderSuggestions();
    if (refreshConnection) await loadStatus();
  }
}

async function requestJson(path, options = {}, timeout = 310000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(data?.error || `The request failed (${response.status}). Please try again.`), { code: data?.code });
    if (!data) throw new Error('The app returned an unreadable response. Please try again.');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out. Your brief and previous result are still here. Try again when you are ready.');
    if (error instanceof TypeError) throw new Error(`The app server could not be reached. Check the Prompt Studio service on ${hostingLabel}, then try again.`);
    throw error;
  } finally { clearTimeout(timer); }
}

function getConnectionInput() {
  const kind = els['connection-kind'].value;
  return {
    kind,
    baseUrl: kind === 'ollama' ? els['connection-url'].value.trim() : '',
    model: els['connection-model'].value.trim(),
  };
}

function connectionIsDirty() {
  if (!savedConnection) return true;
  const draft = getConnectionInput();
  return draft.kind !== savedConnection.kind || draft.model !== savedConnection.model ||
    (draft.kind === 'ollama' && draft.baseUrl.replace(/\/+$/, '') !== (savedConnection.baseUrl || '').replace(/\/+$/, ''));
}

function updateConnectionHints() {
  const isOllama = els['connection-kind'].value === 'ollama';
  els['connection-url-field'].hidden = !isOllama;
  els['connection-url'].required = isOllama;
  // Disabled/hidden fields must not block OpenRouter's native form validation.
  els['connection-url'].disabled = !isOllama;
  els['connection-host-help'].hidden = !isOllama;
  els['connection-host-help'].textContent = `“localhost” means the computer hosting Prompt Studio (${hostingLabel}), not the device with this browser. Use the other computer’s LAN address for a shared Ollama server.`;
  els['connection-provider-help'].textContent = isOllama
    ? 'Ollama runs on the computer you choose. No cloud AI service or per-request API charge.'
    : 'OpenRouter sends your brief to a cloud model and uses paid API credits. Uses the app server’s configured credentials; no key is stored in your browser.';
  els['connection-model-help'].textContent = isOllama
    ? 'Test connection lists installed models without generating anything. Connection settings are saved on the app server.'
    : 'Enter an OpenRouter model ID. Test checks the saved connection without generating anything. Settings are saved on the app server.';
  els['connection-model'].placeholder = isOllama ? 'qwen3.5:latest' : 'google/gemini-2.5-flash';
}

function setConnectionFields(settings) {
  const kind = settings?.kind === 'openrouter' ? 'openrouter' : 'ollama';
  connectionKind = kind;
  els['connection-kind'].value = kind;
  els['connection-url'].value = settings?.baseUrl || '';
  els['connection-model'].value = settings?.model || '';
  connectionDrafts[kind] = getConnectionInput();
  updateConnectionHints();
}

function setModelChoices(provider) {
  els['connection-models'].replaceChildren();
  for (const item of (Array.isArray(provider?.models) ? provider.models : [])) {
    const name = typeof item === 'string' ? item : item?.name || item?.model || item?.id;
    if (!name) continue;
    const option = document.createElement('option');
    option.value = name;
    els['connection-models'].append(option);
  }
}

function setConnectionResult(message, error = false) {
  els['connection-result'].textContent = message;
  els['connection-result'].dataset.state = error ? 'error' : 'info';
}

function displayProvider(provider) {
  providerAvailable = Boolean(provider?.available);
  const kind = savedConnection?.kind || provider?.kind || 'ollama';
  const model = provider?.model || savedConnection?.model || 'the configured model';
  els.connection.dataset.state = providerAvailable ? 'ready' : 'error';
  els['connection-message'].textContent = providerAvailable
    ? kind === 'ollama'
      ? `Ollama · ${model}. Your brief and selected media are analyzed on your chosen computers; no cloud AI or per-request API charge.`
      : `OpenRouter · ${model}. Your brief and asset descriptions are sent to this cloud model. Each rewrite uses paid OpenRouter credits.`
    : (provider?.error || 'Your AI connection is unavailable. Open AI connection below to check the address and model.');
  els['connection-summary'].textContent = `${kind === 'ollama' ? 'Ollama' : 'OpenRouter'} · ${model}`;
  els['asset-media-help'].textContent = kind === 'ollama' ? mediaHelp : 'Automatic asset drafting requires Ollama. You can still add and edit cards manually with OpenRouter. No media files are sent to OpenRouter.';
  els['connection-retry'].hidden = providerAvailable;
}

async function loadStatus() {
  if (generating || assetBusy || connectionBusy) return;
  const preserveDraft = savedConnection && connectionIsDirty();
  connectionBusy = 'status';
  updateActions();
  els['connection-message'].textContent = 'Checking your AI connection…';
  els.connection.dataset.state = 'loading';
  try {
    const status = await requestJson('/api/status?refresh=1', {}, 30000);
    els.version.textContent = `v${status.version || '1.3.0'}`;
    document.title = `Prompt Studio · ${status.version || '1.3.0'}`;
    hostingLabel = status.hosting?.label || 'this computer';
    els['hosting-label'].textContent = `HOSTED ON ${hostingLabel.toUpperCase()}`;
    els['hosting-label'].title = status.hosting?.host || '';
    savedConnection = status.settings || {
      kind: status.provider?.kind || 'openrouter',
      baseUrl: status.provider?.baseUrl || '',
      model: status.provider?.model || '',
    };
    savedConnectionFingerprint = status.connectionFingerprint || null;
    if (!preserveDraft) { setConnectionFields(savedConnection); setModelChoices(status.provider); }
    else connectionChanged();
    updateConnectionHints();
    displayProvider(status.provider);
    if (!providerAvailable) els['connection-settings'].open = true;
  } catch (error) {
    providerAvailable = false;
    els.connection.dataset.state = 'error';
    els['connection-message'].textContent = error.message;
    els['connection-retry'].hidden = false;
    els['connection-settings'].open = true;
  } finally { connectionBusy = ''; updateActions(); }
}

function connectionChanged() {
  setConnectionResult(connectionIsDirty()
    ? 'Unsaved connection changes. Save connection before formatting your next prompt.'
    : 'Using your saved connection.');
  updateActions();
}

async function changeConnection(action, event) {
  event?.preventDefault();
  if (generating || assetBusy || connectionBusy) return;
  if (!els['connection-form'].reportValidity()) return;
  const draft = getConnectionInput();
  if (!draft.model) { setConnectionResult('Enter a model name.', true); els['connection-model'].focus(); return; }
  connectionBusy = action;
  updateActions();
  setConnectionResult(action === 'test' ? 'Checking the connection without generating a prompt…' : 'Saving the connection on the app server…');
  try {
    const result = await requestJson(action === 'test' ? '/api/connection/test' : '/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
    }, 45000);
    setModelChoices(result.provider);
    if (action === 'save') {
      savedConnection = result.settings || draft;
      savedConnectionFingerprint = result.connectionFingerprint || null;
      setConnectionFields(savedConnection);
      displayProvider(result.provider);
      setConnectionResult(result.provider?.available
        ? 'Connection saved and ready. Your brief and result are unchanged.'
        : `Connection saved, but not ready: ${result.provider?.error || 'Check the address and model.'}`, !result.provider?.available);
    } else {
      const count = Array.isArray(result.provider?.models) ? result.provider.models.length : 0;
      setConnectionResult(result.provider?.available
        ? `Connection works.${count ? ` ${count} installed ${count === 1 ? 'model is' : 'models are'} available in the Model field.` : ''} ${connectionIsDirty() ? 'Save connection to use these settings.' : 'Your saved connection is unchanged.'}`
        : `Connection test failed: ${result.provider?.error || 'Check the address and model.'} Your saved connection is unchanged.`, !result.provider?.available);
    }
  } catch (error) { setConnectionResult(`${error.message} Your brief and result are unchanged.`, true); }
  finally { connectionBusy = ''; updateActions(); }
}

function addValidationList(items, className, label) {
  if (!items.length) return;
  const list = document.createElement('ul');
  list.className = className;
  list.setAttribute('aria-label', label);
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = typeof item === 'string' ? item : (item.message || JSON.stringify(item));
    list.append(li);
  }
  els['validation-details'].append(list);
}

function displayValidation(validation) {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
  const validResponse = validation && Array.isArray(validation.errors) && Array.isArray(validation.warnings);
  els['validation-details'].replaceChildren();
  if (!validResponse) {
    els['validation-box'].dataset.state = 'warning';
    els['validation-title'].textContent = 'Format check unavailable';
    els['validation-icon'].textContent = '○';
    els['validation-description'].textContent = 'Your prompt is available. Use Check format to try the structural check again.';
    return;
  }
  els['validation-box'].dataset.state = errors.length ? 'error' : warnings.length ? 'warning' : 'valid';
  els['validation-title'].textContent = errors.length ? 'Review the format' : warnings.length ? 'Format checked · review notes' : 'Structural checks passed';
  els['validation-icon'].textContent = errors.length ? '!' : warnings.length ? '○' : '✓';
  els['validation-description'].textContent = errors.length
    ? `${errors.length} ${errors.length === 1 ? 'issue needs' : 'issues need'} attention. You can edit the prompt and check it again.`
    : 'Review the scene, dialogue, and timing before sending this to H3.';
  addValidationList(errors, 'validation-errors', 'Format errors');
  addValidationList(warnings, 'validation-warnings', 'Review notes');
}

async function generate(event) {
  event?.preventDefault();
  if (generating || assetBusy || connectionBusy || connectionIsDirty() || !providerAvailable) return;
  if (!els['rewrite-form'].reportValidity()) return;
  if (!els.prompt.value.trim()) { showError('Add a video idea before formatting.'); els.prompt.focus(); return; }
  const assetErrors = assetProblems();
  if (assetErrors.length) {
    showError(assetErrors.join(' '));
    els['asset-add'].focus();
    return;
  }
  clearError();
  cancelExampleReplacement();
  generating = true;
  revision += 1;
  updateActions();
  const usesOllama = savedConnection?.kind === 'ollama';
  const submitted = getInput();
  let refreshConnection = false;
  announce(usesOllama ? 'Shaping your prompt with Ollama. Loading the model and rewriting can take up to five minutes.' : 'Shaping your prompt. This can take up to two minutes.');
  try {
    const result = await requestJson('/api/rewrite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...submitted, connectionFingerprint: savedConnectionFingerprint }),
    }, usesOllama ? 310000 : 130000);
    if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('No prompt was returned. Your previous result is unchanged.');
    els.output.value = result.text;
    resultOutputFormat = submitted.outputFormat;
    resultStoryboardSettings = submitted.storyboard || null;
    resultNeedsCheck = false;
    els['storyboard-report'].textContent = typeof result.storyboardReport === 'string' ? result.storyboardReport : '';
    els['storyboard-report-section'].hidden = !els['storyboard-report'].textContent.trim();
    updateStoryboardPresentation();
    updateCounts();
    displayValidation(result.validation);
    const resultName = submitted.outputFormat === 'storyboard' ? 'storyboard script' : 'H3 prompt';
    announce(result.repair?.applied ? `Your ${resultName} is ready. One automatic format correction was applied; review, edit, and copy the result.` : `Your ${resultName} is ready to review, edit, and copy.`);
  } catch (error) {
    refreshConnection = error.code === 'connection_changed';
    showError(error.message);
    announce('Your brief and previous result have been kept.');
  } finally {
    generating = false; updateActions();
    if (refreshConnection) await loadStatus();
  }
}

async function validate() {
  if (generating || validating || !els.output.value.trim()) return;
  clearError();
  const checkedRevision = revision;
  validating = true;
  updateActions();
  try {
    const result = await requestJson('/api/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getInput(), text: els.output.value }),
    }, 15000);
    if (checkedRevision === revision) {
      displayValidation(result.validation || result);
      announce('Format check complete. Review the notes beneath your prompt.');
    }
  } catch (error) { showError(error.message); }
  finally { validating = false; updateActions(); }
}

async function importFile(file) {
  if (!file || generating) return;
  clearError();
  if (!/\.(txt|md)$/i.test(file.name)) { showError('Choose a .txt or .md prompt file. Describe images, audio, and videos using Add asset.'); return; }
  if (file.size > 65536) { showError('That file is too large. Use a text file smaller than 64 KB.'); return; }
  const importRevision = revision;
  try {
    const text = await file.text();
    if (generating || importRevision !== revision) { announce('The draft changed while the file was reading. Drop it again to replace the current brief.'); return; }
    if (!text.trim()) throw new Error('That file is empty. Choose a file containing a video prompt.');
    if (text.length > els.prompt.maxLength) throw new Error(`The prompt is too long. Keep it under ${els.prompt.maxLength.toLocaleString()} characters.`);
    if (text.includes('\u0000')) throw new Error('That file does not look like plain text. Save it as a UTF-8 .txt or .md file.');
    els.prompt.value = text.replace(/^\uFEFF/, '');
    markChanged();
    announce(`Loaded ${file.name}. Your result has not been changed.`);
    els.prompt.focus();
  } catch (error) { showError(error.message || 'Could not read that file. Try a UTF-8 text file.'); }
}

els['rewrite-form'].addEventListener('submit', generate);
els['connection-retry'].addEventListener('click', loadStatus);
els['connection-form'].addEventListener('submit', (event) => changeConnection('save', event));
els['connection-test'].addEventListener('click', () => changeConnection('test'));
els['connection-kind'].addEventListener('change', () => {
  connectionDrafts[connectionKind] = {
    kind: connectionKind,
    baseUrl: connectionKind === 'ollama' ? els['connection-url'].value.trim() : '',
    model: els['connection-model'].value.trim(),
  };
  setConnectionFields(connectionDrafts[els['connection-kind'].value]);
  setModelChoices(null);
  connectionChanged();
});
els['connection-url'].addEventListener('input', () => { setModelChoices(null); connectionChanged(); });
els['connection-model'].addEventListener('input', connectionChanged);
els['asset-files-add'].addEventListener('click', () => { if (!els['asset-files-add'].disabled) els['asset-files-input'].click(); });
els['asset-files-input'].addEventListener('change', () => {
  const files = Array.from(els['asset-files-input'].files || []);
  els['asset-files-input'].value = '';
  return importAssetFiles(files);
});
els['asset-suggest'].addEventListener('click', suggestAssets);
els['asset-suggestions-apply'].addEventListener('click', () => applySuggestions());
els['asset-suggestions-dismiss'].addEventListener('click', () => { suggestedAssets = []; renderSuggestions(); });
els['asset-add'].addEventListener('click', () => {
  if (generating || assets.length >= MAX_ASSETS) return;
  const id = `asset-${++assetSequence}`;
  const asset = { id, type: els['asset-new-type'].value, description: '' };
  applyAssetChange([...assets, asset], 'Asset added. Describe it and the role it should play.', id);
});
els['asset-review-confirm'].addEventListener('click', () => {
  if (generating) return;
  assetReviewRequired = false;
  assetReviewChanges.clear();
  els['asset-review'].hidden = true;
  els['asset-notice'].textContent = 'Reference numbers reviewed. Your wording has been kept.';
  updateActions();
});
els.mode.addEventListener('change', () => { updateMode(); markChanged(); });
els['output-format'].addEventListener('change', changeOutputFormat);
els.timing.addEventListener('change', markChanged);
for (const id of ['prompt', 'duration', 'seconds-per-chunk', 'chunk-count', 'reference-notes', 'creativity', 'audio', 'music', 'exact-text', 'output']) {
  els[id].addEventListener('input', markChanged);
}
els['validate-button'].addEventListener('click', validate);
els['import-button'].addEventListener('click', () => els['file-input'].click());
els['file-input'].addEventListener('change', () => { const file = els['file-input'].files?.[0]; els['file-input'].value = ''; importFile(file); });
function exampleDraftSnapshot() {
  return JSON.stringify([els['output-format'].value, els.timing.value, els.mode.value, els.prompt.value, els['reference-notes'].value, els['exact-text'].value, assets]);
}

function cancelExampleReplacement() {
  pendingExample = null;
  els['example-confirmation'].hidden = true;
  els['example-label'].textContent = 'Try an example';
  els['example-button'].setAttribute('aria-expanded', 'false');
}

els['example-cancel'].addEventListener('click', () => {
  cancelExampleReplacement();
  announce('Example replacement cancelled. Your brief and result are unchanged.');
  els['example-button'].focus();
});

els['example-button'].addEventListener('click', () => {
  if (generating || assetBusy) return;
  const draft = exampleDraftSnapshot();
  if ((els.prompt.value.trim() || els['reference-notes'].value.trim() || els['exact-text'].value.trim() || assets.length) && pendingExample !== draft) {
    pendingExample = draft;
    els['example-confirmation'].hidden = false;
    els['example-label'].textContent = 'Replace with example';
    els['example-button'].setAttribute('aria-expanded', 'true');
    announce('Choose Replace with example to replace your brief, reference assets, and exact-text list, or Cancel to keep them. Your existing result will be kept.');
    return;
  }
  cancelExampleReplacement();
  const mode = modes[els.mode.value];
  els.prompt.value = mode.example;
  loadExampleAssets(mode.references);
  els['exact-text'].value = '';
  clearError();
  markChanged();
  announce(`Example loaded for the selected mode. Edit it or choose ${isStoryboard() ? 'Build storyboard script' : 'Format for H3'}.`);
  els.prompt.focus();
});

els['drop-area'].addEventListener('dragenter', (event) => {
  event.preventDefault();
  if (generating) return;
  dragDepth += 1;
  els['drop-area'].classList.add('drag-active');
});
els['drop-area'].addEventListener('dragover', (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = generating ? 'none' : 'copy'; });
els['drop-area'].addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els['drop-area'].classList.remove('drag-active');
});
els['drop-area'].addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  els['drop-area'].classList.remove('drag-active');
  if (generating) return;
  if (event.dataTransfer?.files.length > 1) { showError('Drop one prompt file at a time.'); return; }
  if (event.dataTransfer?.files.length) { importFile(event.dataTransfer.files[0]); return; }
  const text = event.dataTransfer?.getData('text/plain');
  if (text) {
    if (text.length > els.prompt.maxLength) { showError(`Keep your prompt under ${els.prompt.maxLength.toLocaleString()} characters.`); return; }
    clearError(); els.prompt.value = text; markChanged(); announce('Dropped text loaded into your brief.');
  }
});
// Prevent dropped files outside the brief from navigating away and losing the draft.
document.addEventListener('dragover', (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
});

els['copy-button'].addEventListener('click', async () => {
  if (generating || !els.output.value.trim()) return;
  clearError();
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(els.output.value);
      copied = true;
    }
  } catch { /* LAN HTTP may not allow the modern clipboard API. Try selection-based copying below. */ }
  if (!copied) {
    els.output.focus();
    els.output.select();
    try { copied = document.execCommand('copy'); } catch { copied = false; }
  }
  if (copied) {
    els['copy-label'].textContent = 'Copied';
    announce('Prompt copied to your clipboard.');
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { els['copy-label'].textContent = 'Copy prompt'; }, 2200);
  } else {
    els.output.focus(); els.output.select();
    showError('The browser blocked clipboard access. Your prompt is selected; press Ctrl+C or use your device’s Copy command.');
  }
});

els['download-button'].addEventListener('click', () => {
  if (generating || !els.output.value.trim()) return;
  const blob = new Blob([els.output.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date();
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  link.href = url;
  link.download = `prompt-studio-${resultOutputFormat === 'storyboard' ? 'storyboard' : els.mode.value}-${localDate}.txt`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('Your prompt was sent to the browser’s download folder.');
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    if (!generating && !assetBusy && !connectionBusy && !connectionIsDirty() && providerAvailable) els['rewrite-form'].requestSubmit();
  }
});

updateMode();
updateConnectionHints();
updateCounts();
loadStatus();
