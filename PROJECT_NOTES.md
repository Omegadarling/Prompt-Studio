# Prompt Studio — project notes

Version: 1.5.0. Read this file before editing or adding features. If `LOCAL_NOTES.md` is present, read it for private deployment history and machine-specific decisions. Keep that file, runtime state, credentials, personal launchers, and deployment receipts out of the public repository.

## Purpose

Prompt Studio converts a creative brief into an editable MiniMax H3 prompt or an H3 Storyboard Director script. It does not generate video, wire ComfyUI, or install the target workflow. Preserve exact dialogue, on-screen wording, counts, reference ownership, action order, camera intent, and the requested final state. Structural validation is useful evidence, not proof of semantic fidelity or video quality.

Node.js 22+ runs the server and CLI with no npm dependencies. `npm start` serves loopback port 17943 by default. `npm test` uses synthetic providers and fixtures, not real inference. The public clone works without optional downloaded guide snapshots or private deployment files.

## Components

| File or directory | Responsibility |
| --- | --- |
| `server.mjs` | HTTP API, private-network boundaries, concurrency, rewrite orchestration, bounded correction, and validation. |
| `provider.mjs` | Ollama and optional OpenRouter adapters, request bounds, schema-constrained replies, and serialization. |
| `settings.mjs` | Atomic provider/address/model persistence and connection fingerprints. |
| `prompting.mjs` | H3 normalization, compact mode-specific instructions, keyframe alignment, and structural checks. |
| `expansion.mjs` | Focused six-aspect Fluff up planning schema, bounded parsing, and original-brief precedence for final formatting. |
| `storyboard.mjs` | Director frame planning, instructions/schema, script serialization, timing report, and per-chunk checks. |
| `assets.mjs` | Shared browser/server numbering, validation, and serialization; served as `/assets.mjs`. |
| `voices.mjs` | Shared 30-preset catalog, bounded character choices, conservative narrative insertion, voice placement and speaker-ID checks; served as `/voices.mjs`. |
| `asset-drafting.mjs` | Media descriptions, explicitly labeled brief-only guesses, and preservation of existing card slots. |
| `media.mjs` | Bounded media validation, video-frame handling, PCM WAV checks, and transient whisper.cpp transcription. |
| `public/` | Browser UI, text import, cards/media previews, connection controls, editable output, and copy/download/recheck. |
| `cli.mjs` | Text or JSON jobs; refuses existing output files before inference. |
| `guides/sources.json` | Official URLs, pinned revision, retrieval date, and snapshot hashes. |
| `test/` | Behavioral tests for formatting, providers, settings, HTTP boundaries, media, cards, UI, timing, and storyboards. |

## Guide and inference decisions

- The official base/keyframe and full-reference guides are authoritative. Revision `42ed227ee7df40d41602854ae760620d6eb651fe` was retrieved on 2026-10-22; use `guides/sources.json` for URLs and hashes. Full third-party guide text and supplementary user documents are not bundled publicly. Optional local snapshots remain provenance material, not a runtime requirement.
- Send compact instructions for the selected mode. Sending both full guides caused mode confusion. Base prompts have three core fields; full reference has six. Preserve official `<Picture N>` notation rather than supplementary production headings or alternate reference syntax.
- Shot 1 has no timestamp. Later camera cuts use official timestamps; within-shot event cues are separate. Dialogue uses `<d>[Language] ...</d>` with stable speaker identity. Closed lips apply only to explicit voiceover. Do not invent acoustic sources from visual properties.
- Recommended reference-description length is not permission to invent detail or pad a short action. Exact-text presence checks do not prove correct speaker or asset ownership.
- Ollama explicitly uses `think:false`: unbounded reasoning can exhaust the reply allowance before completing a prompt. Section schemas and focused examples improve structure but do not guarantee creative correctness.
- A complete Ollama draft with structural errors receives at most one same-provider correction within the original five-minute deadline. Accept it only if errors strictly decrease without introducing a new error; otherwise retain the first complete draft and review notes. Never retry an initial failed/incomplete/length-limited generation automatically or switch models/providers to hide a failure. OpenRouter never receives automatic correction.
- Connection fingerprints reject stale assumptions before inference. Test reads metadata; Save persists settings. Neither generates text. Localhost refers to the app host, not the browser device. Saved settings override environment defaults.

