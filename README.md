# Prompt Studio — 1.5.0

Turn a video brief into an editable MiniMax H3 prompt, or a script for ComfyUI's H3 Storyboard Director. Prompt Studio follows MiniMax's official writing guides and checks the resulting structure. It formats prompts; it does not generate video or run ComfyUI.

## Start locally

Install **Node.js 22 or newer**, then open a terminal in this project and run:

```sh
npm start
```

Open **http://127.0.0.1:17943**. There are no npm dependencies to install.

Open **AI connection** and choose your provider:

- **Ollama:** enter `http://127.0.0.1:11434` for Ollama on the same computer as Prompt Studio, or your own LAN endpoint such as `http://ollama.local:11434`. Test the connection, choose an installed model, and save. An image-capable model is needed to describe pictures or sampled video frames. The initial model default is `qwen3.5:latest`; the app does not install it for you.
- **OpenRouter:** set `OPENROUTER_API_KEY` in the server's environment, then select OpenRouter and a model. This optional cloud provider incurs normal API charges. Automatic media descriptions and brief-based asset suggestions require Ollama.

`localhost` always means **the computer hosting Prompt Studio**, which may differ from the device running your browser. A shared Ollama server must already permit LAN access. Prompt Studio does not change firewalls, start Ollama, install models, or switch providers automatically.

**Test connection** reads metadata without generating text. **Save connection** persists the provider, address, and model on the server. Saved settings take precedence over environment defaults.

## Format a prompt

1. Paste a brief, or drop a `.txt` or `.md` file into the input.
2. Keep **H3 prompt** as the output format, choose the generation mode, and enter the intended duration.
3. In a reference mode, add asset cards manually, add files to draft descriptions, or choose **Suggest assets from brief** for clearly labeled guesses. Edit descriptions and arrange cards to match your H3 reference order.
4. Optionally add **Character voices**, match each name to your brief, and choose a preset. Choose event timing and any creative, sound, music, or exact-text options.
5. Format, review the checks and wording, then copy or download the result. The output remains editable; rechecking does not request another model generation.

| H3 mode | Reference cards |
| --- | --- |
| Text to video | No active references. Existing cards remain available when switching back. |
| First frame | One Picture describing the opening frame. |
| First + last frame | Two Pictures: Picture 1 opens; Picture 2 ends. |
| Last frame | One Picture describing the final frame. |
| Full reference | One or more Picture, Audio, or Video cards, each describing its role and exclusions. |

**Cued timing** adds estimated event-time cues inside a shot while retaining requested timing. **Natural timing** avoids adding estimated cues to ordinary H3 prompts; supplied timing still matters. A time cue is not a camera cut. Review and edit estimates—text cues do not guarantee that a generated video performs an action at an exact frame.

Use **Exact text** for dialogue or on-screen wording that must appear verbatim, one item per line. Rewrite instructions protect supplied dialogue; this field also enables explicit presence checks. Those checks cannot establish correct speaker ownership or full creative fidelity.

### Fluff up a simple idea

Choose **Fluff up · lots of descriptive detail** in **Creative freedom**, directly below the brief, then format as usual. This expands a simple idea with concrete composition, lighting, color, texture, atmosphere, movement detail and camera wording while keeping its central idea and explicit constraints. Existing dialogue, reference facts, subject count, action order, timing, camera restrictions and ending take priority. It does not authorize new plot events, characters, dialogue, cuts or music.

Fluff up uses **two AI passes with the selected provider**: a focused descriptive expansion, followed by H3 formatting. It may take longer and uses more tokens than Faithful or Enrich the visual detail. With OpenRouter, both passes incur normal provider charges. Changing the option itself makes no request. The original brief stays unchanged in the input and remains authoritative during formatting and validation; failed expansion or formatting preserves the previous output.

