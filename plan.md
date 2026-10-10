# Court Sense: implementation plan

Written 2026-09-27 against the repository as found (PRD 0.4, CLAUDE.md). PRD
requirement ids (P-, A-, T-, AC-, Q-) are used throughout. Items this plan adds
to the PRD carry N- ids and Q9 to Q13.

Revised the same evening after Jeremy's decisions and an audit against the goal
and the PRD (section 9), and on 2026-09-28 to add the idle Oracle VM as a worker
(Track H). Decided: Q9 video sources on hold until everything else
is done; Q10 nothing beyond the Claude Code subscription is ever billed, so no
API calls; Q11 earlier freezes accepted, provided reading time is never on the
clock (section 4.1); Q12 the Progress view accepted, folded into one view; A14
the pilot stays on Pickleball Cheat Code. Open: Q13 (section 8).

## 0. Summary

This directory is not a set of starter files. It is a working system: a
deterministic court renderer with two cameras and mirroring, an FSRS scheduler
with aid fading, open-ended sessions, a card view for all six card types
including timed occlusion cards, GitHub sync against a fake API, offline support,
a renderer lab, a content pipeline CLI with 17 tests, four prompt rulebooks and six
Claude Code skills. Both test suites pass on this machine today (52 JavaScript,
17 Python). The reference renders in `docs/img/` match the code.

What does not exist: real content (the app runs on a seven-card sample deck), a
git history (the directory is not a repository), the private data repository,
the WhisperX environment, and any run on a real phone or against real GitHub.

The shortest path to the goal is therefore not more building. It is:

1. Put the repository under git and online (Track A).
2. Run the pilot on this machine's GPU to get real cards (Track B, PRD Phase 1).
3. Use the app daily on a phone and a laptop with real sync, and fix what real
   use reveals (Track C, PRD Phases 2 and 3 remainders).
4. Add the three small app features the goal implies and the PRD defers:
   timed reads that get harder as a card matures, a progress view that shows
   whether reads are getting faster and which topics are weak, and a drill list
   ranked by the weakness it would fix (Track D, in parallel with B and C).
5. Fix two storage limits before the full corpus (Track E), then run the corpus.
6. Video sources, the one part of the goal the PRD leaves out, are designed in
   Track F and on hold until everything else is done (Q9). Later work is listed
   in Track G.
7. Use the always-on Oracle VM as a Linux worker: the transcription fallback,
   the host for the headless extraction loop, and a daily job that keeps up with
   new episodes once the corpus is done (Track H).

Dependencies: A before B; B before C; C before E; D runs alongside B and C; G
after E; F only after G, when Q9 is reopened. H1 any time after A (needed early
only if the Windows WhisperX install fails); H4 after E4.

## 1. Repository analysis

### 1.1 What exists, verified

| Area | Files | State |
|---|---|---|
| Court renderer | `app/src/court/` (geometry, camera, trajectory, scene, first-person, top-down, playback, mirror, theme) | Built; 14 render and 5 mirror tests |
| Scheduler | `app/src/srs/scheduler.js` over vendored ts-fsrs 5.4.2 | Built; stages A/B/C, rating suggestion, replay |
| Sessions and cards | `app/src/ui/session.js`, `card-view.js`, `views.js`, `chrome.js`, `provenance.js`, `dom.js` | Built; fixed-size batches, pending answers, summary with cue and drill |
| Choice pools | `app/src/choices.js` | Built; balanced placement, rotating wrong answers |
| Storage and sync | `app/src/store/progress.js`, `settings.js`, `github-sync.js`, `deck.js`, `sync.js` | Built; per-device files, log union, replay merge; tested only against a fake API |
| Offline and install | `app/sw.js`, `sw-manifest.js`, `manifest.webmanifest`, icons | Built; manifest is current (regenerated and compared today) |
| Lab | `app/lab.html`, `app/src/ui/lab.js` | Built; reads the sample deck, accepts pasted scenes |
| Pipeline | `pipeline/piq.py` (894 lines): feeds, download, transcribe, prepare, status, list, review-list, review-decide, validate, build-deck, spotcheck, extract-api | Built; transcribe untested on real audio |
| Prompts and skills | `prompts/*.md`, `.claude/skills/*/SKILL.md` | Written; never run on a real episode |
| Schemas | `schemas/*.schema.json`, all `schema_version: 1` | Complete for every exchanged file |
| Docs | PRD 0.4, decisions D1 to D20, learning design, rendering notes, sources | Consistent with the code |
| Sample content | `app/data/deck.sample.json`: 4 principles, 3 scenes, 7 cards, 21.7 KB | Illustrative only |

Test runs today: `npm test` 52 passed (after `npm install`), `python -m unittest
discover -s pipeline/tests` 17 passed (after creating `.venv` and installing
`pipeline/requirements.txt`). Test output carries harmless jsdom noise from
`window.scrollTo` in `app/src/ui/session.js:212`.

Deck fields the app reads: cards (`type`, `prompt`, `options`, `answer`,
`explanation`, `focus_cue`, `claude_note`, `scene_id`, `preferred_view`,
`mirrorable`), principles (`priority`, `category`, `trains`, `sources`,
`claude_note`, `statement`), scenes, and the speaker, episode and show tables.
Not read anywhere: `tags`, `levels`, `format`, `topic`. Track D2 starts reading
`topic`.

### 1.2 Environment on this machine, checked 2026-09-27

| Item | Found |
|---|---|
| Git | Not a repository at the first pass. Since then Jeremy initialized it, committed once ("Initial commit", 112 files, this plan included), pushed it, then on 2026-09-28 transferred it to the free organization `jeremys-apps`, made it public and enabled Pages. Remote `git@github.com:jeremys-apps/pickleball-iq.git`, branch `main`; the app is live at https://jeremys-apps.github.io/pickleball-iq/ (app and lab load; the deployed manifest version matches this clone). `node_modules` and `.venv` ignored |
| Data repo `../pickleball-iq-data` | Does not exist |
| Node, Python | Node 24.15, Python 3.13.5 |
| `node_modules`, `.venv` | Were absent; created today for the test runs (both are gitignored) |
| ffmpeg | 8.0 on PATH |
| GPU | NVIDIA GeForce GTX 1660 Ti, 6 GB; `nvidia-smi` on PATH |
| WhisperX | Installed 2026-09-28 in `.venv-whisperx` (gitignored): WhisperX 3.8.6, PyTorch 2.8.0 with CUDA 12.8, pyannote-audio 4.0.7; CUDA sees the GTX 1660 Ti; every flag `piq.py` passes exists |
| `HF_TOKEN` | Set as a Windows user environment variable on 2026-09-28. Sessions started earlier do not see it; the pipeline reads it from the user registry at run time |
| `gh` CLI | Not installed |
| `claude` CLI | Installed (headless loops possible) |
| `ANTHROPIC_API_KEY` | Unset, which keeps Claude Code on the subscription (A15) |
| `yt-dlp` | Not installed (only needed for Track F) |
| Oracle Cloud VM | VM.Standard.A1.Flex: 4 OCPU (Ampere, ARM), 24 GB memory, block storage, Ubuntu 24.04, PostgreSQL already running, otherwise idle. No GPU. Public IP with SSH |

The GPU matters: `pipeline/config/piq.yaml` defaults to `large-v3`, `float16`,
`batch_size: 16`, which is sized for a card with more memory. See A4.

### 1.3 What the PRD lists as remaining

Phase 1 pilot (not started); Phase 2 and 3 remainders (real devices, real sync,
AC-2 to AC-5 on devices); Phase 4 corpus; Phase 5 T-1 to T-6; Phase 6 extras.

## 2. Constraints and patterns to preserve

From CLAUDE.md and `docs/decisions.md`, plus patterns observed in the code.
Anything in this plan that would violate one of these is called out where it
happens.

1. **No podcast-derived content in this repository.** Audio, transcripts, tips,
   principles, real cards and decks live only in the private data repo
   (`${PIQ_DATA_DIR:-../pickleball-iq-data}`). The Pages workflow refuses to
   publish anything in `app/data/` but the sample deck. Track F adds video
   sources under the same rule.
2. **Endorsement rules exactly as written in `prompts/extract-tips.md`.**
   Conservative status when unsure; never upgrade a status. The validator
   cross-checks (endorser must be a pro; provisional pros cannot endorse).
3. **A pro's words and Claude's observations stay apart**: `claude_note` only.
4. **No third-party origins.** Fonts and ts-fsrs are self-hosted; the CSP in
   `app/index.html` and `app/lab.html` allows scripts from `'self'` and network
   calls to `api.github.com` only. New views add no libraries (D1: no framework,
   no build step). Progress tables are HTML tables, not chart libraries.
5. **Ids are permanent once published** (cards, principles, scenes; progress
   refers to them). Episode ids are `{show}-{YYYYMMDD}-{sha1(guid)[:6]}` and must
   be computable at manifest time (this shapes Track F).
6. **Breaking schema changes bump `schema_version` and ship a migration in the
   same commit.** Adding an optional field is not breaking. This plan adds only
   optional fields (`progress.settings.last_cue`, later `card.asks`).
7. **Pure functions outside `app/src/ui/`; DOM code only inside it.** New logic
   (stats, drill ranking, freeze timing, cache) goes in pure modules with
   `node --test` coverage; views get jsdom smoke tests in `tests/ui.test.mjs`.
