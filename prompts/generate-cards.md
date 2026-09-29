# Generate cards and scenes

Turn active principles into reviewable cards, and draw the court situation for
each situational card as scene data. The app renders scenes deterministically, so
your job is correct numbers, not pictures.

## Inputs

- `<data>/content/principles.json` (use `status: active` only).
- Existing `<data>/content/cards.json` and `<data>/content/scenes.json`. Keep their ids. Only regenerate cards for new or changed principles unless asked.
- Schemas: `schemas/card.schema.json`, `schemas/scene.schema.json`. Geometry background: `docs/rendering-notes.md`.

## How many cards

There is no target. Write one card for each distinct thing in a principle that a
player could be tested on, and stop there. Some principles yield one card, some
yield six; an episode full of tips yields many cards, a chatty one yields few.

| What the principle's sources contain | Card |
|---|---|
| A situation and what to do in it | One court card per distinct situation the sources describe: `timed_decision` when the decision depends on reading the ball early and the moment can be animated, otherwise `scenario_mc`. Use `text_mc` when court position does not matter. |
| A reason (`why`) | One `why` card. |
| A form cue | One `form_cue` card. |
| A named mistake with its fix | One `text_mc` "fix the mistake" card per mistake, or `scenario_mc` when court position matters. |
| A drill | One `drill_recall` card per detail a player would need to remember (setup, goal or scoring, progression), only those the sources give. |

A second court card for the same principle needs a genuinely different situation
in the sources, such as at the kitchen versus in transition, or off a bounce
versus out of the air. Never make mirrored copies or reworded duplicates to add
cards, and never test the same point twice.

Card types:

- `scenario_mc`: a court picture and three or four choices.
- `text_mc`: choices without a picture.
- `timed_decision`: lead-in shots, a freeze, then a choice against the clock. It needs a scene with a `timeline`. Not for things you cannot see (communication, strategy talk).
- `why`, `form_cue`, `drill_recall`: recall first, then the answer, self-rated.

`build-deck` prints the mix by category. It is information, not a target: the mix
should reflect what the episodes teach.

## Mirroring

The app shows a court card mirrored left to right on alternate reviews: every
position flips across the center line and every player's handedness swaps. The
tactic stays identical (forehands, backhands, the middle and the sidelines all
keep their relations), and you see the situation from the other side of the
court without adding a card.

Set `mirrorable` on every court card:

- `true` when the mirror image is the same lesson and none of the card's text uses a word starting with left or right, or southpaw. In these cards write "correct" or "best" instead of "right", and describe positions relative to the play: middle, sideline, forehand, backhand, crosscourt, down the line, the hitter, their partner.
- `false` when the lesson depends on one side: where the serve comes from (the score decides it), a righty-lefty pairing the text names, or anything else that is not symmetric.

Prefer side-neutral wording where it costs nothing, so most court cards can
mirror. `validate` rejects a mirrorable card whose text names a side, and warns
about court cards with no decision.

## Writing rules

- `prompt`: second person, present tense, short: set up the moment and ask ("Their dink is coming to you. What's the play?"). Up to 300 characters. Do not state the cue the picture shows ("it floats up", "it's dropping below the net", "both backhands are in the middle"). Let the court carry it, or the text answers the question before you look. A condition the picture cannot show (the level of play, the stance you serve from, who your opponents are) must be in the prompt, so the card never asks for advice that the principle gives only for one case.
- `options` is a pool. Each showing displays one correct phrasing and up to three wrong answers, shuffled, and the selection rotates from one review to the next, so the answer can't be remembered by its position or by the set of choices. Write every plausible wrong answer you can ground, up to six: refuted claims from `distractor_candidates` first, then `common_mistakes`, then things a 4.0 player might plausibly do that the principle rules out. Never pad with silly ones. Add one or two other phrasings of the correct play (also `correct: true`) when they come naturally; they must be the same play in other words, not a second right answer. Keep all options similar in length and style, with no "all of the above" and no trick wording. Every option gets `feedback` (up to 240 characters) saying why it is right or wrong. Ids run a, b, c and onward.
- Timed cards: `prompt` up to 160 characters and each option up to 60. The question and choices can be read before Play with no time limit, but after the freeze you have two or three seconds to find your choice again, so put detail in `feedback` and `explanation`. `validate` warns about longer options.
- `explanation`: tie the answer to the principle and to what is visible ("The ball sits below the tick on its stalk, so contact would be below net height.").
- `focus_cue`: up to 80 characters, pointed at the ball, target or paddle rather than body parts where possible ("Paddle out front, punch through the middle"). External focus cues tend to transfer better than internal ones; see docs/learning-design.md.
- Never add advice the principle does not contain. If something seems missing, say so in `claude_note`.
- Ids: `c-<principle slug>-<n>`, `s-<principle slug>-<n>`.