A short idea targets roughly 180–300 words of main scene description, or 100–180 words per storyboard chunk, when useful detail and constraints allow it. These are guidance, not enforced lengths: review the result for adequate expansion and creative fit. The app flags very short results. Faithful remains the default; Enrich the visual detail remains the more restrained option. Existing format checks and the optional one-time Ollama correction still apply, with the original five-minute local deadline shared across all passes.

### Character voices

Click **Add character**, enter the character's name as used in your brief, and choose a named voice from **Adult female** or **Adult male**. Each group contains 15 presets covering different registers, textures, pacing, accents, and delivery styles. A preset fills in an editable speaking description; choosing another preset replaces that description. Remove a character's row to stop applying its voice. Voice rows and edits stay in the page when switching generation modes.

The character keeps their own name; the preset name is just a menu label. The formatter places voice directions with speaker identity in the main narrative, outside `<d>` dialogue tags. The app also inserts a missing selected direction when the generated text clearly identifies that vocal source; ambiguous or absent names remain flagged for review. This does not repair unrelated model formatting errors. In Storyboard Director mode, each applicable chunk receives its own direction and speaker IDs must stay consistent across chunks. Check the resulting voice ownership and any conflicting reference-audio direction before generating video.

Presets never add dialogue or make a silent character speak. Complete silence disables the directions while retaining the selected rows. These are fictional text performance presets, not recorded samples, audio previews, or voice cloning; they do not guarantee identical generated voices. The app supports up to 16 characters, names up to 80 characters, descriptions up to 1,000 characters, and 8,000 characters combined across names and descriptions. Keep descriptions to one paragraph without H3 markup.

### Reference cards and media

Picture, Audio, and Video numbering each have their own sequence. A Picture, an Audio, and another Picture become **Picture 1, Audio 1, Picture 2**. Descriptions retain their identity when reordered. If changing or removing cards changes a label mentioned in the brief, exact text, or remaining descriptions, formatting pauses for explicit reference review. Correct those mentions before continuing. Previous output is not rewritten automatically.

Uploaded media helps create a starter description:

- **Pictures:** PNG, JPEG, or still WebP, up to 10 MiB. The browser prepares an image up to 1280 pixels on its longest edge for Ollama vision.
- **Video:** browser-readable files up to 24 MiB and 120 seconds. The browser samples up to three frames. Descriptions cannot establish continuous motion between those frames or analyze the soundtrack.
- **Audio:** browser-readable files up to 24 MiB and 120 seconds. The browser converts audio to mono 16 kHz PCM WAV for optional local speech transcription. Descriptions report detected speech and duration; they do not analyze voice identity, timbre, music, or nonverbal sound effects.

Actual media observations are separate from guesses based on the brief. Review every drafted description. Existing descriptions, including edits made while a request runs, are preserved until you explicitly apply a proposed replacement. Attach the original media separately in your H3 workflow; Prompt Studio does not upload it to a video generator.

App input limits are 16,000 characters for the brief, 6,000 for exact text, and 24 asset cards with up to 6,000 characters each and 12,000 characters total after labels are added. Imported text files must also fit within 64 KiB. These are app limits, not claims about H3's generation limits.

## ComfyUI Storyboard Director export

Select **ComfyUI Storyboard Director** for the workflow **MiniMax H3 Storyboard Long Reference to Video – Turbo 4-Step v1.0.0**. This export targets the H3 Storyboard Director 1.0.0 script contract. The complete third-party workflow is not bundled, installed, or executed by this project.

Storyboard output uses full-reference prompts and accepts up to **nine global Picture references**. Audio and Video references need separate ComfyUI connections outside this preset. Match card order to the workflow's global reference image slots. **Storyboard Image anchors are separate**: a global appearance reference is not automatically a first or last frame.

The defaults are **10 seconds per chunk** and **4 chunks**. Choose more than zero and up to 15 seconds per chunk, and 1–8 chunks. The workflow quantizes each chunk's frame count at **24 fps** and trims **22 overlap frames** from every chunk after the first. At the defaults, each sampled chunk has 243 frames and the assembled result has 906 frames: **37.75 seconds**, not 40. The report beside the output gives the calculated duration and chunk ranges for your selected settings.