8. **The renderer is deterministic** and scene changes are checked in the lab
   from both cameras at phone and laptop sizes. Track D1 changes playback timing,
   not drawing, and adds the new timing to the lab.
9. **Mirrorable cards never use a word starting with left or right.** The rule
   lives twice (`SIDE_WORDS` in `app/src/court/mirror.js` and `pipeline/piq.py`)
   and must stay identical.
10. **Choice cards are pools**; use `pickOptions(card, showing)`; never assume
    order or a single correct id. `showing` is the card's `reps` count.
11. **Stage objects are frozen** and `applyAidPreference` spreads them, so new
    stage fields flow through unchanged. Speed and clock are match-like and are
    not softened by the "On mature cards" setting (D17); the freeze lead in D1
    follows the same rule.
12. **Storage keys are `piq.<name>.v1`** and every store function takes an
    injectable `storage` for tests. The service worker deletes every cache whose
    name starts with `court-sense-` except the current shell cache, so any new
    Cache Storage entry must use another prefix.
13. **Merge semantics (D6):** logs are append-only, unioned by id, and a card
    reviewed on two devices is rebuilt by replaying its whole log. Replay needs
    the full history, so logs are never compacted or archived (Track E records
    this as a decision).
14. **Settings migrations happen in `loadSettings`** (old keys dropped there);
    device settings (`piq.settings.v1`) are separate from synced
    `progress.settings`, which currently holds only `updated_at` and merges
    newest-wins.
15. **Prompts are the rulebooks, skills wrap them.** Rule changes go in
    `prompts/`, procedure changes in `.claude/skills/`.
16. **Windows with Git Bash**: bash-compatible commands, `python` not `python3`.
17. **Before every commit touching `app/`:** `npm test` and `npm run sw`.
    Commit messages use the requirement ids.
18. **UI text is short, plain, specific, to one user.** No headers in the app,
    no marketing.
19. **Timed cards**: the question and choices are readable before Play, the
    clock covers only choosing, a timeout is a miss (D11, D16), reduced motion
    freezes at once (Q6).
20. **Open-ended sessions, no caps by default (D12)**; card counts follow the
    content (D18); mirrored reviews and option pools instead of padding (D19,
    D20). Nothing in this plan changes the learning design.

## 3. The goal against the PRD: gaps and suggestions

The stated goal: quiz-format lessons condensed from podcasts and videos, covering
strategy, form and drills, reviewed in far less time than the sources take, so
that the right play becomes instinct in fast games.

| Goal element | PRD and code today | Gap | Proposal |
|---|---|---|---|
| Videos as a source | Two podcasts (section 4.1). YouTube is "not in the pipeline yet"; `download` reads RSS enclosures only | Real gap, on hold by Q9 | Track F, designed and parked: `kind: youtube` shows resolved and downloaded with yt-dlp, same transcription, speaker and endorsement rules; provenance links jump to the timestamp. Revisit after Track G |
| No cost beyond the Claude Code subscription (Q10) | The PRD offers an API extraction path (`extract-api`, D9) and assumes GitHub Pages; the repository as pushed is private on the personal account | Pages on a private repository is a paid feature, and the API path bills per token | No API calls anywhere (A15, Track E4); the app repository becomes public (decided); where it is served from is Q13 |
| Instinct in fast games | Timed occlusion cards, stage fading, real speed at maturity: built. T-2 (earlier freeze as cards mature) and T-5 (response-time trends) deferred to Phase 5 | The app cannot yet show whether reads are getting faster, and timed cards never get harder to read | Track D1 (T-2) and D2 (T-5, a Progress view). Both are pure app work with no content dependency; promote them to the MVP |
| Drills: what to practice for the fastest improvement | `drill_recall` cards; the batch summary suggests a drill after a miss (A-4); `trains` links drills to principles | No place to ask "what should I drill this week?" | Track D3: a drills section in the Progress view, ranked by the retention of what each drill trains (N-2) |
| Remind me | Spaced repetition; one court cue per batch summary (G5) | The cue is gone once the summary closes | Track D4: keep the last cue on the Home screen and sync it (N-3). Small |
| Form | `form_cue` recall and `text_mc` fix-the-mistake cards; external-focus cues; form taught as the pros' words, not drawn (8.10) | Adequate for a quiz app. Videos add a limit: a demonstration that is shown, not said, cannot be extracted | Track F adds a prompt rule: flag tips that depend on a visual demonstration for review |
| Strategy | Court cards, scenes, formations, mirroring, choice pools: built | None | Content (Track B, E4) |
| Short daily habit | Batches, Keep going, phone layout: built | Unverified on a real phone | Track C |
| Trustworthy, private | Endorsement rules, provenance, private data repo, CSP: built | Unverified against real GitHub | Track C4, C5 |
| Full corpus (about 120 episodes, 70 hours) | Headless loop documented | Two storage limits: the deck cache lives in localStorage (about 5 MB on iOS Safari, shared with progress); progress grows by roughly 2 to 5 MB a year | Track E1 (deck cache to Cache Storage), E2 (fetch the deck only when it changed), E3 (progress to IndexedDB when it nears the limit) |
| Run it here | PRD section 3 assumes a GPU machine | 6 GB GPU; WhisperX not installed; no git; no data repo | Track A, with the VM as the Linux fallback (Track H2) |
| Keep up with new episodes | The PRD ends at Phase 4, the full corpus; nothing runs afterwards without a manual session | New episodes arrive weekly and would pile up | Track H4: a daily job on the VM fetches, downloads and transcribes what is new and commits the transcripts; the Claude steps run on demand (N-6) |

Things considered and left alone, because the PRD already serves the goal well:
the no-framework decision, FSRS at 90 percent retention, the endorsement
statuses, open-ended batches, content-driven card counts, mirroring, option
pools, and the over-the-shoulder camera. The learning-design rationale in
`docs/learning-design.md` matches the goal's "automatic instinct" framing
(retrieval, spacing, fading guidance, occlusion).

Small things found on the way: the README's deploy steps assume a git
repository (add step 0); `piq.yaml` needs a GPU-memory note; the jsdom
`scrollTo` warning is worth a one-line guard; the PRD status table should say
the tests were last run on 2026-09-27.

## 4. Interfaces, signatures and data contracts

Only for work this plan schedules. Existing signatures are kept; additions are
optional parameters or new exports. Track G items get one line each, no design.

### 4.1 Track D1: earlier freeze as a card matures (T-2)

```js
// app/src/srs/scheduler.js
// freezeLeadMs: how much earlier than the authored freeze_at_ms a timed card
// freezes at this stage. Match-like, so applyAidPreference leaves it alone.
export const STAGES = Object.freeze({
  A: Object.freeze({ id: 'A', panel: 'top_down', aids: { path: true, shadow: true, stalk: true }, windowScale: null, speed: 0.6,  freezeLeadMs: 0 }),
  B: Object.freeze({ id: 'B', panel: 'mini',     aids: { path: true, shadow: true, stalk: true }, windowScale: 4 / 3, speed: 0.85, freezeLeadMs: 120 }),
  C: Object.freeze({ id: 'C', panel: null,       aids: { path: false, shadow: true, stalk: false }, windowScale: 0.85, speed: 1,  freezeLeadMs: 250 }),
});
```

```js
// app/src/court/playback.js
export const MIN_FLIGHT_MS = 150; // the last shot is always visible for at least this long before the freeze

// Existing return shape plus authoredFreezeAt. freezeAt is clamped so the
// earlier freeze never lands before the last segment has visibly begun.
export function compileTimeline(scene, { freezeLeadMs = 0 } = {})
// -> { segs, total, freezeAt, authoredFreezeAt, responseWindowMs, movements, lookAt, eyesOf }
//    freezeAt = clamp((timeline.freeze_at_ms ?? total) - freezeLeadMs, lastSeg.start + MIN_FLIGHT_MS, total)

export function createPlayer(scene, opts = {})
// opts gains freezeLeadMs (passed to compileTimeline).
// play(fromMs = 0, { toEnd = false } = {})
//    toEnd: ignore the freeze and run to compiled.total, then call onFreeze(frame, total).
//    Used by "Watch again" after the answer so the occluded flight is shown in full.
```

`app/src/ui/card-view.js` passes `freezeLeadMs: stage.freezeLeadMs ?? 0` and
uses `player.play(0, { toEnd: true })` for the post-answer replay. The review
log is unchanged: `stage` already identifies the lead. `app/src/ui/lab.js` gets
a Freeze control (as authored, stage B, stage C) and prints both freeze times.

Data contract: `scene.timeline.freeze_at_ms` keeps its meaning (the authored,
stage A freeze). `prompts/generate-cards.md` keeps its 100 to 200 ms rule; the
prompt gains one sentence saying the app freezes up to 250 ms earlier for mature
cards, so the last segment should last at least 400 ms.

Reading time is never on the clock (Q5, Q11). The question and the choices are
on screen before Play with no limit; the same choices stay in the same positions
after the freeze, so the clock covers only reading the ball and tapping a choice
already located (keys 1 to 4 on the laptop). Stage A has no clock. T-2 shortens
the visible flight, not the clock. Two additions make this checkable and
tunable (N-5):

```js
// app/src/store/settings.js
export const DEFAULT_SETTINGS = Object.freeze({ /* existing */ chooseTimeScale: 1 });
// 1, 1.25, 1.5 or 2. Settings label: "Time to choose on timed cards".

// app/src/ui/card-view.js
// designWindowMs: response_window_ms x stage.windowScale (unchanged; drives the rating suggestion)
// windowMs:       designWindowMs x settings.chooseTimeScale (drives the clock and the timeout)
// suggestRating({ correct, responseMs, windowMs: designWindowMs })   a stretched clock never inflates ratings
```

