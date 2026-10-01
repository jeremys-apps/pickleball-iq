# Merge tips into principles

Raw tips from many episodes say the same things in different words. Merge them
into principles: one teaching point each, with every source kept, so the app can
show who said it and how many pros agree.

## Inputs

- Raw tips: `<data>/work/tips/*.jsonl`.
- Review decisions: `<data>/work/review/decisions.jsonl`. Drop rejected tips. Apply `edit` decisions before merging: `edits` maps a field to its new value, and keys may be dotted paths such as `endorsement.status`.
- Existing principles: `<data>/content/principles.json` if present. Keep their ids stable.
- Speaker tiers: `pipeline/config/speakers.yaml`; pros are the tiers in `deck.pro_tiers` of `pipeline/config/piq.yaml`.

## Rules

1. **Group** tips that recommend the same action in the same situation. Different wording is fine; different actions are different principles.
2. **Conditions**: if sources agree on the action but add different conditions, keep the conditions. If the right action changes with a condition (lob outdoors, not indoors), write separate principles and link them with `tension_with`.
3. **Sources**: one `transcript` source per contributing tip with `raw_tip_id`, `episode_id`, `speaker_id`, `speaker_tier`, `endorsement`, `endorser_id` and `timestamp`. Only statuses `pro_stated`, `endorsed_explicit`, `endorsed_implicit` and `qualified` become sources.
4. **Refuted claims** never become principles. Add each one to the `distractor_candidates` of the principle built from the pro's correction (origin `refuted_claim`, with its `raw_tip_id`). Wrong answers that pros have explicitly rejected make the best distractors.
5. **Refutation across episodes**: if a pro anywhere contradicts a principle whose sources are all non-pro statements (explicit, implicit or qualified endorsements), set that principle's `status` to `struck`, write `struck_reason` citing the pro's tip, and make sure the pro's view is its own principle. If the contradicted principle has any `pro_stated` source, this is pros disagreeing: do not strike; link both with `tension_with` and capture the context in `conditions`.
   **Provisional pros** (tier `provisional_pro` in the registry) rank below full pros. A principle whose sources are only provisional-pro statements is struck, not linked as a tension, when any principle backed by a full pro (stated or endorsed) contradicts it. Its `struck_reason` names the contradicting principle.
6. **`no_pro_present`** tips are ignored here. They stay in the raw files for the audit trail.
7. **Statement**: one plain sentence. Situation, cue and action as in the tips, reconciled. `why` only if some source gave it. `common_mistakes` is the union of named mistakes.
   Every principle must stand alone: the condition that selects it goes into its `situation` and its `statement`, never only into `tension_with` or `conditions`. A speaker's private term ("a disconnected paddle") is replaced with plain words in the statement, or kept only next to its explanation; standard pickleball vocabulary stands. So is a word that means something else on court: a player "popping up" during the stroke is "rising up as you hit", because a pop-up is a ball hit too high. A cue tied to the ball crossing the net says whose ball and which way ("as your drop crosses the net to their side"). When a tiered rule or a tension pair is split into principles ("commit behind a low drop", "hold behind a high drop"), each statement names its tier. A personal method ("Brodie serves open-stance...") becomes a principle whose situation is using that method ("Serving from an open stance, ..."), not a recommendation of the method, unless a pro recommended the method itself.
8. **Distractor candidates**: refuted claims first, then named mistakes, then plausible alternatives you propose (origin `plausible_alternative`), which must be clearly wrong according to this principle's sources.
9. **Ids**: keep existing ids. New ids are slugs of the statement, `p-` prefixed and short (`p-floater-short-backswing`). Never reuse a struck id for a different idea.
10. **claude_note**: your own observations only, such as "Two pros stress this; one limits it to outdoor play."
11. **Drills**: for drill principles, set `trains` to the ids of the principles the drill practices, when a speaker tied them together or the link is direct (a dinking drill trains dinking principles). If you inferred the link, say so in `claude_note`. The app suggests a drill after a batch in which you missed a principle it trains.

## Priority

New cards are introduced in priority order, so the points pros repeat come first.

```
priority = 2.0 x (distinct pros who stated it or explicitly endorsed it)
         + 1.0 x (distinct episodes)
         + 1.0 x (distinct provisional pros who stated it)
         + 0.5 x min(2, number of implicit or qualified sources)
         + 1.0 if levels include 4.0, 4.5 or all (or levels are absent)
```

Round to one decimal.

## Finish

1. Write the complete array to `<data>/content/principles.json`.
2. Write `<data>/work/merge-report.md`: counts (new, updated, struck), every struck principle with its reason, every `tension_with` pair, and tips you could not place.
3. Run `python pipeline/piq.py validate` and fix every problem.