The script contains `[shared]` for persistent identity, setting, and style, then `[chunk 1]` through `[chunk N]`, each containing a complete full-reference prompt. Actions are distributed across the story. A chunk boundary does not itself request a camera cut. Storyboard prompts always use local event cues, including when Natural timing was selected for an ordinary H3 prompt. Estimated cues still need review.

To use the result:

1. Copy or download the complete script and paste it into **H3 Storyboard Director → script**.
2. Set the node's **seconds_per_chunk** and **chunk_count** to the values used in Prompt Studio.
3. Leave **shared_continuity** empty because the script already includes `[shared]`.
4. Connect images in matching global reference order, and configure any separate Storyboard Image anchors in ComfyUI.

The timing report stays outside the copied script. Event times inside each chunk are local to its sampled clip, accounting for discarded overlap. Check pose, camera, dialogue, and action continuity across joins before generating video.

## Optional audio transcription

Install **whisper.cpp** and a compatible model separately on the computer hosting Prompt Studio. Set these environment variables before starting the server:

| Variable | Value |
| --- | --- |
| `H3_WHISPER_CLI` | Absolute path to `whisper-cli` (`whisper-cli.exe` on Windows). |
| `H3_WHISPER_MODEL` | Absolute path to a compatible model file, such as `ggml-tiny.bin`. |

The browser prepares audio, so the browser workflow does not require FFmpeg on the server. Transcription runs locally on the CPU; temporary audio and transcript files are deleted after success or failure. Without this optional runtime, you can still enter audio descriptions manually and use other features. Whisper binaries and models are not included in this repository.

## Connection, privacy, and hosting

Ollama receives requests directly at the selected local or LAN endpoint, without a cloud API charge. OpenRouter receives rewrite requests only when explicitly selected. Media is not sent to OpenRouter. Prompts, asset cards, and media history are not persisted by the app, and no prompt or key is stored in browser local storage. Download results before refreshing or closing the page, and keep briefs and asset notes separately. The selected provider has its own processing and retention behavior.

Ollama requests explicitly disable thinking. A complete draft with structural errors may receive **one** format correction from the same local model within a shared five-minute deadline. The app keeps the first complete draft if correction fails or does not reduce errors without introducing new ones. Failed, incomplete, or length-limited initial generations are not automatically retried. OpenRouter does not receive automatic correction requests. The UI preserves your draft and previous result when a request fails.

| Environment variable | Default or purpose |
| --- | --- |
| `H3_PROVIDER` | `ollama`; alternatively `openrouter`. |
| `H3_OLLAMA_URL` | `http://127.0.0.1:11434`. |
| `H3_OLLAMA_MODEL` | `qwen3.5:latest`. |
| `H3_REWRITE_MODEL` | OpenRouter model, initially `google/gemini-2.5-flash`. |
| `OPENROUTER_API_KEY` | Optional server-side OpenRouter credential. |
| `H3_SETTINGS_PATH` | Persistent connection JSON; defaults to `.runtime/settings.json`. |
| `H3_PORT` | `17943`. |
| `H3_BIND_HOST` | `127.0.0.1`, for access from the host computer only. |
| `H3_ALLOWED_HOSTS` | Comma-separated allowed hostnames or IPv4 addresses, without ports; required when binding beyond loopback. |
| `H3_HOST_LABEL` | Display label for the app host; defaults to `this computer`. |

For a trusted LAN deployment, configure the bind address and actual hostnames your browser will use. For example, if your network resolves `promptstudio.local` to the app host:

```powershell
$env:H3_BIND_HOST = '0.0.0.0'
$env:H3_ALLOWED_HOSTS = 'promptstudio.local'
$env:H3_HOST_LABEL = 'shared server'
$env:H3_OLLAMA_URL = 'http://ollama.local:11434'
npm start
```