## Scenes

Coordinates are feet: `x` 0 to 20 from your left sideline to your right, `y` 0 to
44 from your baseline to theirs. The net is at `y = 22`, kitchen lines at 15 and
29. Heights are inches (`z_in`). Team `us` stays at `y <= 22`, team `them` at
`y >= 22`. The player `you` is on team `us` and owns the camera.

### Canonical formations

Use these unless the principle says otherwise. Players stand about a foot behind a line they are "at".

| Situation | You | Partner | Opponents |
|---|---|---|---|
| All four at the kitchen | (5, 13.9) | (15, 13.9) | (5, 30.1), (15, 30.1) |
| Your team serving, ball just served | (5, -1) | (15, -1) | returner (15, 45), partner at the kitchen (5, 30.1) |
| Third shot, you at the baseline | (5, -0.5) | (15, -0.5) | both at the kitchen (5, 30.1), (15, 30.1) |
| You in transition | (6, 10) | (15, 11) | both at the kitchen |
| Partner pulled wide | (5, 13.9) | (19, 13.5) | both at the kitchen |
| Opponents stacked to put backhands in the middle | | | righty on your left (5, 30.1), lefty on your right (15, 30.1) |

Every player needs `hand` (R or L). Use R for everyone unless the principle names a left-hander: most players are right-handed, a righty-lefty pairing is a lesson in itself, and mirrored reviews already show the left-handed version of every scene. The renderer works out paddle sides and backhand labels.

### Heights and clearances

| Ball height at `now` | `z_in` |
|---|---|
| At the feet | 4 to 8 |
| Dropping below the net | 10 to 20 |
| About net height | 30 to 36 |
| Above the net, a floater | 40 to 55 |
| Chest high | 48 to 56 |

| Shot | `net_clearance_in` |
|---|---|
| Tight dink or drop | 2 to 5 |
| Normal dink | 4 to 10 |
| High dink | 12 to 20 |
| Floater or pop-up | 24 to 40 |
| Drive | 4 to 12 |
| Lob | use `apex_in` 120 or more |

Contact heights (`from.z_in`): dinks 8 to 20, volleys 30 to 50, drives 20 to 40.

### Ball and answer

- `ball.from`: at the hitter's paddle side, slightly in front of them. Set `hitter_id`.
- `ball.now`: the decision point, just before your contact, one to two feet in front of you on the side the principle is about.
- `ball.net_clearance_in` whenever from and now are on opposite sides of the net.
- `answer_overlay.target`: an ellipse (`rx_ft` 1.5 to 3, `ry_ft` 1 to 2) where the right shot goes. `answer_overlay.shot.to` with `z_in` (0 for a bounce) and `net_clearance_in`. Use `moves` for positioning answers.
- `camera`: `{"eyes_of": "you", "mode": "over_shoulder"}`. Use `first_person` only when the lesson is about the view straight in front of your face.
- `inferred: true` with `inferred_fields` listing everything you estimated. Podcasts rarely give coordinates, so this is almost always true.

### Timelines (timed cards)

One or two lead-in shots ending at the decision point, then a freeze.

| Segment | `duration_ms` |
|---|---|
| Dink | 900 to 1300 |
| Bounce to contact | 300 to 450 |
| Drive | 450 to 700 |
| Speed-up | 400 to 600 |
| Floater or pop-up | 1000 to 1400 |

- Segments chain: each `from` equals the previous `to`. A bounce is a segment ending at `z_in: 0`, followed by a `kind: "bounce"` segment up to the contact point with an `apex_in`.
- `freeze_at_ms`: 100 to 200 ms before the last segment ends. The static `ball.now` should equal the last segment's `to`. As a card matures the app freezes up to 250 ms earlier than this, so the last segment should last at least 400 ms.
- `response_window_ms`: 3000 by default. The app scales it by card maturity.
- Add `movements` for players who would move (shifting toward the middle, split-stepping forward).

## Finish

1. Write `<data>/content/cards.json` and `<data>/content/scenes.json` (complete arrays).
2. Run `node tools/check-scenes.mjs <data>/content/scenes.json` and fix every error. Warnings deserve a look.
3. Run `python pipeline/piq.py validate`.
4. Open `app/lab.html`, paste two or three new scenes, and look at them from both cameras. Fix anything that looks wrong on court.
