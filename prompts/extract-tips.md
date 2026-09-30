# Extract tips from one episode

You read one prepared transcript and write the actionable pickleball advice in it
as raw tips, each attributed to who said it and labeled with whether a pro stood
behind it. Output is JSONL: one object per line matching `schemas/raw-tip.schema.json`.

## The input

`<data>/work/prepared/<episode_id>.md` contains the episode metadata, a speaker
legend, the show notes, and the transcript as lines like
`[00:14:32] mircea-morariu: text`. The legend says each speaker's tier and marks
who **counts as a pro**. Only those speakers can state or endorse pro advice.

## What counts as a tip

A tip is advice a player could act on: in this situation, do this (often with a
cue for when, and a reason why). Include strategy, positioning, shot selection,
form cues, drills and practice plans, partner communication, and the mental game.

Leave out: sponsor reads and discount codes, gear promotion, tour gossip, match
recaps with no lesson, rules trivia with no playing consequence, jokes, and
listener questions themselves (the answer to a question can be a tip).

## Faithfulness

- Paraphrase in plain words. Stay close to the meaning. Do not quote more than ten words, and prefer not to quote at all.
- Use only what was said. If the speaker gave no reason, `why` is null. Do not supply the standard reasoning from your own knowledge.
- Your own observations go in `claude_note` and nowhere else. The app shows `claude_note` separately so it is never mistaken for a pro's words.
- One idea per tip. Split compound advice ("short backswing and aim middle") when the parts could be right or wrong independently.
- Conditional advice stays conditional. When the speaker ties the advice to a condition ("if the drop looks like it will bounce in the kitchen", "at the 5.0 level", "if you serve from an open stance"), the condition goes into `situation` so the tip reads correctly on its own; `cue` and `conditions` repeat it, they do not replace it. A tip that reads as advice for everyone when the speaker gave it for one case is unfaithful, even if every word came from the speaker.
- A speaker's personal method is advice only for players who use that method. "I serve open-stance with both feet flat" is a tip whose situation is "serving from an open stance", not a recommendation to serve open-stance, unless the speaker recommends the method itself.
- Explain a speaker's private term in plain words the first time it appears, using the speaker's own explanation when they gave one: Brodie's "disconnected paddle" becomes "reaching out wide for the ball with the arm alone, which Brodie calls a disconnected paddle". A tip must make sense to a player who has not heard the episode. Standard pickleball vocabulary (Ernie, shake and bake, stacking) needs no gloss.
- If the same speaker repeats a point, extract it once at the clearest timestamp. If a second pro independently states it, that is a separate tip (repetition across pros raises priority later).

## Attribution

`speaker_id` is whoever said it, taken from the legend. If the speaker is an
unknown label or the legend shows medium or low mapping confidence, set
`needs_review: true` with the reason.

## Endorsement: the rules

Decide `endorsement.status` for every tip.

| Status | When | endorser_id |
|---|---|---|
| `pro_stated` | A pro said it. Also use this when a pro restates a host's idea in their own words with substance. | null |
| `endorsed_explicit` | A non-pro said it and a pro clearly agreed out loud ("exactly", "one hundred percent", "yes, and..."). | the pro |
| `endorsed_implicit` | A non-pro said it, a pro was an active participant in the same discussion, and the pro did not object. | the pro present |
| `qualified` | A non-pro said it and a pro agreed with a condition ("it depends", "only outdoors", "at higher levels"). Put the condition in `conditions`. | the pro |
| `refuted` | A non-pro said it and a pro disagreed, even softly. Extract the pro's correction as its own `pro_stated` tip and set `corrected_by_tip_id`. | the pro |
| `no_pro_present` | A non-pro said it with no pro in the discussion (a solo intro, a host-only segment or episode). Still extract it; the deck excludes it. | null |

**Provisional pros.** The legend marks some speakers as provisional pros
(currently Kevin Tsati, whose level is unverified). Their own advice is
`pro_stated` and needs nobody else present, with two limits. They cannot
endorse anyone: a non-pro statement with only a provisional pro in the
discussion is `no_pro_present`, unless the provisional pro restates it with
substance, which makes it the provisional pro's own tip. And a full pro
outranks them: when a full pro in the episode disagrees with a provisional pro,
label the provisional pro's tip `refuted`, with the full pro as `endorser_id`,
and extract the full pro's correction.

"Active participant in the same discussion" means the pro spoke within about
three minutes before or after the statement and the topic had not changed.

**Soft disagreement is disagreement.** "I'd push back a little", "I don't love
that", "not necessarily", "that's more of a 3.5 thing", "I'd rather..." all
count. When a pro disagrees with only part of a claim, split the claim: the part
the pro accepted gets its endorsement, the part the pro rejected is `refuted`.

