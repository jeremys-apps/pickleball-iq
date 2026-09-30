# Decisions

Short records of choices that shape the code, with the reason for each. Add new
ones at the end; do not rewrite old ones, supersede them.

**D1. No framework, no build step.** Vanilla ES modules served as-is. The app is
small, Claude Code edits it directly, and GitHub Pages serves it without a
pipeline. Revisit only if the UI grows well beyond its current size.

**D2. Scenes are data; rendering is deterministic.** Claude writes scene JSON with
coordinates and heights; the app draws it. Generated images could not be checked
or kept consistent, while numbers can be validated, tested and inspected in the lab.

**D3. Over-the-shoulder camera by default.** True first person collapses straight-on
shots into an unreadable line. Offsets: 2.3 ft lateral away from the paddle side,
2.7 ft back, 0.4 ft up.

**D4. FSRS through ts-fsrs, vendored.** A modern, well-tested scheduler (MIT).
Vendoring it (and self-hosting the fonts) keeps third-party scripts off the
origin that holds the GitHub token.

**D5. Public app shell, private data repo.** GitHub Pages is public; the deck and
progress contain podcast-derived content, so they live in a private repository
reached with a fine-grained token scoped to that repository.

**D6. One progress file per device, merged by log union.** Devices never write
the same file. Card states are rebuilt by replaying the combined log when two
devices reviewed the same card, so merges are order-independent and idempotent.

**D7. Endorsement statuses, including implicit.** A pro present in the discussion
who does not object counts as endorsement, because hosts often voice the point
while the pro nods along. It is one config line to exclude later. Soft pushback
counts as refutation; the conservative status wins when unclear.

**D8. Local WhisperX with diarization.** Speaker labels are essential to the
endorsement rules, publisher transcripts rarely have them, and local
transcription keeps the audio private.

**D9. Claude Code skills plus headless loops for content work.** Skills hold the
procedure, prompts hold the rules, and `claude -p` in a shell loop gives each
episode a fresh context. An optional API path exists for unattended runs.

**D10. Aid fading by card maturity.** Stages A, B and C remove the path, the map
and slow playback as a card matures, following the guidance hypothesis.

**D11. Timed cards count a timeout as a miss.** The point is reading under time
pressure; a correct answer after the window would teach the wrong habit.

**D12. Open-ended sessions.** No daily new-card cap and no session length
(Jeremy, Q4). Cards come in batches with Keep going, then practice ahead once
everything has been seen. The cost of a big day is a heavier review load on the
following days; an optional new-card limit exists for that and is off by default.

**D13. Provisional pros.** A tier for players whose level is unverified but whose
advice is wanted (Kevin Tsati, Q2). Their own advice stands; any full pro's
contradicting advice or endorsement strikes it; they cannot endorse others.

**D14. The app gets its own origin.** Browser storage is per origin, and all Pages
project sites of one account share `<user>.github.io`. Another Pages project
exists on the account (Q7), so a free organization hosts the app.

**D15. Unrated answers are kept.** Multiple-choice and timed answers are saved at
answer time and recorded with their suggested rating if the app closes before
rating. Self-graded cards are not, because their rating is a judgment only the
user can make; they simply come back.

**D16. Reading happens before the clock.** Timed cards show the question and the
choices before Play, and the response window starts at the freeze (Q5).

**D17. Aids return after every answer; mature-card aids are a setting.** Refines
D10. The overlays fade while you decide, because a match has no painted path or
map, but the reveal shows all of them at every stage, and "On mature cards" can
keep the map or every aid.

**D18. Card counts follow the content.** No target number of cards per principle
or per episode. One card per distinct testable point in the sources; no mirrored
or reworded padding.

**D19. Mirrored reviews instead of extra cards.** A court card marked mirrorable
alternates between its authored picture and an exact left-right reflection with
handedness swapped, so recognition generalizes across sides without padding the
deck (D18). Text is the constraint: mirrorable cards may not use any word starting
with left or right, enforced in both the app and the validator, and the first
showing is always as authored.

**D20. Option pools with balanced placement.** Fixed choices let an answer be
remembered by its position or by the list. Each card holds a pool (one to three
phrasings of the correct play, two to six wrong answers); each showing shows one
correct phrasing and up to three wrong answers. Wrong answers rotate with one
carried over between consecutive showings, because if every wrong answer changed
while the correct one stayed, familiarity alone would point to it. Placement is
balanced, not purely random: every position once per run, so there are no streaks.

**D21. Timed cards freeze earlier as they mature.** Stage B freezes 120 ms and
stage C 250 ms before the authored freeze, never less than 150 ms into the last
shot (T-2). Less flight shown means the read has to come from earlier
information, which is the point of occlusion training. The clock is untouched:
it starts at the freeze, after the question and the choices were read with no
limit (D16). A "Time to choose" setting stretches only that clock, for a slower
search among the choices, and the suggested rating keeps the card's own window
so the stretch never inflates ratings.

**D22. Progress views derive from the log.** The Progress page computes topic
retention, accuracy and timed-read trends from the review log and the scheduler
at render time, and ranks drills by the retention of what they train. Nothing is
precomputed or stored; the only addition to progress is the last court cue,
kept in the synced settings so Home can show it. Timed-read trends use stage B
and C reviews only, because stage A has no clock and runs in slow motion.

**D23. The deck copy lives in Cache Storage; review logs are never compacted.**
localStorage is capped near 5 MB on iOS Safari and shared by everything on the
origin, and a full-corpus deck alone runs to several MB (about 3 KB a card). The
offline copy of the deck goes into the Cache Storage API under its own cache
name, `piq-data-v1`, outside the `court-sense-` caches the service worker
deletes on activate, with a one-time move of any copy an earlier version left in
localStorage. localStorage stays the fallback only where the Cache API is
missing. Progress stays in localStorage for now, with its size shown in Settings
as the early warning; it moves to IndexedDB when it nears 2 MB (plan Track E3).
Compacting the review log to save room was considered and rejected: sync merges
by replaying the full history, so compaction would need a per-card base state
agreed across devices, and the log is the source of the Progress views (D22).
