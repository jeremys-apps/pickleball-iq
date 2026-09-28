# Court Sense: implementation plan

Written 2026-09-27 against the repository as found (PRD 0.4, CLAUDE.md). PRD
requirement ids (P-, A-, T-, AC-, Q-) are used throughout. Items this plan adds
to the PRD carry N- ids and Q9 to Q12, all proposed, none decided.

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
6. Add video sources, the one part of the goal the PRD leaves out, behind a
   decision (Track F). Later work is listed in Track G.

Dependencies: A before B; B before C; C before E; D runs alongside B and C; F
any time after A; G after E.

## 1. Repository analysis

### 1.1 What exists, verified

| Area | Files | State |
|---|---|---|
| Court renderer | `app/src/court/` (geometry, camera, trajectory, scene, first-person, top-down, playback, mirror, theme) | Built; 14 render and 5 mirror tests |
| Scheduler | `app/src/srs/scheduler.js` over vendored ts-fsrs 5.4.2 | Built; stages A/B/C, rating suggestion, replay |
| Sessions and cards | `app/src/ui/session.js`, `card-view.js`, `views.js`, `chrome.js`, `provenance.js`, `dom.js` | Built; batches, requeues, pending answers, summary with cue and drill |
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
| Git | Not a repository (no `.git`, no history) |
| Data repo `../pickleball-iq-data` | Does not exist |
| Node, Python | Node 24.15, Python 3.13.5 |
| `node_modules`, `.venv` | Were absent; created today for the test runs (both are gitignored) |
| ffmpeg | 8.0 on PATH |
| GPU | NVIDIA GeForce GTX 1660 Ti, 6 GB; `nvidia-smi` on PATH |
| WhisperX | Not installed |
| `HF_TOKEN` | Not set |
| `gh` CLI | Not installed |
| `claude` CLI | Installed (headless loops possible) |
| `yt-dlp` | Not installed (only needed for Track F) |

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
| Videos as a source | Two podcasts (section 4.1). YouTube is "not in the pipeline yet"; `download` reads RSS enclosures only | Real gap | Track F: `kind: youtube` shows resolved and downloaded with yt-dlp, same transcription, speaker and endorsement rules; provenance links jump to the timestamp. Decision Q9 |
| Instinct in fast games | Timed occlusion cards, stage fading, real speed at maturity: built. T-2 (earlier freeze as cards mature) and T-5 (response-time trends) deferred to Phase 5 | The app cannot yet show whether reads are getting faster, and timed cards never get harder to read | Track D1 (T-2) and D2 (T-5, a Progress view). Both are pure app work with no content dependency; promote them to the MVP |
| Drills: what to practice for the fastest improvement | `drill_recall` cards; the batch summary suggests a drill after a miss (A-4); `trains` links drills to principles | No place to ask "what should I drill this week?" | Track D3: a Drills view ranked by the retention of what each drill trains (N-2) |
| Remind me | Spaced repetition; one court cue per batch summary (G5) | The cue is gone once the summary closes | Track D4: keep the last cue on the Home screen and sync it (N-3). Small |
| Form | `form_cue` recall and `text_mc` fix-the-mistake cards; external-focus cues; form taught as the pros' words, not drawn (8.10) | Adequate for a quiz app. Videos add a limit: a demonstration that is shown, not said, cannot be extracted | Track F adds a prompt rule: flag tips that depend on a visual demonstration for review |
| Strategy | Court cards, scenes, formations, mirroring, choice pools: built | None | Content (Track B, E4) |
| Short daily habit | Batches, Keep going, phone layout: built | Unverified on a real phone | Track C |
| Trustworthy, private | Endorsement rules, provenance, private data repo, CSP: built | Unverified against real GitHub | Track C4, C5 |
| Full corpus (about 120 episodes, 70 hours) | Headless loop documented | Two storage limits: the deck cache lives in localStorage (about 5 MB on iOS Safari, shared with progress); progress grows by roughly 2 to 5 MB a year | Track E1 (deck cache to Cache Storage), E2 (fetch the deck only when it changed), E3 (progress to IndexedDB when it nears the limit) |
| Run it here | PRD section 3 assumes a GPU machine | 6 GB GPU; WhisperX not installed; no git; no data repo | Track A |

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