## Assets, media, and UI lessons

- Cards retain stable IDs while Picture, Audio, and Video are numbered independently. Structured `assets` are canonical when provided; legacy `referenceNotes` is used only when assets are omitted. Text-to-video excludes inactive cards but preserves page drafts.
- Reordering, removing, or changing a type can alter a label mentioned elsewhere. Show the mapping and require explicit review; never blindly rewrite those mentions or old output. The gate is a UI aid, not a semantic guarantee for CLI/API jobs.
- Media observations must use actual media only. Do not send the creative brief or filename as visual evidence: models can copy requested future action into a still-image description. Brief-only suggestions are separate and visibly labeled guesses.
- Browser images and up to three video frames are prepared at a maximum 1280-pixel edge. Sampled frames cannot establish full motion or soundtrack contents. Browser-readable audio becomes mono 16 kHz PCM16 WAV; `H3_WHISPER_CLI` and `H3_WHISPER_MODEL` configure optional CPU transcription.
- Render audio starter descriptions directly from detected speech and duration. A second LLM summary can mistake spoken narration for observed action. State that timbre, music, and nonverbal sounds were not analyzed. Delete transcription temporary files on success and failure.
- No prompt/card/media history or credentials belong in browser local storage. Late AI descriptions must not overwrite edits; offer explicit replacement. Failed requests preserve drafts, cards, and previous output.
- Preview and sampling require CSP image/media `blob:` allowances; keep script and connection origins restricted. Native confirmations can stall embedded browsers: use inline controls. Output edits and relevant control changes invalidate prior validation.

## Descriptive expansion decisions (1.5.0)

- `creativity: "fluff"` is an explicit option alongside faithful/enrich; faithful stays the default. The selector is visible below the brief. Selecting it does not request inference. It expands presentation details while preserving the core idea and every supplied constraint, not the plot or duration. Do not treat the word fluff as a visual style.
- Merely adding expansion rules to the long H3 system prompt produced a 67-word summary and even 'visual style is fluff' with MiniCPM. A short plain-prose prepass still tended to under-expand. The focused six-aspect JSON prepass works better, followed by regular H3 formatting with compatible expanded detail as prompt and the unchanged originalBrief taking precedence. Original normalized input remains the validation source. Never silently change providers or fake expansion with generic padding.
- Both passes use the chosen provider. The UI/docs disclose two passes and extra usage. Parse expansion strictly before formatting: six nonempty strings, maximum2,500 characters each and12,000 combined, no truncation. Failed/length-limited/invalid expansion never starts formatting or retries; failed formatting preserves the previous UI result. All calls share the original five-minute budget; the browser allows 310 seconds for Fluff up with either provider. Sum available usage across expansion, formatting and completed correction, including a discarded correction; unknown totals remain unknown. Aggregate paid costs too, without retaining a misleading per-call cost breakdown.
- Targets are flexible: roughly180–300 narrative words for a short clip,100–180 per storyboard chunk. A description under100 words is a review warning, not an error that causes more automatic inference. Formatting/correction must retain useful expansion rather than collapse it into a summary. Explicit references, quotes, selected voices, silence, exact times and ending always override embellishment.
- A storyboard prepass receives the actual whole delivered duration, not one chunk's sampled duration. It keeps events global; the final Director formatting pass distributes them and converts to local times. Shared continuity stays brief persistent facts. Continue treating MiniCPM's structural failures as manual-review issues, not a successful whole-workflow result.

## Character voice decisions (1.4.0)