**A non-pro restating a pro's point** in the same discussion is not a new tip.
Extract the point once, as the pro's `pro_stated` tip at the pro's timestamp.
If the restatement adds a trigger or condition the pro did not address, put it
in the pro's tip's `conditions`, naming who added it ("Brodie also uses it
against a heavy chop return; Tanner did not address that"), and say so in
`claude_note`. Only a genuinely different action or situation gets its own tip.

**Blanket agreement.** "I agree with everything you said" right after a turn
endorses the points in that turn explicitly. But a pro's agreement with a
wrap-up or summary of an earlier discussion ("you hit everything on the head"
at the end of the episode) endorses each summarized point only implicitly:
label those `endorsed_implicit`, with the evidence at the pro's nearest turn in
the original discussion, unless the pro names the point there. The evidence for
a label comes from the discussion in which the statement was made.

**Write a refuted claim as the claim the pro rejected**, not as advice. When
the pro rejected only the reason ("crosscourt resets create offense"), the
tip's `action` is that reason ("Expect the crosscourt reset to create offense
because it goes to an opponent's inside foot"), and the action the pro accepts
lives in the pro's own tip.

**When unsure, choose the more conservative status** (implicit rather than
explicit, qualified rather than implicit when there is any hedge) and set
`needs_review: true` with a reason. Sarcastic agreement is not agreement.

**Two pros disagreeing** is not a refutation. Extract both as `pro_stated` and
mention the disagreement in each tip's `claude_note` with the other timestamp.

Refutations across episodes are handled later, in the merge step. Judge each
statement only against this episode.

`evidence_timestamp` and `evidence` record where and how the pro agreed,
qualified or disagreed. Required for every status except `pro_stated` and
`no_pro_present`.

## Other fields

- `id`: `<episode_id>-t001`, numbered in transcript order.
- `timestamp_start` / `timestamp_end`: `HH:MM:SS` from the transcript lines.
- `category`: strategy, form, drill, mental, partner, rules, equipment. `topic`: a short tag such as third_shot, dinking, transition, hands_battle, speed_up, reset, stacking, serve, return, lob, singles, footwork.
- `situation`: when it applies, in court terms. `cue`: what you see or feel that triggers it, if said. `action`: what to do.
- `conditions`: qualifiers from any speaker ("only when they're both at the kitchen").
- `common_mistake`: only if a speaker named one.
- `level`: only if a level was stated or clearly implied ("this is for 4.0s"). Otherwise omit it.
- `format`: doubles, singles, or both.
- `scene_hint`: positional facts in words (formation, ball height, handedness) with `stated: false` if you had to assume any. Do not invent coordinates here.
- `confidence`: how sure you are that the tip, attribution and status are right.
- `needs_review` and `review_reasons`: anything a human should check against the audio.

## Worked examples (invented)

These use made-up speakers `host-b` (advanced amateur) and `pro-a` (senior pro, counts as a pro).

Transcript:

```
[00:14:02] host-b: On a floater you just crush it as hard as you can, right at their feet.
[00:14:09] pro-a: At their feet, yes. But I'd push back on crushing it. Short backswing, punch it. Most misses come from winding up.
[00:31:40] host-b: When both of their backhands are in the middle, I'm going middle every time.
[00:31:47] pro-a: Mm. The other thing about stacking is you can hide a weaker player.
[00:45:10] host-b: If they're crowding the kitchen line, lob.
[00:45:15] pro-a: Outdoors with the wind behind you, sure. Indoors I almost never do it.
```

Output (fields trimmed for readability; real output includes every required field):

```jsonl
{"id":"ex-20240101-aaaaaa-t001","speaker_id":"host-b","endorsement":{"status":"endorsed_explicit","endorser_id":"pro-a","evidence_timestamp":"00:14:09","evidence":"pro-a agreed the target is their feet"},"situation":"A ball floats up to you at the kitchen","action":"Attack it at the opponents' feet","why":null,"needs_review":false}
{"id":"ex-20240101-aaaaaa-t002","speaker_id":"host-b","endorsement":{"status":"refuted","endorser_id":"pro-a","evidence_timestamp":"00:14:09","evidence":"pro-a pushed back on swinging as hard as possible","corrected_by_tip_id":"ex-20240101-aaaaaa-t003"},"situation":"A ball floats up to you","action":"Hit it as hard as you can","needs_review":false}
{"id":"ex-20240101-aaaaaa-t003","speaker_id":"pro-a","endorsement":{"status":"pro_stated"},"situation":"A ball floats up to you","action":"Use a short backswing and punch it","why":"Most misses come from winding up","common_mistake":"Winding up with a big backswing","needs_review":false}
{"id":"ex-20240101-aaaaaa-t004","speaker_id":"host-b","endorsement":{"status":"endorsed_implicit","endorser_id":"pro-a","evidence_timestamp":"00:31:47","evidence":"pro-a acknowledged and continued on the same topic without objecting"},"situation":"Both opponents' backhands meet in the middle","action":"Attack through the middle","scene_hint":{"handedness":"backhands in the middle","stated":true},"needs_review":false}
{"id":"ex-20240101-aaaaaa-t005","speaker_id":"pro-a","endorsement":{"status":"pro_stated"},"category":"partner","situation":"One partner is noticeably weaker","action":"Stack to keep the weaker player out of the most exposed position","needs_review":true,"review_reasons":["Stated in passing; confirm this is advice rather than an aside"]}
{"id":"ex-20240101-aaaaaa-t006","speaker_id":"host-b","endorsement":{"status":"qualified","endorser_id":"pro-a","evidence_timestamp":"00:45:15","evidence":"pro-a agreed only for outdoor play with the wind behind"},"situation":"Opponents crowd the kitchen line","action":"Lob","conditions":["Outdoors with the wind behind you","pro-a rarely does it indoors"],"needs_review":false}
```

## Finish

1. Write `<data>/work/tips/<episode_id>.jsonl`.
2. Run `python pipeline/piq.py validate --file <that path> --kind raw-tip` and fix every problem.
3. Report counts by endorsement status, how many need review, and anything odd about the speaker map. Do not print the tips themselves.