### 4.2 Track D2: progress statistics (T-5) and Track D3: drill ranking (N-2)

```js
// app/src/stats.js  (pure; no DOM, no storage)

// Trend of response times on timed cards. Only stage B and C logs count:
// stage A has no clock and runs in slow motion, so its times are not comparable.
// early = first k logs by reviewed_at, late = last k, k = min(window, floor(n / 2)).
export function timedTrend(logs, { window = 10 } = {})
// logs: progress log entries (any order) of timed_decision cards with response_ms != null
// -> { n, earlyMedianMs, lateMedianMs, deltaMs, earlyAccuracy, lateAccuracy } | null when n < 6

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
export function renderProgress(root, app)  // route #/progress. Headline: timedTrend over all timed logs. Table from topicStats. Plain HTML tables.
export function renderDrills(root, app)    // route #/drills. One block per drillPlan entry: statement, action, what it trains with retention percentages, links to preview its cards.
```

Navigation: `app/src/ui/chrome.js` shows Cards and Settings at every width; Lab,
Drills and Progress only at 900 px and wider (the phone topbar has no room for
five links). `renderHome` links to Drills and Progress next to "Browse all N
cards", so both are one tap from Home on the phone.

Data contract: nothing new is stored. `principle.topic` becomes load-bearing
for grouping; it stays optional in the schema (fallback to `category`). The
sample deck's drill principle gets `trains: ["p-below-net-reset"]` so the
Drills view and the existing summary suggestion are exercised by tests.

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

## 5. Assumptions

Flagged C where a wrong assumption changes correctness, S where it changes only
schedule or scope.