The Progress view reports timeouts on timed cards separately from wrong answers
(`timedTrend().timeouts`). If timeouts cluster on cards with four long choices,
the fix is the multiplier or shorter choices (the validator already warns above
60 characters), never a later freeze.

### 4.2 Track D2: progress statistics (T-5) and Track D3: drill ranking (N-2)

```js
// app/src/stats.js  (pure; no DOM, no storage)

// Trend of response times on timed cards. Only stage B and C logs count:
// stage A has no clock and runs in slow motion, so its times are not comparable.
// early = first k logs by reviewed_at, late = last k, k = min(window, floor(n / 2)).
export function timedTrend(logs, { window = 10 } = {})
// logs: progress log entries (any order) of timed_decision cards with response_ms != null
// -> { n, timeouts, earlyMedianMs, lateMedianMs, deltaMs, earlyAccuracy, lateAccuracy } | null when n < 6
//    timeouts: logs with choice == null (time ran out before a choice), so a search problem shows up as such

// One row per topic (principle.topic, falling back to principle.category).
// Only cards present in the current deck count; logs for unknown cards are ignored.
export function topicStats(index, progress, { scheduler = null, now = new Date(), window = 10 } = {})
// -> Array<{
//      topic, category,
//      cards,            // cards in the deck under this topic
//      seen,             // cards with a non-new FSRS state
//      choiceReviews,    // logs with correct != null
//      accuracy,         // correct / choiceReviews, null when 0 reviews
//      lapses,           // sum of fsrs.lapses over seen cards
//      retrievability,   // mean scheduler.retrievability(state, now) over seen cards; null without a scheduler or no seen cards
//      timed,            // timedTrend() over this topic's timed_decision logs (stage B and C)
//    }>
// sorted weakest first: retrievability ascending with nulls last, then accuracy ascending, then topic

// Drills ranked by the weakness of what they train.
export function drillPlan(index, progress, { scheduler, now = new Date() } = {})
// -> Array<{
//      drill,     // principle with category 'drill'
//      cards,     // its drill_recall cards (for preview links)
//      trains,    // Array<{ principle, retrievability, lapses, seen }>, from drill.trains, unknown ids skipped
//      weakest,   // the trains entry with the lowest retrievability among seen ones, or null
//      score,     // weakest.retrievability, or null
//    }>
// sorted: score ascending (lowest retention first); null scores after, by drill.priority descending
```

Views, in `app/src/ui/views.js`:

```js
export function renderProgress(root, app)
// route #/progress, one view in three parts: the headline (timedTrend over all timed logs, with timeouts),
// a table from topicStats, and a Drills section (one block per drillPlan entry: statement, action, what it
// trains with retention percentages, links to preview its cards). Plain HTML tables and lists.
```

Navigation: `app/src/ui/chrome.js` gains one link, Progress, so the topbar holds
Cards, Lab, Progress and Settings; Lab hides below 900 px, where it is not
useful. `renderHome` also links to Progress next to "Browse all N cards".

Data contract: nothing new is stored. `principle.topic` becomes load-bearing
for grouping; it stays optional in the schema (fallback to `category`). The
sample deck's drill principle gets `trains: ["p-below-net-reset"]` so the
drills section and the existing summary suggestion are exercised by tests.

### 4.3 Track D4: the last court cue on Home (N-3)

```js
// progress.settings (synced, newest updated_at wins; schema leaves settings open)
{ updated_at: '2026-10-01T18:12:00.000Z', last_cue: { text: 'Below the tape? Stay soft.', card_id: 'c-dink-fp-1', at: '2026-10-01T18:12:00.000Z' } }

// app/src/ui/session.js
function focusCue(results)  // -> { text, card_id } | null   (was: string | null)
// endBatch: when a cue exists, write progress.settings.last_cue and settings.updated_at, then saveProgress.

// app/src/ui/views.js renderHome: shows "Take this to the court" with last_cue.text when present.
```

`schemas/progress.schema.json` documents `settings.last_cue` (optional; no
version bump).

### 4.4 Track E1: deck cache outside localStorage

```js
// app/src/deck.js
export const DECK_CACHE_KEY = 'piq.deck.cache.v1';        // kept only as the migration source and the no-Cache-API fallback
export const DECK_CACHE_NAME = 'piq-data-v1';             // must not start with 'court-sense-' (sw.js deletes those on activate)
export const DECK_CACHE_REQUEST = './piq-cache/deck.json'; // synthetic key inside the Cache Storage API

export async function cacheDeck(deck, { caches = globalThis.caches, storage = globalThis.localStorage } = {})
export async function readCachedDeck({ caches = globalThis.caches, storage = globalThis.localStorage } = {})
// -> deck | null. Uses Cache Storage when available, else storage (tests, old browsers).
//    On first read with Cache Storage present, moves a localStorage copy into the cache and removes the key.

export async function loadDeck({ storage, caches, fetchImpl, samplePath } = {})  // same result shape: { deck, source, error }
```

`app/src/sync.js` awaits `cacheDeck`. Settings shows the size of this device's
progress ("1,234 reviews, 0.4 MB") next to the review count, as the early
warning for E3.

### 4.5 Track E2: fetch the deck only when it changed

```js
// app/src/store/github-sync.js
client.getTextIfChanged(path, etag)
// -> { status: 'changed', text, etag } | { status: 'unchanged' } | { status: 'missing' }
//    Sends If-None-Match when etag is set; 304 -> unchanged; 404 -> missing.

export async function pullDeck(client, path = 'deck/deck.json', { etag = null } = {})
// -> { deck, etag } | { unchanged: true }; throws the existing "Run build-deck" error when missing

export const DECK_ETAG_KEY = 'piq.deck.etag.v1';   // localStorage, next to the cached deck
```

If GitHub does not answer 304 for the raw media type (assumption A3), the
fallback is `client.getMeta(path)` using `application/vnd.github.object+json`
(returns `sha` and `size` without content for files over 1 MB) and comparing the
sha; decided during C5.

### 4.6 Track E3: progress store (deferred until the trigger in section 6)

```js
// app/src/store/kv.js   (async key-value with three implementations, same shape)
export function memoryStore()                          // tests
export function localStorageStore(storage = globalThis.localStorage)   // migration source
export function idbStore({ db = 'piq', store = 'kv' } = {})            // IndexedDB
// each: { get(key) -> Promise<string | null>, set(key, text) -> Promise<void>, remove(key) -> Promise<void> }

// app/src/store/progress.js
export async function loadProgress(store = defaultStore())   // one-time move of piq.progress.v1 from localStorage
export function saveProgress(p, store = defaultStore())      // sets p.updated_at now; the write is queued (last write wins); returns the promise
```

`savePending`, `takePending` and `clearPending` stay in localStorage: they are
tiny and are read synchronously at boot. `syncNow` awaits the queued write before
uploading. Export and import are unchanged.

### 4.7 Track F: video sources (N-1)

```yaml
# pipeline/config/sources.yaml
shows:
  - id: <slug>                 # short, permanent: it is the prefix of every episode and tip id
    name: <channel name>
    kind: youtube              # default rss
    youtube: https://www.youtube.com/@<handle>
    notes: ...

# pipeline/config/piq.yaml
youtube:
  command: yt-dlp
  audio_format: m4a
```

```python
# pipeline/piq.py
def list_youtube(ctx: Ctx, show: dict, known: dict[str, dict]) -> list[dict]:
    """Episode records for a channel. Flat listing for video ids; for ids not in `known`
    (the existing manifest, keyed by guid), one `yt-dlp --dump-json --skip-download`
    per video for upload_date, description and duration. Records use the parse_feed()
    keys: id = episode_id(show_id, upload_date, video_id), guid = video_id, title,
    number = None, published, audio_url = None, link = watch URL, duration, show_notes =
    description, transcripts = [], plus video_url = watch URL."""

def download_youtube(ctx: Ctx, ep: dict, dest_dir: Path, pause: float) -> Path:
    """yt-dlp -x --audio-format <cfg> -o "<dest_dir>/<ep id>.%(ext)s" <video_url>; .part handling is yt-dlp's own."""

# cmd_feeds dispatches on show.get("kind", "rss") and merges by guid so ids never change.
# cmd_download dispatches on ep.get("video_url") when audio_url is None.
# stage_state, prepare, extract, build_deck: unchanged (build_deck already uses ep["link"] as the episode url).
```

```js
// app/src/ui/provenance.js
export function timestampUrl(url, hhmmss)
// youtube.com/watch and youtu.be links get &t=<seconds>s (or ?t= when there is no query); other urls are returned unchanged.
// sourceLines() uses it for the Episode link, so a video source opens at the moment the tip was said.
```

Prompt additions (rules, not code): `prompts/extract-tips.md` gains "When a tip
depends on something shown rather than said ('like this', 'watch the wrist'),
extract only what was said and set `needs_review` with the reason 'visual
demonstration'". `prompts/speaker-map.md` gains a paragraph for single-presenter
videos (map the label to the channel owner only with spoken evidence, as now).

Registry: new pro speakers are added to `pipeline/config/speakers.yaml` only
after Jeremy verifies credentials (unchanged rule). A coach-run channel
(`elite_coach`) yields no deck content on its own under the endorsement rules,
so only pro-run channels are worth adding.