- The menu groups 15 adult female and 15 adult male fictional presets. Each has a stable ID, a menu name/style and a separate editable description. Scene character names are independent; never turn a preset name into a new character. No voice audio is generated or cloned.
- `characterVoices` is normalized on the server and shared by browser/API/CLI. Maximum 16 unique character names, 80 characters per name, 1,000 per description and 8,000 combined. Catalog defaults are resolved server-side. Preserve all drafts across mode switches and failures; edits invalidate prior checks.
- Voice traits belong with a named vocal source in the main narrative, outside dialogue and visible text. Instructions retain the matching Subject definition where applicable. Speaker IDs follow actual vocal order and remain global across storyboard chunks. Silence makes the choices inactive; no voice selection authorizes invented speech.
- MiniCPM may omit voice directions even when supplied in both system and creative instructions. Moving them into the brief did not reliably help. `applyVoiceDirections` adds only exact selected text for an identifiable named vocal source, independently in each chunk. It preserves existing prose, dialogue, reference labels, timing and IDs. It never invents an ID or guesses an absent character. Model format problems remain visible; do not mistake inserted directions for a validated whole prompt.
- Named speaker-ID bindings and named Subject definitions permit checks; direct untagged `Name says/answers/...` can receive a direction while remaining flagged for its missing ID. Missing or ambiguous associations need review. Never repair unrelated semantics by string replacement. Repeat exact directions per vocal chunk, not only in shared continuity. Check tests for insertion idempotence, quoted names, inactive characters and cross-chunk ID reuse before changing this logic.

## Timing and Storyboard Director contract

The export targets **MiniMax H3 Storyboard Long Reference to Video – Turbo 4-Step v1.0.0**, using H3 Storyboard Director 1.0.0. Frame calculation and script syntax follow that Director source contract, not a seconds-times-count approximation. The whole workflow is not bundled. Check source behavior before claiming compatibility with another Director version.

- Ordinary H3 output supports `timing: "cued"` (estimated within-shot event cues) and `"natural"` (no added estimates). Preserve supplied times in either case. Text cues do not guarantee frame-exact generated actions.
- `outputFormat: "storyboard"` forces full-reference mode. `storyboard.secondsPerChunk` is greater than zero and at most 15; `chunkCount` is an integer from 1 through 8. Defaults are 10 and 4. Ordinary H3 `duration` is ignored.
- The Director runs at 24 fps. Frames per sampled chunk are `clamp(39, 362, 17 * ceil((roundEven(seconds * 24) - 5) / 17) + 5)`, with Python-compatible half-to-even rounding. Continuations discard 22 frames. Defaults yield 243 frames per chunk and `4 * 243 - 3 * 22 = 906` delivered frames, or 37.75 seconds.
- For zero-based chunk index `i`, sampled start is `i * (frames - 22)` frames. Delivered start adds 22 only for continuation chunks. Convert global event time to local sampled-clip time by subtracting sampled start divided by 24, not delivered start. Never place a new onset in discarded continuation overlap.
- Export `[shared]` followed by `[chunk 1]` through `[chunk N]`. Shared content contains persistent identity, setting, and style only. Each chunk has its own six-field reference prompt with stable Subject/Picture/speaker IDs; actions progress instead of replaying the story. Restart shot numbering per chunk. A chunk boundary does not imply a camera cut.
- Storyboards always use local event cues, even if Natural timing was selected for an ordinary H3 prompt. Keep cues inside `detailed_description`; do not emit top-level global-time sections. Place exact dialogue in its intended chunk only.
- This preset supports at most nine global Picture references. Their order must match global workflow slots. Storyboard Image anchors are separately connected; appearance references are not automatically frame anchors. Audio/Video references need connections outside this preset.
- Paste the complete script into Director `script`, set matching `seconds_per_chunk` and `chunk_count`, and leave `shared_continuity` empty because `[shared]` is included. Keep the timing report outside copied text. Preserve old output/report together when settings change or a new request fails.

## Verification before release

Run `npm test` after changes. Storyboard tests cover frame quantization, overlap, script structure, persistent IDs, local timing boundaries, and exact text. UI tests cover payloads, mode restoration, draft preservation, stale validation, and separation of the report from copied output. Asset/media tests cover bounds and asynchronous edit preservation.

Use synthetic briefs and media for live smoke checks. Verify served UI and the selected provider separately; a passing schema check is not a full creative review. Keep public fixtures generic. Do not commit personal addresses, usernames, credentials, user media, or machine-specific deployment evidence. Consult `LOCAL_NOTES.md` when present before operating a private deployment.