Open `http://promptstudio.local:17943`. This example does not create DNS records or enable firewall access. The server checks Host and Origin and is intended for loopback or trusted private networks; it does not provide public-user authentication. Keep credentials and deployment-specific settings outside version control. Saved connection settings override environment defaults; restart after changing environment configuration.

## Official guides and provenance

The formatter is grounded in MiniMax's [base and keyframe prompt guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md) and [full-reference prompt guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md), retrieved **October 22, 2026**, at revision `42ed227ee7df40d41602854ae760620d6eb651fe`. [`guides/sources.json`](guides/sources.json) records pinned source URLs and SHA-256 hashes.

The public repository links to the guides and records their provenance; it does not bundle the complete third-party guide text or supplementary user documents. Optional locally retained guide snapshots are not required to start or use the app. Compact instructions for each selected mode are implemented in the formatter.

Base modes use three core fields plus applicable frame-alignment instructions; full reference uses six fields. The formatter preserves official reference notation, shot structure, dialogue tags, and separate soundscape/music sections. The official guides take precedence over supplementary notes. Structural checks cannot guarantee semantic fidelity, exact action timing, reference appearance, or generated video quality.

## Command line

Use a plain text file for the defaults:

```sh
node cli.mjs brief.txt prompt-output.txt
```

Or use a JSON job to choose settings:

```json
{
  "prompt": "A clay robot carefully waters a tiny sunflower. One continuous shot, no music.",
  "outputFormat": "h3",
  "mode": "t2v",
  "duration": 5,
  "timing": "cued",
  "creativity": "faithful",
  "audio": "natural",
  "music": "none"
}
```

Run `node cli.mjs job.json prompt-output.txt`. Set `"timing": "natural"` to avoid added estimated cues for ordinary H3 output.

Set `"creativity": "fluff"` for the two-pass descriptive expansion in either ordinary H3 or storyboard jobs. The other choices are `"faithful"` (default) and `"enrich"`.

For named voices, add a `characterVoices` array to either kind of JSON job:

```json
"characterVoices": [
  { "name": "Mira", "presetId": "nora" },
  { "name": "Kai", "presetId": "theo", "description": "Adult male voice with a warm baritone, crisp diction, and brisk conversational pacing." }
]
```

The server fills the preset description when `description` is omitted. Preset IDs and the complete catalog are in [`voices.mjs`](voices.mjs). Names must be unique and match the characters in the brief; speaker numbering follows actual vocal order, not array order.

A storyboard job uses the same structured Picture cards as the UI:

```json
{
  "prompt": "The robot from Picture 1 tends its sunflower: it enters, kneels, waters the soil, then sits beside the plant. Keep the camera continuous and use no music.",
  "outputFormat": "storyboard",
  "mode": "reference",
  "timing": "cued",
  "storyboard": { "secondsPerChunk": 10, "chunkCount": 4 },
  "assets": [
    { "id": "robot", "type": "picture", "description": "Robot appearance only; ignore the background and pose." }
  ],
  "music": "none"
}
```

Run `node cli.mjs storyboard-job.json storyboard-script.txt`. Storyboard mode forces full reference and derives duration from its chunk settings. The exported text is the pasteable script; the browser additionally displays the timing report.

The CLI uses the same saved AI connection. Omit the output filename to print the result. Existing output files are refused before inference. Exit code `0` means success, `1` means failure, and `2` means output was produced but structural errors require attention. Asset IDs must be unique; numbering follows order within each type. Legacy `referenceNotes` text is supported when `assets` is omitted. The browser's reference-renumbering review gate does not run in CLI jobs, so review numbered mentions yourself.

## Development

Read [`PROJECT_NOTES.md`](PROJECT_NOTES.md) before editing, and `LOCAL_NOTES.md` if present for private deployment context. Run `npm test` for synthetic behavioral checks; tests do not contact a real model. See the project notes for component responsibilities and the Storyboard Director timing contract. Personal deployment scripts, runtime data, credentials, and local validation artifacts are excluded from the public repository.