| Id | Assumption | Flag | If wrong |
|---|---|---|---|
| A1 | The PRD's decisions Q1 to Q8 stand (pro tiers, implicit endorsements kept, no caps, reduced motion respected, own origin) | C | Content rules and session behavior change; nothing in this plan depends on reversing them |
| A2 | Phone is an iPhone with Safari, laptop runs Chrome (PRD section 3). Both support Cache Storage and IndexedDB; iOS Safari's localStorage quota is treated as 5 MB shared by the origin | C for E1 timing | If the quota is larger, E1 and E3 can wait longer; the design is the same |
| A3 | GitHub contents API: raw reads work up to 100 MB; `If-None-Match` returns 304 on the raw media type; PUT accepts files of several MB | C for E2, S for progress growth | C5 verifies with throwaway requests; E2 falls back to the sha comparison; a PUT limit would force splitting progress files, which changes the merge and needs its own design |
| A4 | WhisperX large-v3 runs on the 6 GB GTX 1660 Ti with `batch_size: 4` (`int8` if float16 runs out of memory); a Windows CUDA install may need the cuDNN wheel (`nvidia-cudnn-cu12`) on PATH; roughly 10 to 20 minutes per hour of audio | S | CPU with `int8` takes days for the corpus; a rented GPU or a smaller model (`large-v3-turbo` if the installed WhisperX supports it) are the fallbacks; the pilot's dry run and first episode decide |
| A5 | A review log entry is about 330 bytes; 20 to 40 cards a day is 2.4 to 4.8 MB a year | C for when E3 triggers | The Settings size readout (E1) makes the real rate visible |
| A6 | The full corpus yields roughly 600 principles and 1,500 cards, a deck of 3 to 6 MB (3.1 KB per card in the sample deck) | C for E1 | Any deck over about 2 MB already needs E1, so the conclusion holds for any plausible corpus |
| A7 | Replay-from-full-history stays the merge rule; logs are never compacted | C | Compaction would need a per-card base state and a floor agreed across devices; not planned |
| A8 | `merge-principles` fills `principle.topic` (the prompt asks for it; the schema leaves it optional) | S | Progress rows fall back to `category`, which is coarser but correct |
| A9 | Timed-card response times are comparable only within stages B and C (clock starts at the freeze; stage A is untimed and slowed) | C for T-5 | `timedTrend` excludes stage A by contract; if the earlier freeze in C skews trends, report B and C separately |
| A10 | Jeremy is comfortable downloading YouTube audio with yt-dlp for personal study (YouTube's terms restrict downloading) and will name pro-run channels whose credentials he verifies | S | Track F is skipped; nothing else depends on it |
| A11 | Freeze leads of 120 ms (B) and 250 ms (C) are starting values | S | Tune in the lab with the pilot's timed scenes; the clamp keeps every card playable |
| A12 | One user, two devices, each device writes only its own progress file (D6) | C | A third device works the same way; concurrent tabs on one device already refresh the sha once |
| A13 | The Pages site is served from a free organization's origin (Q7, D14); the repository name is free | S | A personal-account project site would share storage with the other Pages project, which the PRD rules out |
| A14 | The pilot show stays Pickleball Cheat Code, first five episodes (`/run-pilot cheatcode 5`) | S | Any show in `sources.yaml` works; only the speaker map evidence differs |

## 6. Implementation plan

Each track lists steps, who does them (Claude Code unless marked Jeremy),
verification, and exit criteria. Commit after each step that changes code, with
the requirement id in the message.

### Track A: repository and environment (one session, Jeremy needed for accounts and tokens)

| Step | Work | Verify |
|---|---|---|
| A1 | `git init`, commit everything (this plan included). `node_modules`, `.venv`, `app/data/deck.json` are already ignored | `npm test`, pipeline tests, `npm run sw` (manifest unchanged), `git status` clean |
| A2 | Jeremy: create the free GitHub organization and an empty public repository; push. Enable Pages with source GitHub Actions. The workflow publishes `app/` | The Pages URL serves the sample deck; `lab.html` opens; the app installs on the phone |
| A3 | Jeremy: create the private data repository under the personal account and the fine-grained token (that repo only, Contents read and write, expiry). Claude: clone it next to this repo with the `.gitignore` from `pipeline/README.md`, or set `PIQ_DATA_DIR` | `python pipeline/piq.py status` reports no manifests yet rather than a missing directory |
| A4 | WhisperX environment: separate venv, CUDA build of PyTorch matching the driver, `pip install whisperx`, `whisperx --help`. Jeremy: Hugging Face read token, accept the pyannote model terms, `export HF_TOKEN`. Set `transcribe.batch_size: 4` in `piq.yaml` with a comment about 6 GB cards; keep `float16`, note `int8` as the fallback | `python pipeline/piq.py transcribe --episodes <id> --dry-run` prints the command with the token masked |
| A5 | Optional: `gh` CLI (repo creation from the terminal), `yt-dlp` into the pipeline venv if Q9 is yes | `gh auth status`, `yt-dlp --version` |
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
| B6 | `spotcheck --episodes <ids> --n 10`; Jeremy listens and pastes the results | Pass at 9 of 10 (P-12 pilot criterion). On failure, find the cause (transcription, speaker map, extraction), fix, rerun the affected steps |
| B7 | Jeremy confirms; commit and push the data repo (audio and clips stay ignored) | `git status` in the data repo shows no audio |

Exit (PRD Phase 1): spot-check passed, every pilot scene passes
`tools/check-scenes.mjs` and looks right in the lab (AC-6, AC-7), `deck/deck.json`
pushed. Record the card mix that `build-deck` prints; it tells Track D2 which
topics exist.

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

### Track D: features the goal implies (two or three sessions; runs alongside B and C)

| Step | Work | Tests |
|---|---|---|
| D1 (T-2) | `freezeLeadMs` on the stages, clamped early freeze in `compileTimeline`, `play(0, { toEnd: true })` for the post-answer replay, lab control, prompt sentence about minimum last-segment length, PRD 8.4 gains a Freeze column, T-2 marked built, decision D21 | `compileTimeline(occlusionScene, { freezeLeadMs: 250 }).freezeAt === 2080`; the clamp on a scene with a short last segment; `applyAidPreference` keeps the lead; a card-view test that stage C freezes earlier than stage A and that the replay reaches the end |
| D2 (T-5) | `app/src/stats.js` with `timedTrend` and `topicStats`; Progress view and route; nav rules; PRD section 8.11 (N-4 Progress view) and T-5 marked built | Median and window arithmetic on synthetic logs; stage A logs excluded; unknown cards ignored; topic fallback to category; ordering; a jsdom render with the sample deck after a batch |
| D3 (N-2) | `drillPlan`; Drills view and route; `trains` added to the sample drill principle; PRD Phase 6 item moved to built | Ranking with two drills where one trains a lapsed principle; drills without seen targets sort last; render smoke test |
| D4 (N-3) | `focusCue` returns the card; `endBatch` stores `last_cue`; Home shows it; schema documents it | After a batch, `progress.settings.last_cue.text` equals the summary cue; Home renders it; merge keeps the newer cue |

All four: `npm test`, `npm run sw`, decisions.md entries (D21 earlier freeze by
maturity; D22 progress views derive from the log, the only stored addition is
the last cue), PRD status rows.

### Track E: scale (one session before the corpus, then the corpus itself)

| Step | Work | Trigger and tests |
|---|---|---|
| E1 | Deck cache in Cache Storage with localStorage migration; Settings size readout; PRD 8.7 updated; decision D23 (deck cache off localStorage; logs never compacted, A7) | Before the first deck over 1 MB. Tests with an in-memory `caches` stub: write, read, migrate, fallback without `caches` |
| E2 | `getTextIfChanged`, `pullDeck` with etag, the etag key; sync skips re-indexing when unchanged | After C5 decides ETag or sha. Fake-API test returns 304 on a matching `If-None-Match` |
| E3 | `kv.js` with the three stores; `loadProgress` async with migration; write-behind `saveProgress`; `syncNow` awaits the queue | When Settings shows progress above 2 MB, or before the second year of use, whichever first. Existing progress, session and UI tests switch to `memoryStore` |
| E4 | Phase 4: `feeds` for both shows, `download` in batches, `transcribe` overnight, the headless `claude -p` loop from `pipeline/README.md` per episode, review in batches, merge, cards, deck. Decide the extraction path (Q10) | Same exit criteria as the pilot per batch of episodes; `build-deck` warnings clean; lab checks on a sample of new scenes |

Cost note for Q10: the optional `extract-api` path is priced per token. A one-hour
episode is roughly 15k input and 5k output tokens, so the corpus is about $25
with `claude-opus-5` ($5 and $25 per million tokens) or about $10 with the
configured `claude-sonnet-5` ($2 and $10). Endorsement judgment is the step the
spot-check gates, so if the API path is used, run it on `claude-opus-5`. The
default path (skills inside Claude Code) has no per-token cost.

### Track F: video sources (one or two sessions; only after Q9 is yes)

| Step | Work | Tests |
|---|---|---|
| F1 | `sources.yaml` `kind`, `piq.yaml` `youtube`, `list_youtube`, `download_youtube`, dispatch in `cmd_feeds` and `cmd_download`, manifest merge by guid | Fixture `pipeline/tests/fixtures/youtube-flat.json` plus a per-video JSON fixture; record mapping, id stability across runs, download command shape with a fake `yt-dlp` on PATH |
| F2 | Jeremy: choose channels and verify credentials; Claude: registry entries, `vocab.txt` names | `validate` accepts tips with the new speaker ids |
| F3 | Prompt rules: visual-demonstration flag, single-presenter mapping; `run-pilot` preflight checks `yt-dlp` when a show is `youtube` | Read-through; one extraction on a real video, spot-checked |
| F4 | `timestampUrl` in `provenance.js`; source lines link to the moment | Unit test on watch, youtu.be and non-YouTube urls; UI test on the Episode link |
| F5 | Docs: `docs/sources.md` channels, PRD 4.1 and 10, pipeline README etiquette (audio for study only, never committed) | Read-through |

Exit: one channel's first videos through the whole pipeline with the same
spot-check bar as the pilot.

### Track G: later

T-1 read-the-shot cards (needs D1's `toEnd` replay and the `asks` field), T-3
drag model, T-4 opponent tells where a pro names them, T-6 multi-shot sequences,
suspend and edit from the card browser, weak-topic practice built on
`topicStats`, and a quick-fire pre-game mode (timed cards only, no aids) as an
idea to evaluate after the Progress view shows real trends.

### When the goal is being met

Daily sessions on real content; the Progress view shows timed-read medians
falling or holding at stage C with accuracy steady; weak topics are visible and
the Drills view names what to practice; every card still shows who said it and
where.

## 7. Files to modify

New files are marked (new). The data repository's files are not listed; they
are content, not code.

### Track A

| File | Change |
|---|---|
| `.git/` (new) | Repository initialized, first commit |
| `plan.md` (new) | This plan |
| `README.md` | Step 0: `git init` and first commit before the deploy steps |
| `pipeline/README.md` | GPU-memory settings for 6 GB cards; Windows CUDA and cuDNN note; `yt-dlp` install line if Q9 is yes |
| `pipeline/config/piq.yaml` | `transcribe.batch_size: 4` with a comment; `int8` fallback comment |
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
| `prompts/generate-cards.md` | Minimum last-segment duration note |
| `tests/render.test.mjs`, `tests/scheduler.test.mjs`, `tests/ui.test.mjs` | Tests listed in section 6 |
| `docs/PRD.md`, `docs/decisions.md`, `docs/rendering-notes.md` | 8.4 Freeze column, T-2 built, D21, playback paragraph |
| `app/sw-manifest.js` | Regenerated |

### Track D2, D3, D4

| File | Change |
|---|---|
| `app/src/stats.js` (new) | `timedTrend`, `topicStats`, `drillPlan` |
| `tests/stats.test.mjs` (new) | Unit tests for all three |
| `app/src/ui/views.js` | `renderProgress`, `renderDrills`, Home links and last cue |
| `app/src/ui/chrome.js` | Nav links with the width rule |
| `app/src/main.js` | Routes `progress` and `drills` |
| `app/src/ui/session.js` | `focusCue` returns the card; `endBatch` stores `last_cue` |
| `app/styles.css` | Table styles for the Progress view; nav visibility below 900 px |
| `app/data/deck.sample.json` | `trains` on the sample drill principle |
| `schemas/progress.schema.json` | Document `settings.last_cue` |
| `tests/ui.test.mjs`, `tests/session.test.mjs` | Render smoke tests; last-cue test |
| `docs/PRD.md`, `docs/decisions.md` | Section 8.11 Progress view (N-4), Drills view (N-2), Home cue (N-3), T-5 built, D22 |
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
| `pipeline/config/piq.yaml` | `extract.model` if the API path is chosen for E4 |
| `app/sw-manifest.js` | Regenerated |

### Track F

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

## 8. Decisions needed from Jeremy

| Id | Question | Default in this plan |
|---|---|---|
| Q9 | Add video sources? Which pro-run channels, and is downloading their audio with yt-dlp for personal study acceptable to you (YouTube's terms restrict it)? | Track F planned but not started |
| Q10 | Extraction for the full corpus: skills inside Claude Code (no per-token cost, one episode per fresh context) or the API path (`extract-api`, about $25 on `claude-opus-5`, unattended)? | Skills for the pilot; decide for the corpus after seeing pilot quality |
| Q11 | Should timed cards freeze earlier as they mature (T-2), with 120 ms at stage B and 250 ms at stage C as the starting values? | Yes |
| Q12 | Progress and Drills views in the app, with Lab, Drills and Progress in the topbar only at laptop width and linked from Home on the phone? | Yes |
| A14 | Keep the pilot on Pickleball Cheat Code, first five episodes? | Yes |