### 4.8 Track G, one line each

- T-1 read-the-shot cards: optional `card.asks: "response" | "read"` (default
  `response`) on `timed_decision` cards; `read` cards freeze before the
  opponent's contact and the post-answer replay uses `play(0, { toEnd: true })`.
- T-3 drag model: `makeArc(from, to, opts)` keeps `{ p0, p1, h, crosses, tNet,
  at, warnings, actualClearanceIn }`; only the height profile changes.
- T-4, T-6: content and prompt rules on the existing scene schema.
- Phase 6 suspend and edit: `setSuspended` already exists in `progress.js`.
- Weak-topic practice: `planBatch` gets an optional `topics` filter and reuses
  `topicStats`.

### 4.9 Track H: the VM as a worker (N-6)

Machine-specific pipeline settings move out of the shared config, which the
laptop needs as well (Track A4):

```python
# pipeline/piq.py
def load_config(path: Path) -> dict:
    """piq.yaml with piq.local.yaml from the same directory merged over it, one level deep:
    top-level scalars replace, top-level dicts merge key by key. piq.local.yaml is gitignored and
    holds what differs per machine: transcribe.device, compute_type, batch_size, command, data_dir."""
# Ctx.__init__ calls load_config; nothing else changes. pipeline/config/piq.local.example.yaml documents it.

# cmd_list gains one flag for unattended runs:
#   list --stage extract --pending --skip-flagged
#   leaves out episodes whose speaker map has needs_review: true; those wait for Jeremy on the laptop.
```

```bash
# pipeline/cron/new-episodes.sh   (runs on the VM from cron; usable by hand for the backlog)
# Environment from ~/.config/piq/env (chmod 600): HF_TOKEN, PIQ_CODE_DIR, PIQ_DATA_DIR,
#   PIQ_MAX_EPISODES (default 2), PIQ_RUN_CLAUDE (default 0).
# 1. flock on $PIQ_DATA_DIR/.cron.lock; exit quietly if a previous run is still transcribing.
# 2. git pull --rebase in the data repo.
# 3. piq.py feeds; then for at most PIQ_MAX_EPISODES episodes from `list --stage download --pending`:
#    download, then transcribe (CPU settings from piq.local.yaml).
# 4. If PIQ_RUN_CLAUDE=1: for each `list --stage speakers --pending`, `claude -p` with the map-speakers
#    skill; prepare; for each `list --stage extract --pending --skip-flagged`, `claude -p` with the
#    extract-episode skill. Allowed tools limited to Read, Grep, Write and Bash for `python pipeline/piq.py`.
# 5. git add work/episodes work/transcripts work/speakers work/prepared work/tips; commit; push, with
#    one pull --rebase and retry if the app committed a progress file in between.
# The VM writes only these paths. The laptop owns work/review, content and deck; the app owns progress.
# Logs go to ~/piq-logs/, outside both repositories. A run with nothing new still commits the refreshed
# manifests; that is harmless.
```

Steady state after Track E: the job runs daily at 03:00 with `PIQ_MAX_EPISODES=2`.
Jeremy, when he has time: `git pull` in the data repo, `/review-queue`,
`/merge-principles`, `/generate-cards`, `validate`, `build-deck`, push; the app
picks up the new deck at its next sync. The same script with
`PIQ_MAX_EPISODES=200` and `PIQ_RUN_CLAUDE=1`, started by hand in `tmux`, is the
loop host for Track E4. One optional trim while there: `cmd_transcribe` writes
every WhisperX output format, and only the JSON is read, so `--output_format
json` would keep the data repo several times smaller.

## 5. Assumptions

Flagged C where a wrong assumption changes correctness, S where it changes only
schedule or scope.

| Id | Assumption | Flag | If wrong |
|---|---|---|---|
| A1 | The PRD's decisions Q1 to Q8 stand (pro tiers, implicit endorsements kept, no caps, reduced motion respected, own origin) | C | Content rules and session behavior change; nothing in this plan depends on reversing them |
| A2 | Phone is an iPhone with Safari, laptop runs Chrome (PRD section 3). Both support Cache Storage and IndexedDB; iOS Safari's localStorage quota is treated as 5 MB shared by the origin | C for E1 timing | If the quota is larger, E1 and E3 can wait longer; the design is the same |
| A3 | GitHub contents API: raw reads work up to 100 MB; `If-None-Match` returns 304 on the raw media type; PUT accepts files of several MB | C for E2, S for progress growth | C5 verifies with throwaway requests; E2 falls back to the sha comparison; a PUT limit would force splitting progress files, which changes the merge and needs its own design |
| A4 | WhisperX large-v3 runs on the 6 GB GTX 1660 Ti with `batch_size: 4` (`int8` if float16 runs out of memory); a Windows CUDA install may need the cuDNN wheel (`nvidia-cudnn-cu12`) on PATH, and WhisperX's pins may not accept the laptop's Python 3.13, so its venv should use 3.12; roughly 10 to 20 minutes per hour of audio | S | The VM (Track H2) is the fallback: an easy Linux install, but CPU only, around real time or slower, so about a week of unattended work for the corpus; a smaller model (`large-v3-turbo` if the installed WhisperX supports it) is the other lever; the pilot's dry run and first episode decide |
| A5 | A review log entry is about 330 bytes; 20 to 40 cards a day is 2.4 to 4.8 MB a year | C for when E3 triggers | The Settings size readout (E1) makes the real rate visible |
| A6 | The full corpus yields roughly 600 principles and 1,500 cards, a deck of 3 to 6 MB (3.1 KB per card in the sample deck) | C for E1 | Any deck over about 2 MB already needs E1, so the conclusion holds for any plausible corpus |
| A7 | Replay-from-full-history stays the merge rule; logs are never compacted | C | Compaction would need a per-card base state and a floor agreed across devices; not planned |
| A8 | `merge-principles` fills `principle.topic` (the prompt asks for it; the schema leaves it optional) | S | Progress rows fall back to `category`, which is coarser but correct |
| A9 | Timed-card response times are comparable only within stages B and C (clock starts at the freeze; stage A is untimed and slowed) | C for T-5 | `timedTrend` excludes stage A by contract; if the earlier freeze in C skews trends, report B and C separately |
| A10 | On hold with Track F (Q9). When revisited: Jeremy is comfortable downloading YouTube audio with yt-dlp for personal study (YouTube's terms restrict downloading) and names pro-run channels whose credentials he verifies | S | Track F stays parked; nothing else depends on it |
| A11 | Freeze leads of 120 ms (B) and 250 ms (C) are starting values | S | Tune in the lab with the pilot's timed scenes; the clamp keeps every card playable |
| A12 | One user, two devices, each device writes only its own progress file (D6) | C | A third device works the same way; concurrent tabs on one device already refresh the sha once |
| A13 | The Pages site is served from a free organization's origin (Q7, D14); the repository name is free | S | A personal-account project site would share storage with the other Pages project, which the PRD rules out |
| A14 | The pilot show stays Pickleball Cheat Code, first five episodes (`/run-pilot cheatcode 5`) | S | Any show in `sources.yaml` works; only the speaker map evidence differs |
| A15 | Every Claude step runs inside Claude Code on the subscription: the interactive skills, subagents, and the headless `claude -p` loop. Claude Code bills per token only when it runs on an API key, so `ANTHROPIC_API_KEY` stays unset (it is unset today) and `extract-api` is never run. Quality is not the trade-off: the subscription runs the same or stronger models than the API path. Pace is: plan usage limits spread the corpus over more days | C for cost | If a headless run ever prompts for or picks up an API key, stop and fix the environment first; if usage limits make the corpus slow, the answer is more days, never money |
| A16 | GitHub Pages is free only for public repositories, and the PRD wants the app on its own origin (Q7, D14). The repository is on the personal account; Jeremy will make it public and has no organization | C for token isolation | Q13 decides between a free organization, the personal account with the shared-origin risk accepted, or a free static host with its own origin. Whichever it is, the token stays scoped to one private repository with an expiry, so the worst case is exposure of the deck and progress, not of anything else |
| A17 | Reading time stays off the clock (Q5): choices are read before Play and keep their positions at the freeze | C for timed cards | If real use still produces timeouts before a choice is found, raise `chooseTimeScale` (N-5) or show fewer choices on timed cards; never lengthen the freeze |
| A18 | The VM is disposable: everything it produces is committed to the data repo, and audio can be re-downloaded. Oracle may reclaim Always Free instances that stay idle for a week (95th-percentile CPU under 20 percent) on accounts never upgraded to pay-as-you-go; a daily job of an hour or two does not change that | S | Reclamation costs a rebuild from the H1 checklist, nothing else; upgrading the account to pay-as-you-go removes the rule and stays free for these resources |
| A19 | WhisperX, ctranslate2 and PyTorch have Linux aarch64 wheels, and Claude Code has a Linux ARM64 build whose subscription login works over SSH without a browser on the VM | S for H2 and H3 | If a wheel is missing, H2 uses a smaller model or is dropped; if Claude Code cannot log in headless, H3 runs on the laptop and the cron stays mechanical |

## 6. Implementation plan

Each track lists steps, who does them (Claude Code unless marked Jeremy),
verification, and exit criteria. Commit after each step that changes code, with
the requirement id in the message.

### Track A: repository and environment (one session, Jeremy needed for accounts and tokens)

| Step | Work | Verify |
|---|---|---|
| A1 | Done by Jeremy: initialized, one commit ("Initial commit", 112 files, this plan included), pushed. `node_modules`, `.venv`, `app/data/deck.json` are ignored | Verified: clean working tree, ignores in force |
| A2 | Done 2026-09-28: organization `jeremys-apps` created, repository transferred and made public, Pages source set to GitHub Actions, workflow run by hand and succeeded (the push-triggered run before that setting had failed, as expected). This clone's remote repointed | Verified through the API and by fetching the site: https://jeremys-apps.github.io/pickleball-iq/ serves the sample deck, `lab.html` opens, the deployed manifest matches this clone; Jeremy sees it on the laptop and the phone |
| A3 | Done 2026-09-28: `ViciousJ/pickleball-iq-data` created private on GitHub by Jeremy; initialized locally at `../pickleball-iq-data` with the ignore rules (audio, spot-check clips, partial downloads, the cron lock) and `origin` attached; first push by Jeremy, since the permission system declines pushes from this session. The fine-grained token waits until the pilot deck exists (Track C) | `python pipeline/piq.py status` reports no manifests yet rather than a missing directory |
| A4 | Done 2026-09-28. Config overlay landed with tests. WhisperX environment in `.venv-whisperx` on Python 3.13 (within WhisperX 3.8's range, so no second Python): PyTorch 2.8.0 with CUDA 12.8 from the PyTorch index, then `pip install whisperx`; CUDA sees the card; all twelve flags verified against `whisperx --help`. Jeremy: read token, terms accepted on `pyannote/speaker-diarization-community-1`, `HF_TOKEN` as a user environment variable. Laptop overlay: `batch_size: 4`, `float16`, the venv's `whisperx` path. A failed run now reports the command with the token masked (was: raw CalledProcessError) | Dry run prints the command with the token masked; the first real episode runs on the GPU with about 5.1 of 6 GB in use, so `float16` with batch size 4 fits |
| A5 | Optional: `gh` CLI (repository creation and transfer from the terminal). No `yt-dlp` while Track F is on hold | `gh auth status` |
| A6 | Docs: README step 0 (`git init`), pipeline README GPU-memory paragraph and the Windows cuDNN note, PRD section 3 machine facts and test date | Read-through |

Exit: repository online, Pages live on the sample deck, data repo cloned, WhisperX
dry run passes.

### Track B: the pilot (PRD Phase 1; two or three sessions plus transcription time)

Run `/run-pilot cheatcode 5` and follow `.claude/skills/run-pilot/SKILL.md` as
written. Environment-specific points:

| Step | Work | Notes |
|---|---|---|
| B1 | `feeds`, `status --show cheatcode --oldest-first --limit 5`; Jeremy confirms the five titles or swaps one | Skip an episode that is mostly introductions |
| B2 | `download`, then `transcribe` in the background with a log | Expect one to two hours on this GPU (A4). If the first episode runs out of memory, set `compute_type: int8` and rerun with `--force` |
| B3 | Per episode, fresh context: `/map-speakers`, `prepare`, `/extract-episode`. Subagent per episode | Stop for Jeremy if a speaker map needs review |
| B4 | `/review-queue`: Jeremy decides, or accepts recommendations batch by batch | Recommendations stay conservative |
| B5 | `/merge-principles`, `/generate-cards`, `validate`, `build-deck`, `check-scenes`; open the lab and check two or three new scenes from both cameras at both sizes | Fix scene errors before the deck |
| B6 | Done 2026-09-30 after three samples (7, 8, then 9 of 10 fully right); each miss became an extraction rule and a fix, and `--fresh` kept the samples disjoint | Pass at 9 of 10 (P-12 pilot criterion). On failure, find the cause (transcription, speaker map, extraction), fix, rerun the affected steps |
| B7 | Jeremy confirms; commit and push the data repo (audio and clips stay ignored) | `git status` in the data repo shows no audio |

Exit (PRD Phase 1): spot-check passed, every pilot scene passes
`tools/check-scenes.mjs` and looks right in the lab (AC-6, AC-7), `deck/deck.json`
pushed. Record the card mix that `build-deck` prints; it tells Track D2 which
topics exist.

Progress 2026-09-28: feeds resolved (70 episodes of 4.0 to Pro, 51 of Cheat
Code, five of those with publisher transcripts). Jeremy kept all five episodes,
introductions included, to learn what they hold: the two trailers transcribed,
mapped and prepared with no tips in them. The three instructional episodes
took about 25 minutes each on the GPU; speaker maps came back at high
confidence for both hosts, flagged only for crosstalk merges; extraction gave
131 tips (91 pro-stated, 30 endorsed, 8 qualified, 2 refuted; strategy 68, form
37, mental 10, drill 7, partner 6, equipment 3) with 31 flagged. Jeremy walked
the queue in six batches: 18 approved, 11 rejected, 1 edited, 1 deferred.

Later on 2026-09-28: after the re-transcription, 8 recovered-passage tips were
added and 88 existing tips re-checked (no status drops; one upgrade by Jeremy;
housekeeping edits), the queue emptied at 44 decisions, and the merge produced
92 principles (strategy 49, form 25, drill 8, mental 5, partner 4, equipment 1;
27 condition-dependent tensions; every drill linked). Card generation ran as
four subagents by category: 178 cards (why 74, text_mc 41, scenario_mc 27,
form_cue 14, timed_decision 13, drill_recall 9) and 40 scenes (39 mirrorable),
scene checker clean, validator clean, `build-deck` wrote a 454 KB deck with
the mix strategy 50 percent, form 31, drill 9, mental 4, partner 4, equipment
1. The spot-check page with ten clips is cut. Remaining for Phase 1: Jeremy's
listening spot-check, the deck pushed, the token in the app, and a look at a
few court cards in the app's card browser. Usage limits cut subagents off
twice; both times the work resumed after the reset with nothing lost.

First spot-check, 2026-09-28 evening: 7 of 10 fully right, below the gate.
Attribution was right on all ten and the endorsement label on nine; every
miss was a dropped condition. Two of the three were the spot-check page's
fault: the tips carried the condition in `cue` or `conditions`, which the page
did not show. One was real: Brodie's open-stance serve merged as universal
advice instead of "if you serve from an open stance". Fixes: the page shows
cue and conditions; the extraction, merge and card prompts now say that a
condition which selects the advice goes into the situation and statement, and
that a personal method is advice only for players who use it; the open-stance
principle reframed; a bounded audit of all 92 principle statements for the
same defect; then a second spot-check on a fresh sample.

Second spot-check, 2026-09-29: 8 of 10 fully right, still below the gate.
Attribution right on all ten, two labels wrong, and two of the eight carried
substantive notes. Four causes, one tip each: Brodie restating Tanner's
just-stated serve tip became a separate tip with a weaker label; Tanner's
end-of-episode "you hit everything on the head" was counted as explicit
endorsement of one point from Brodie's opening; a refuted claim was worded as
advice plus a reason, so it read as half right; and Brodie's private term
"disconnected" reached a card unexplained. Fixes: five decisions recorded (one
rejection folded into Tanner's tip as a condition, four edits), four
principles and six cards rewritten, and four prompt rules added (a non-pro
restating a pro's point is folded into the pro's tip; blanket agreement with
a summary is implicit; a refuted claim is worded as the rejected claim; a
speaker's private term is explained in plain words, in all three prompts).
The spot-check page now shows edited tips as the merge reads them, cuts a
second clip when the label's evidence lies outside the first, names refuted
claims as such, and `--fresh` keeps tips Jeremy has already heard out of the
sample. A scan of all 139 tips found no second instance of any of the four
defects. Third spot-check cut from unheard tips.

Third spot-check, 2026-09-30: 9 of 10 fully right, passed. Speaker and label
right on all ten. The miss: Brodie's drop-heavy third-shot mix, framed as
advice for everyone against top-level players when Jeremy heard personal
preference on both sides and a shared message, go with your strength. The
principle now says that, with Brodie's and Tanner's mixes as its two examples
and Tanner's weapon-drive rule linked. One wording note applied: the crash
split step states its timing without "not at your partner's contact". AC-6
passed; Phase 1 now waits only on the lab look at the pilot scenes (AC-7).

Finding: the flags blamed on "ad-break gaps" were not ads. Jeremy listened and
the speech was there; WhisperX had replaced whole 15 to 30 second chunks with a
sign-off line, about 7 percent of each episode. A controlled re-run of one gap
showed the vocabulary prompt (P-3) as the cause: without it the chunk
transcribes fully; hotwords fail the same way; the other voice detector and
int8 are worse; batch size makes no difference. The prompt is now off by
default with a test, the three instructional episodes are being re-transcribed
without it, and the plan for the recovered speech is: re-map speakers,
re-prepare, then extract tips only from the recovered passages and append them
as new flagged tips, so the 30 decisions already made stay valid.

### Track C: real devices and real sync (PRD Phases 2 and 3 remainders; one or two sessions)

| Step | Work | Criterion |
|---|---|---|
| C1 | Phone: connect the data repo in Settings, install to the home screen, run a full session by touch. Laptop: run a full session by keyboard | AC-2 |
| C2 | Timed cards on the phone: choices lock until the freeze, the clock drains, a timeout suggests Again | AC-3 |
| C3 | Airplane mode after one online visit: the app opens and runs a session | AC-4 |
| C4 | Export a progress backup first. Review on the phone, sync, open the laptop, sync: reviews appear. Review the same card on both before syncing: the merged state equals a replay. Token-expiry drill: revoke the token, confirm the error text, enter a new one | AC-5 |
| C5 | Verify assumption A3 with throwaway requests against the data repo: a conditional GET with `If-None-Match` on `deck/deck.json` (expect 304) and a PUT of a 5 MB scratch file, deleted afterwards. Choose the E2 strategy | Findings recorded in `docs/decisions.md` |
| C6 | Fix what real use reveals (layout at 360 px, safe areas, sticky ratings, font loading, sync messages). Guard `window.scrollTo` for jsdom while there | Each fix: test, `npm run sw`, commit |

Exit: AC-2 to AC-5 marked passing on devices in the PRD. Daily use begins here.

Progress 2026-09-28: the first fix from real use, before the pilot deck exists.
Jeremy's look at the lab on the laptop and the phone showed the picture scaled
to the full column width, pushing Play and the panels out of view. Reworked:
settings on top and collapsible, a motion bar with Play directly above the
picture, and on laptops the picture capped by the window height with the panels
beside it. Lab-only change, with the lab's first jsdom smoke test.

Progress 2026-09-30: Jeremy's first notes from the phone on the pilot deck.
Play stayed on the picture through the animation because `.btn`'s
`display: inline-flex` beat the `hidden` attribute, so buttons and the session
bar never hid when the code hid them (Play, Show answer, the Top-down toggle in
stages B and C, the session bar at the summary); one global `[hidden]` rule
fixes all of them. Play and the replay now share one spot under the picture, so
the replay starts with the court in view. The timed hint drops the no-clock
sentence and shows the time to choose in bold; on phones the text under the
question is 1 pt larger; the sources and Claude's note fold under Source info,
with the note relabeled "Additional note" (D24). Checked in Chrome at 390 px and
at laptop width. Content fixes in the data repo: "net tick" became "the top of
the net" in five explanations; the stay-down card asks for Tanner's fix, so its
wrong answers are wrong, and "rising up" replaces his "popping up" across the
principle; the split-step cards say the drop crosses the net to the opponent's
side. An audit of all 81 choice cards found no other wrong answer that restates
the correct one. Each defect became a prompt rule.

Progress 2026-10-02: Jeremy's second round of phone notes. The static card's
replay button said Replay although nothing had played, and during the replay the
answer arrow rode along on the moving ball, because the renderers anchored it at
the ball's position in the frame. Now every frame carries the contact point, the
arrow starts there, and Watch the play runs in two halves: their shot arrives
with the overlay hidden, then the answer shot flies from contact to its target
with its path growing behind the ball (D25); Watch again on timed cards does the
same at the end. The mirrored-card note under the reveal is gone, the topbar
marks the tab you are on (Court Sense is the Home tab, and was bold on every
page before), the two body text sizes grew a point on every screen, and the
Source info fold says when a note is inside. Content fixes in the data repo: the
arc-the-reset scene lands the reset toward the middle between the opponents, as
Tanner's crosscourt rule says, instead of at the feet of the player in front;
the reach question says you have time to get to the ball; and the three
arc-the-reset cards explain "cupping upward" in plain words, with Claude's
reading of the mechanics in their notes. A request to write pros' full names in
card text was withdrawn before it was applied.

Progress 2026-10-03: Jeremy's third round of phone notes. A batch set to five
cards grew to six and seven ("Card 5 of 6", then "Card 6 of 7"), and a card rated
with a 10-minute wait came back as card 6 two minutes later. A card rated with a
wait under twenty minutes went back into the same batch, and when no such wait
was over the next pick took one anyway; planning also counted learning cards due
within twenty minutes as due. Now a batch keeps the cards planned for it, each
shown once, and a card returns in the first batch planned after its wait is over
(D26, A-1, A-5). A choice sometimes looked selected when a card opened: on the
phone, the tap that started the batch left the hover style on whatever choice
appeared under the finger. Hover styles now apply only where a pointer can hover.

Progress 2026-10-05: people (A-11, D27). Jeremy asked for his family to use the
app without touching each other's progress. A device now asks for a name once;
the name as a slug is the person's id and their folder in the data repo
(`progress/<person_id>/<device_id>.json`), and the device keeps one record per
person under `piq.progress.v1.<person_id>`. Home says who is playing with links
to switch; Settings lists the people with Switch, Remove and Add, and adding
someone switches to them. Sync reads only the current person's folder and runs
again after a switch; merge and import refuse a record that names someone else;
an unrated answer waits under its person's key. On an upgraded device the first
name typed adopts the record from before people existed, device id included, so
the data repo's two files moved into `progress/jeremy/` to meet it. Assumption
A12 (one user) is superseded. Eight new tests: the registry, the per-person
keys, the adoption, the merge and import guards, two people on one fake repo,
the first screen, and a switch in Settings and on Home.

### Track D: features the goal implies (two or three sessions; runs alongside B and C)

| Step | Work | Tests |
|---|---|---|
| D1 (T-2, N-5) | Done 2026-09-28, 55 tests passing. `freezeLeadMs` on the stages, clamped early freeze in `compileTimeline`, `play(0, { toEnd: true })` for the post-answer replay, lab control, prompt sentence about minimum last-segment length; `chooseTimeScale` in Settings applied to the clock only; PRD 8.4 gains a Freeze column and A-8 the new setting, T-2 marked built, decision D21 | `compileTimeline(occlusionScene, { freezeLeadMs: 250 }).freezeAt === 2080`; the clamp on a scene with a short last segment; `applyAidPreference` keeps the lead; a card-view test that stage C freezes earlier than stage A and that the replay reaches the end; a card-view test that a 2x multiplier doubles the timeout and leaves the suggested rating unchanged |
| D2 (T-5) | Done 2026-09-28. `app/src/stats.js` with `timedTrend` and `topicStats`; Progress view and route; nav rules; PRD section 8.11 (N-4 Progress view) and T-5 marked built | Median and window arithmetic on synthetic logs; stage A logs excluded; unknown cards ignored; topic fallback to category; ordering; a jsdom render with the sample deck after a batch |
| D3 (N-2) | Done 2026-09-28. `drillPlan`; the Drills section inside the Progress view; `trains` added to the sample drill principle; PRD Phase 6 item moved to built | Ranking with two drills where one trains a lapsed principle; drills without seen targets sort last; render smoke test |
| D4 (N-3) | Done 2026-09-28. `focusCue` returns the card; `endBatch` stores `last_cue`; Home shows it; schema documents it | After a batch, `progress.settings.last_cue.text` equals the summary cue; Home renders it; merge keeps the newer cue |

All four: `npm test`, `npm run sw`, decisions.md entries (D21 earlier freeze by
maturity; D22 progress views derive from the log, the only stored addition is
the last cue), PRD status rows.

### Track E: scale (one session before the corpus, then the corpus itself)

| Step | Work | Trigger and tests |
|---|---|---|
| E1 | Done 2026-09-30. Deck cache in Cache Storage with localStorage migration; Settings size readout; PRD 8.7 updated; decision D23 (deck cache off localStorage; logs never compacted, A7) | Before the first deck over 1 MB. Tests with an in-memory `caches` stub: write, read, migrate, fallback without `caches` |
| E2 (optional) | `getTextIfChanged`, `pullDeck` with etag, the etag key; sync skips re-indexing when unchanged | Only if deck pulls feel slow on the phone after E1; a few MB per sync on Wi-Fi is acceptable. After C5 decides ETag or sha. Fake-API test returns 304 on a matching `If-None-Match` |
| E3 | `kv.js` with the three stores; `loadProgress` async with migration; write-behind `saveProgress`; `syncNow` awaits the queue | When Settings shows progress above 2 MB, or before the second year of use, whichever first. Existing progress, session and UI tests switch to `memoryStore` |
| E4 | Phase 4: `feeds` for both shows, `download` in batches, `transcribe` overnight on the GPU (or on the VM, H2), the headless `claude -p` loop per episode on the laptop or on the VM with `pipeline/cron/new-episodes.sh` (H3; subscription only, Q10), review in batches, merge, cards, deck | Same exit criteria as the pilot per batch of episodes; `build-deck` warnings clean; lab checks on a sample of new scenes |

Progress 2026-09-30: E1 done ahead of its trigger (the pilot deck is 0.46 MB).
`cacheDeck` and `readCachedDeck` in `app/src/deck.js` use Cache Storage
(`piq-data-v1`), move a copy left in localStorage on first read, and fall back
to localStorage where the Cache API is missing; `syncNow` awaits the write.
Settings shows the progress size next to the review count. PRD 8.7 and the risk
table carry the storage numbers; D23 recorded. Seven deck tests run against an
in-memory `caches` stub. Still to see on a real device: the first sync on the
phone after this change moves the old copy and frees localStorage.

Progress 2026-10-05: E4 batches 2 and 3, ten more Cheat Code episodes
(2025-05-07 to 2025-07-09), went through the whole pipeline. Review: Jeremy
accepted every dossier recommendation and listened to the seven tips only the
audio could settle (four of the short agreement lines were Brodie's own).
Merge: 92 to 298 principles, run as four topic-cluster subagents plus a
reconciliation pass; the paddle episode with Chris Olson had no pro present
and stays out of the deck. Cards: 359 new cards and 83 new scenes from six
topic groups, every scene looked at rendered before install; the deck is 537
cards, 123 scenes, 1.6 MB. Spot-checks per batch: 9 of 10 and 10 of 10 fully
right, speaker and label right on all twenty, so both batches pass the pilot
bar. Fixes from the notes went into the tips, principles and cards (Brodie's
"a little out of reach", Tanner's "bait them down my sideline" and his soft
line drive off the short hop). Found on the way: the renderer ignores
`apex_in` on a shot that crosses the net, so the card prompt now gives lobs a
`net_clearance_in`.

Progress 2026-10-06: E4 batch 4, twenty more Cheat Code episodes
(2025-07-16 to 2025-12-03), went through the whole pipeline in one session.
Jeremy swapped the two CRBN paddle episodes in that range for the next two
instructional ones, pre-accepted the review recommendations for this batch, and
approved Thomas Wilson (tennis episode guest) as a touring pro. One agent per
episode mapped the speakers and extracted the tips from a compact segment view;
one agent per two episodes reviewed every tip, not only the flagged ones; five
tips wait for Jeremy's ears. Merge: 298 to 546 principles (248 new, 3 created
struck because Tanner contradicts them), run as seven topic clusters, a
reconciliation pass and a note cleanup. Cards: 432 new cards and 102 new scenes
from eight groups; 17 existing cards changed where the merge reworded their
principle or a new principle made a wrong answer right; a review agent looked
at every new scene at phone size and 13 were fixed. The deck is 969 cards, 225
scenes, 3.1 MB. Spot-check: two pages of ten (one per half of the batch),
waiting for Jeremy. Found on the way and fixed the same day (code 42f028c):
after a timed card was answered, the reveal redrew the static scene
(`frameFromScene` in `card-view.js`), so players the timeline moved snapped
back to their starting spots and a bounce on your side looked like a volley;
it now shows the moment of contact (`contactFrame` in `playback.js`).

Progress 2026-10-09: batch 4 passes its spot-check. Jeremy's five listen
answers were merged first (3 new principles, 2 new sources, 6 cards). The
first page for each half came back 8 of 10 fully right. Both label misses were
Tanner replies the transcript had lost or filed under Brodie: "Love it. No
comment. That's perfect." dropped under Brodie's next words, and a
low-confidence "Love it." under Brodie's label. The wording misses were in the
tips: whose dink set up the shadowing case, "a heavy drive" made plural, and a
plant tied to three options when Brodie tied it to one. Fresh pages, ten tips
each not shown before, came back 10 of 10 and 9 of 10. The one miss there:
Brodie added flashing the Erne after Tanner's answer and went straight on to
the next question, so Tanner never had a chance to answer; that principle is
now `draft` and out of the deck. Each kind of miss became an extraction rule:
check the end of a turn for a lost reply before `no_pro_present` (code
3e5124d); keep the speaker's structure, meaning whose shot, how many and which
option a step goes with (128191a); and a pro's silence is not agreement when a
host closes the discussion before the pro can answer (with this note). Three
older implicit tips had that last shape (the shuffle-volley warm-up, no music
before a match, Brodie's boxer cue). Jeremy listened and Tanner said nothing in
any of them, so they are `no_pro_present` too: two more principles went to
`draft`, and the boxer card, never reviewed, left the content. His other notes
went into the tips, principles and cards ("midcourt depth", Tanner's "it's just
a matter of where it's coming to", all of Brodie's music). The deck is 971
cards from 541 principles, with 225 scenes.

Cost rule (Q10, A15): every Claude step runs inside Claude Code on the
subscription, interactively or through the headless `claude -p` loop in
`pipeline/README.md`. The `extract-api` command is never run; its `extract:`
block in `piq.yaml` stays as documentation only. Before a headless loop, check
that `ANTHROPIC_API_KEY` is unset in that shell. Quality does not suffer: the
subscription runs the same or stronger models. What changes is pace: the corpus
is about 120 transcripts of roughly 15k tokens each, so plan usage limits will
spread it over several days. The loop is resumable per episode
(`piq.py list --stage extract --pending`), so stopping and restarting costs
nothing. Everything else in this plan is free: WhisperX runs locally, the
Hugging Face token and the GitHub organization cost nothing, and Pages is free
once the repository is public (Q13).

### Track F: video sources (on hold by Q9; one or two sessions when reopened, after Track G)

Nothing here starts until Jeremy reopens Q9. The design in section 4.7 is kept
so that the decision can be made with the work known.

| Step | Work | Tests |
|---|---|---|
| F1 | `sources.yaml` `kind`, `piq.yaml` `youtube`, `list_youtube`, `download_youtube`, dispatch in `cmd_feeds` and `cmd_download`, manifest merge by guid | Fixture `pipeline/tests/fixtures/youtube-flat.json` plus a per-video JSON fixture; record mapping, id stability across runs, download command shape with a fake `yt-dlp` on PATH |
| F2 | Jeremy: choose channels and verify credentials; Claude: registry entries, `vocab.txt` names | `validate` accepts tips with the new speaker ids |
| F3 | Prompt rules: visual-demonstration flag, single-presenter mapping; `run-pilot` preflight checks `yt-dlp` when a show is `youtube` | Read-through; one extraction on a real video, spot-checked |
| F4 | `timestampUrl` in `provenance.js`; source lines link to the moment | Unit test on watch, youtu.be and non-YouTube urls; UI test on the Episode link |
| F5 | Docs: `docs/sources.md` channels, PRD 4.1 and 10, pipeline README etiquette (audio for study only, never committed) | Read-through |

Exit: one channel's first videos through the whole pipeline with the same
spot-check bar as the pilot.

### Track H: the VM as a worker (setup any time after A; the daily job after E4)

| Step | Work | Verify |
|---|---|---|
| H1 | Setup on the VM, once: a `piq` user, `git`, `ffmpeg`, a Python 3.12 venv with `pipeline/requirements.txt` and `whisperx` (CPU wheels), a deploy key with write access to the private data repo and a plain clone of the public code repo, `~/.config/piq/env` with `HF_TOKEN` and the paths, `piq.local.yaml` with `device: cpu` and `compute_type: int8`, `.cron.lock` in the data repo's `.gitignore`, unattended security updates. Nothing else lives on the VM | `python pipeline/piq.py transcribe --dry-run` prints a CPU command; a test commit from the VM reaches the data repo |
| H2 | Transcription fallback for Track B or E4: run `feeds`, `download`, `transcribe` on the VM for the chosen episodes, commit, push; continue on the laptop after `git pull` | Transcripts appear in the data repo; `piq.py status` on the laptop shows them |
| H3 | Loop host for E4: Claude Code installed on the VM and logged in with the subscription; `pipeline/cron/new-episodes.sh` run by hand in `tmux` with `PIQ_MAX_EPISODES=200 PIQ_RUN_CLAUDE=1`; review, merge and cards stay on the laptop | `ANTHROPIC_API_KEY` unset on the VM (A15); tips files land in the data repo and pass `validate` |
| H4 | Keeping up (N-6): `pipeline/cron/new-episodes.sh` in the VM's crontab, daily at 03:00, `PIQ_MAX_EPISODES=2`, mechanical stages only until the pilot and E4 have shown headless extraction to be trustworthy, then `PIQ_RUN_CLAUDE=1`. `--skip-flagged` keeps doubtful speaker maps for Jeremy. PRD section 10 gets a steady-state paragraph; decision D25 | A new episode is transcribed within a day of release without anyone touching the laptop; `~/piq-logs/` shows the run; `git log` in the data repo shows the cron commit |

Worth it? H1 is about an hour once and serves all three uses; the code changes
are small (a config overlay, one flag, one script, tests). The VM's value is
that it is always on and Linux, not that it is fast.

Progress 2026-09-28: the code side is done (`--skip-flagged` with a test,
`pipeline/cron/new-episodes.sh`, the worker section in `pipeline/README.md`).
H1 to H4 wait for the VM setup, which needs Jeremy's SSH access.

### Track G: later

T-1 read-the-shot cards (needs D1's `toEnd` replay and the `asks` field), T-3
drag model, T-4 opponent tells where a pro names them, T-6 multi-shot sequences,
suspend and edit from the card browser, weak-topic practice built on
`topicStats`, and a quick-fire pre-game mode (timed cards only, no aids) as an
idea to evaluate after the Progress view shows real trends.

### When the goal is being met

Daily sessions on real content; the Progress view shows timed-read medians
falling or holding at stage C with accuracy steady and few timeouts; weak topics
are visible and the drills section names what to practice; every card still
shows who said it and where.

## 7. Files to modify

New files are marked (new). The data repository's files are not listed; they
are content, not code.

### Track A

| File | Change |
|---|---|
| `.git/` | Done: initialized and pushed by Jeremy; remote updated after the transfer (Q13) |
| `plan.md` | This plan, revised |
| `README.md` | Step 0: `git init` and first commit before the deploy steps; note that the repository must be public for free Pages |
| `pipeline/README.md` | GPU-memory settings for 6 GB cards; Windows CUDA and cuDNN note; the headless loop runs on the subscription with `ANTHROPIC_API_KEY` unset |
| `pipeline/config/piq.yaml` | Comment pointing to `piq.local.yaml` for machine settings, with the 6 GB GPU and CPU examples |
| `pipeline/piq.py` | `load_config` with the `piq.local.yaml` overlay (section 4.9) |
| `pipeline/config/piq.local.example.yaml` (new) | Documented example of the overlay |
| `.gitignore` | `pipeline/config/piq.local.yaml` |
| `pipeline/tests/test_piq.py` | Overlay test: a local file changes `transcribe.device` and leaves the other keys intact |
| `docs/PRD.md` | Section 3 machine facts; status line with the test date |
| `.claude/skills/run-pilot/SKILL.md` | Preflight line: on cards with 6 GB or less, batch size 4 |

### Track B

No code changes expected. Possible: `pipeline/config/speakers.yaml` (additions
Jeremy verifies), `pipeline/config/vocab.txt` (names heard in the pilot),
`prompts/*.md` (only if the pilot exposes a rule gap; each such change is its
own commit with the reason).

### Track C

| File | Change |
|---|---|
| `app/src/ui/session.js` | Guard `window.scrollTo` (jsdom noise) |
| `app/styles.css`, `app/src/ui/card-view.js`, `app/src/ui/views.js` | Whatever phone and laptop use reveals |
| `app/src/store/github-sync.js` | Error text adjustments from the token-expiry drill |
| `app/sw-manifest.js` | Regenerated after any change under `app/` |
| `docs/PRD.md`, `docs/decisions.md` | AC-2 to AC-5 statuses; C5 findings |

### Track D1

| File | Change |
|---|---|
| `app/src/srs/scheduler.js` | `freezeLeadMs` on stages A, B, C |
| `app/src/court/playback.js` | `MIN_FLIGHT_MS`, `compileTimeline(scene, { freezeLeadMs })`, `authoredFreezeAt`, `play(fromMs, { toEnd })` |
| `app/src/ui/card-view.js` | Pass the lead; replay to the end after the answer |
| `app/src/ui/lab.js` | Freeze control and readout |
| `app/src/store/settings.js` | `chooseTimeScale` default (N-5) |
| `app/src/ui/views.js` | Settings field "Time to choose on timed cards" (N-5) |
| `prompts/generate-cards.md` | Minimum last-segment duration note |
| `tests/render.test.mjs`, `tests/scheduler.test.mjs`, `tests/ui.test.mjs` | Tests listed in section 6 |
| `docs/PRD.md`, `docs/decisions.md`, `docs/rendering-notes.md` | 8.4 Freeze column, T-2 built, D21, playback paragraph |
| `app/sw-manifest.js` | Regenerated |

### Track D2, D3, D4

| File | Change |
|---|---|
| `app/src/stats.js` (new) | `timedTrend`, `topicStats`, `drillPlan` |
| `tests/stats.test.mjs` (new) | Unit tests for all three |
| `app/src/ui/views.js` | `renderProgress` with the drills section, Home link and last cue |
| `app/src/ui/chrome.js` | Progress link; Lab hidden below 900 px |
| `app/src/main.js` | Route `progress` |
| `app/src/ui/session.js` | `focusCue` returns the card; `endBatch` stores `last_cue` |
| `app/styles.css` | Table styles for the Progress view; nav visibility below 900 px |
| `app/data/deck.sample.json` | `trains` on the sample drill principle |
| `schemas/progress.schema.json` | Document `settings.last_cue` |
| `tests/ui.test.mjs`, `tests/session.test.mjs` | Render smoke tests; last-cue test |
| `docs/PRD.md`, `docs/decisions.md` | Section 8.11 Progress view (N-4) with its drills section (N-2), Home cue (N-3), the time-to-choose setting in A-8 (N-5), T-5 built, D22 |
| `app/sw-manifest.js` | Regenerated |

### Track E

| File | Change |
|---|---|
| `app/src/deck.js` | Cache Storage read and write, migration, fallback |
| `app/src/sync.js` | Await the cache write; skip re-indexing when unchanged (E2) |
| `app/src/store/github-sync.js` | `getTextIfChanged`, `pullDeck` with etag, `DECK_ETAG_KEY` (E2); `getMeta` only if C5 chooses the sha fallback |
| `app/src/ui/views.js` | Progress size readout in Settings |
| `tests/deck.test.mjs` (new), `tests/github-sync.test.mjs`, `tests/ui.test.mjs` | Cache stub tests; 304 handling |
| `app/src/store/kv.js` (new), `app/src/store/progress.js`, `app/src/main.js`, `app/src/ui/session.js`, `app/src/ui/views.js`, `tests/progress.test.mjs`, `tests/session.test.mjs` | E3, when triggered |
| `docs/PRD.md`, `docs/decisions.md` | 8.7 storage paragraph with the numbers; risk table row; D23 |
| `app/sw-manifest.js` | Regenerated |

### Track H

| File | Change |
|---|---|
| `pipeline/piq.py` | `--skip-flagged` on `list`; optionally `--output_format json` in `cmd_transcribe` |
| `pipeline/cron/new-episodes.sh` (new) | The job described in section 4.9 |
| `pipeline/tests/test_piq.py` | `--skip-flagged` test with a flagged and an unflagged speaker map |
| `pipeline/README.md` | "VM worker" section: setup checklist, env file, crontab line, what the VM owns and what it never touches |
| `docs/PRD.md`, `docs/decisions.md` | Section 5 layout (`pipeline/cron/`), section 10 steady state after Phase 4 (N-6), D25 (the VM runs mechanical stages; everything it makes is in git, so it is disposable) |

### Track F (on hold, Q9)

| File | Change |
|---|---|
| `pipeline/config/sources.yaml` | `kind: youtube` shows |
| `pipeline/config/piq.yaml` | `youtube.command`, `youtube.audio_format` |
| `pipeline/config/speakers.yaml`, `pipeline/config/vocab.txt` | New pros (verified), names |
| `pipeline/piq.py` | `list_youtube`, `download_youtube`, dispatch in `cmd_feeds` and `cmd_download`, manifest merge by guid |
| `pipeline/tests/test_piq.py`, `pipeline/tests/fixtures/youtube-flat.json` (new), `pipeline/tests/fixtures/youtube-video.json` (new) | Tests listed in section 6 |
| `pipeline/requirements.txt` | `yt-dlp` line (or a comment if kept optional) |
| `prompts/extract-tips.md`, `prompts/speaker-map.md` | Visual-demonstration flag; single-presenter mapping |
| `.claude/skills/run-pilot/SKILL.md` | Preflight `yt-dlp` for `youtube` shows |
| `app/src/ui/provenance.js`, `tests/ui.test.mjs` | `timestampUrl` and its tests |
| `docs/sources.md`, `docs/PRD.md`, `pipeline/README.md` | Channels, sections 4.1 and 10, etiquette |
| `app/sw-manifest.js` | Regenerated |

## 8. Decisions

Decided by Jeremy on 2026-09-27:

| Id | Question | Decision |
|---|---|---|
| Q9 | Add video sources? | On hold. Track F stays designed and parked; revisit after everything else is done |
| Q10 | Extraction path for the corpus | Claude Code subscription only; no API calls, ever. Quality is unaffected, pace is (A15, Track E4) |
| Q11 | Earlier freezes as cards mature, 120 ms at B and 250 ms at C? | Yes, on the condition that reading time is never on the clock. It is not (Q5), T-2 does not touch the clock, and N-5 adds a "Time to choose" multiplier plus a timeout count in Progress (section 4.1) |
| Q12 | Progress and Drills views? | Yes, folded into one Progress view with a drills section (section 9) |
| A14 | Pilot on Pickleball Cheat Code, first five episodes? | Yes |

Decided 2026-09-28: Q13, option (a). The organization is `jeremys-apps` and the
app is live at https://jeremys-apps.github.io/pickleball-iq/. Nothing is open.
The question as it stood:

| Id | Question | Default, as taken |
|---|---|---|
| Q13 | Jeremy will make the repository public (needed for free Pages) but has only a personal account. Served from there, the app lives at `viciousj.github.io/pickleball-iq/`, the same origin as the other Pages project on the account (Q7), so any script running on that project's pages could read the sync token from storage. Options: (a) a free organization, which costs nothing and takes two minutes (github.com/organizations/new, Free plan), then transfer the repository; this is what Q7 and D14 already decided. (b) Stay on the personal account and accept the shared-origin risk, bounded by the token's scope (one private repository, Contents only, with an expiry). (c) A free static host with its own origin (Cloudflare Pages or Netlify) deploying the public repository, or the VM itself behind Caddy with a free DuckDNS name; full isolation, but a new account or a web server to keep. | (a). If Jeremy would rather not create an organization, (b), with the risk added to the PRD's risk table and D14 superseded by a new decision that says so |

## 9. Audit against the goal and the PRD, 2026-09-27

Gaps found and closed in this revision: the no-cost rule made explicit (Q10,
A15, Track E4); the repository's visibility and origin flagged (Q13, A16);
reading time on timed cards tied to Q5 and made tunable (Q11, A17, N-5); Track F
parked (Q9); one Progress view instead of two views; E2 made optional. Added on
2026-09-28: Track H folds in the idle Oracle VM as the transcription fallback,
the loop host and the daily job for new episodes, which also closes a gap the
PRD left open after Phase 4.

Deliberately not covered: T-1, T-3, T-4 and T-6 and the Phase 6 extras (Track
G), because they need content or real-use data first; Track F until Q9 reopens.

Coverage: about 90 of 100. Every goal element and PRD phase has an owner, a
verification and an exit criterion. The missing ten points are Q13, which needs
Jeremy, and the checks only real devices and real GitHub can settle (Track C).

Complexity: the plan adds no framework, no service, no paid product and no new
process; it finishes the built system. Simplifications taken: one Progress view
(section 4.2), E2 optional, E3 deferred by trigger, Track F parked.
