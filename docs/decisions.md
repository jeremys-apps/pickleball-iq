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

**D24. Sources fold under Source info; Claude's note becomes an "Additional note".**
On a phone the source lines and the note, in small print under the lesson,
crowded the reveal. They now sit in a closed Source info fold after the
explanation and the court cue, one tap away on every card. Claude's observations
keep their own dashed box inside the fold, apart from the source lines, so they
are still never read as a pro's words; Jeremy chose the label "Additional note"
(2026-09-30). In the same change Play and the replay moved under the picture,
because a button drawn on the court hides part of the read.

**D25. A replay shows the whole exchange, and the answer arrow waits for contact.**
On a court card, Watch the play runs their shot to you with the answer overlay
hidden, pauses a beat, then flies your answer shot from the contact point to its
target with the green path growing behind the ball; their path stays as a trail
and the ball ends where it lands. Timed cards do the same at the end of Watch
again. The arrow is anchored at the contact point (`ball.now`), never at the
ball in the frame, so it cannot ride along on a moving ball, which it did before
(Jeremy's phone notes, 2026-10-02). The button is no longer called a replay,
because a static card never played the shot before the answer. In the same
round the mirrored-card note under the reveal was dropped (the flipped court is
just another look at the situation; the log still records it), the topbar marks
the tab you are on with Court Sense as the Home tab, and the two body text sizes
grew a point on every screen.

**D26. A batch keeps its size, and the wait on the rating button holds.** On the
phone a batch set to five cards grew to six and seven, and a card rated with a
10-minute wait came back two minutes later as card 6, sometimes again as card 7
(Jeremy's notes, 2026-10-03). A card rated with a wait under twenty minutes went
back into the same batch, at most twice, as A-5 first said; when none of those
waits was over, the next pick took one anyway; and batch planning counted
learning cards due within twenty minutes as due, a learn-ahead window borrowed
from Anki, so Keep going could also bring a card back early. Now a batch is the
cards planned for it, each shown once, and a card counts as due only when its
wait is over. A miss comes back in the first batch planned after that, which
after a five-card batch is usually the next one. The cost: a miss is not
re-tested inside its own batch, and a miss on the last card may wait one batch
longer. Practice ahead, offered only when nothing is due and every card has been
seen, still brings cards back early, as its label says, and prefers cards
reviewed at least 30 minutes before.

**D27. Progress is per person: a record per person on each device, a folder per
person in the data repo.** Jeremy's family wants to use the app without touching
his progress or each other's (2026-10-05). Everyone shares the deck; what must
stay apart is the review record. A person's id is their name as a slug
(`mary-ann`), typed once per device, so the same name on two devices is the same
person and their records merge, and nothing has to be registered anywhere first.
Ids are permanent like card ids, because progress folders are named by them, so
there is no rename; a typo is removed and added again while the record is empty.
Sync reads and writes only the current person's folder, and a merge or an import
refuses a record that names someone else, so a wrong file cannot mix two people.
A device keeps one id across its people, so each person's folder holds one file
per device, and the record from before people existed goes under the first name
typed on an upgraded device. Device settings (batch size, camera, the token) stay
per device: they belong to the hardware and the credential, and the people on a
shared device can live with shared preferences. Considered and rejected: a
separate progress folder per person set by hand in Settings (a typo would merge
two people, and a shared device would have nowhere to switch), and accounts (out
of scope, section 2 of the PRD).

**D28. The camera tilts to the scene, and a bounce keeps the shot's line.**
Jeremy's phone notes (2026-11-03): a quarter to a third of the picture was sky
above the opponents' heads, and the ball near him, which he can see on court
even when it is low, fell out of the bottom of the frame; and balls bounced near
a player's feet and then turned toward them. The camera keeps its heading per
card and now takes its tilt from the scene: down until the highest thing it must
show, an opponent's head or the top of the shot you read, sits 7 percent below
the top edge, never so far that the horizon drops below that line. Raising the
principal point or lowering the old aim point by a fixed amount was considered
and rejected: either cut off lobs, which need the room above the horizon, and a
fixed amount suits a baseline view or a kitchen view but not both. The answer
overlay stays out of the fit so the framing never hints at the answer. Of 66
bounces in the deck, 57 turned 2 degrees or more, some by 35 to 60 degrees, and
one bounced back toward the net. Each landing spot moved across onto the line
from the hit to where the ball is met, keeping its depth, so the ball heads at
its target the whole way. The ATP scene at first kept a 60-degree kick, because
its roll came from the player straight across from you, and from there no
straight ball lands in and is still outside the post when you reach it. On
Jeremy's call it was rebuilt as a crosscourt roll: every ATP chance he has seen
comes off a crosscourt shot, and both of Brodie's examples are sharp crosscourt
rolls. You play the left side; their left-side player's crosscourt backhand roll
lands just inside your sideline and carries straight on past the post, where you
meet it on your backhand. No scene turns at a bounce now; `"kick": true` stays
for a spin kick a card is about, and the scene checker flags any other turn.
With the tilt the phone's mini-map moved to the bottom corner away from where
you meet the ball, judged in your view at contact; going by your paddle side
instead left 18 backhand contact points under it in true first person.

**D29. A person's full name goes with their first mention on a card.** Jeremy
asked (2026-11-03) that the first mention of a person, reading top to bottom,
carry the last name, and every later one the first name alone. The choices
change order and selection between showings, so no fixed wording can know which
mention comes first; the app applies the rule as it draws a card, in the order
texts appear (question, choices, then feedback, explanation, court cue and the
note). The source lines keep their full names and count as a mention. Speakers'
names come from the deck's speaker list. Other people a card names come from
`content/people.json` in the data repo, which `build-deck` copies into the deck,
and count on a card only when its text gives the full name somewhere, so a first
name that is also an ordinary word ("Will", "Mark") never picks up a last name
elsewhere. An earlier request for full names on every mention was withdrawn
(2026-10-02) before anything changed. Jeremy's own name stays out of card text
and notes altogether; a note cites a review decision by what it was and its date
("checked by ear", "spot-check, 2026-10-29").

**D30. Court cards open in your view; the view toggle lives under the picture.**
Cards written to lead with the top-down map opened in it, which Jeremy did not
want (2026-11-03). Every court card now opens in your view, and on a phone a new
card opens in the view you last switched to, kept with the device settings
(`courtView`); later stages open in your view regardless, since they fade the
map. With the picture tilted down, the top of the frame is the far court, and the
toggle there covered an opponent's head in 16 to 38 percent of the scenes (by
camera mode and hand), so it moved
under the picture beside Play and Watch the play, extending D24. `preferred_view`
stays in the card schema so existing cards validate, but the app no longer reads
it.

**D31. Sign-in goes through a free Cloudflare Worker that holds the only GitHub
token.** Family members should set up a phone with a username and a password,
not the data repository settings and a token (Jeremy, 2026-11-03), and Jeremy
chose a free Cloudflare Worker to make that possible (PRD Q14). Phones never
hold a token, so a lost phone or a guessed password cannot open the data repo,
transcripts included; the Worker enforces what each person reaches; there is one
token to rotate instead of one per device; an emailed reset can be added later;
and it costs nothing. The Data repository fields and the per-device tokens are
gone. Rejected: (a) no server, with each person's connection settings encrypted
with their password and published beside the app: the encrypted files would be
public, a short password falls to offline guessing, the token stays on every
phone, and email is impossible; (b) the Oracle VM: it needs a domain, TLS and
patching, and Oracle reclaims idle Always Free instances; (c) Supabase or
Firebase: progress would leave the data repo, and free projects pause when idle;
(d) a GitHub account per family member: not a username and a password; (e) a
setup link carrying the token: no sign-in, and the token sits in message
history; (f) the token fields kept under an Advanced fold: two sync paths to
test, and the token risk stays on any device that uses them. The token never
expires (Jeremy, 2026-11-03): it lives only in the Worker's secrets, and an
expiry would mainly add a yearly outage. GitHub still revokes a token unused for
a year or pushed to a public repository; a new one is one
`npx wrangler secret put GITHUB_TOKEN` away. Supersedes D5's token reached from
the browser and D27's "accounts (out of scope)".

**D32. The Worker is a path-checked pass-through of the GitHub contents API.**
`syncProgress`, `pullDeck` and the merge stay on the device unchanged, so the
tested sync logic and the file layout carry over; the Worker is small enough to
read whole, and the fake GitHub that tests the sync tests it too. A session
reaches the deck and its own person's folder, and every other path is refused.
The Worker never parses deck or progress bodies (reads stream, a write is
forwarded as bytes), so its CPU stays within the free plan's 10 ms however large
they grow. Rejected: merging on the server (FSRS replay in the Worker, CPU
limits, logic in two places) and a purpose-built API (a second client on the
device for the same three operations).

**D33. People create accounts in the app with the family code; the username is
the person's name; switching needs no password.** Jeremy chose a family code
over creating accounts himself (PRD Q16), after weighing that a shared code can
leak. Account records live in the data repo (`accounts/<id>.json`), which keeps
all state in one private place that git shows and fixes, with no Cloudflare
storage to set up. The username's slug is the person's id, so ids and folders
stay as they were and `jeremy` keeps his history. One-tap switching keeps a
shared family device easy. Every device starts at sign-in, and Add a person
signs someone in; the name-only start and add are gone (PRD Q22), since the real
deck needs an account anyway, and a phone where nobody has signed in cannot get
past sign-in offline. Rejected: Workers KV (invisible to git, one more resource,
1,000 writes a day); a separate username and display name (a second identifier
tied to permanent ids); a password on every switch; a "Use without an account"
link (a second path that only ever shows the sample deck).

**D34. Passwords are stretched on the device; the Worker stores a salted hash
of the result.** The free plan's 10 ms of CPU rules out slow hashing in the
Worker, so PBKDF2 with SHA-256 runs on the device at 600,000 iterations
(OWASP's figure), salted with the person's id: about a quarter of a second in
laptop Chrome (2026-11-03), and expected to stay under a second on a phone. The
Worker never sees a password; it keeps a salted SHA-256 of the key, so a leaked
record still costs 600,000 iterations per guess. Passwords have at least 8
characters, checked on the device. Sign-in says whether the name or the password
was wrong: in a family a clear message is worth more than hiding which names
have accounts, and a rate limit on sign-in slows anyone probing. Changing the
derivation would change every key, so it would need a new salt label
(`court-sense/v2/`) and every account made again. Rejected: hashing in the
Worker (CPU); a fast unsalted hash (cracks quickly); a server pepper (one more
secret whose loss locks everyone out, for records already in a private repo);
one message for both mistakes.

**D35. Sessions are signed tokens with no expiry, checked by their signature
alone.** A phone stays signed in like an installed app. There is no session
store and no account read per request, so each request costs one GitHub call,
and a password reset never signs a device out, so no device stops syncing (PRD
Q23). The cost: deleting an account record only stops new sign-ins under that
name. To cut off one person, Jeremy changes `SESSION_SECRET`, which signs
everyone out once; a device signed out this way keeps its record, unsynced
reviews included, and uploads them after the next sign-in. Rejected: checking
every request against the account record (it cuts off one person alone, but a
reset would sign that person's other devices out until they signed in again); a
session store in KV; expiring sessions with refresh (more device logic for a
family app).

**D36. "Forgot your password?" means ask Jeremy: he deletes the account record,
and the person creates the account again under the same name.** No email for now
(PRD Q15). Jeremy's condition (2026-11-03) is that a reset must not cost anyone
their progress, and this design meets it by construction: the account record
holds only the password check, progress lives under `progress/<id>/`, which a
reset never touches, and the person's devices stay signed in through the reset
and keep syncing (D35). Safeguards: the sign-in screen opened from Settings fills
in the person's name in both modes, so the account comes back under the same id;
the Forgot line says to create the account again with the same name; a failure
on the server is a 502, which never signs a device out; and Remove stays the only
thing that erases a device's record, and it asks first. Jeremy can reset from
GitHub's website on his phone, and the person picks the new password, so there
are no temporary passwords and no admin page. Rejected: a reset command that
sets a temporary password (it keeps progress just as well, but adds a command
and a change-password screen); emailed resets (not now; they would need a
sending domain verified with an email service). Accepted cost: between the reset
and the new sign-up, anyone with the family code could take the name; nothing is
deleted even then, and Jeremy deletes the wrong record and changes
`SESSION_SECRET` so the person can create theirs. Amended 2026-11-05: an account
file that holds no record (blank, cut short, or edited by hand) counts as
deleted, so emptying it on GitHub's website resets the password too. The reset
drill found Delete file easy to miss on a phone, and a file emptied instead had
left the name stuck: sign-in said the server was down, and sign-up that the name
was taken. Sign-up now replaces such a file by its own sha, taken from the same
answer as its content, so a real record is never overwritten.

**D37. Choosing an answer plays it out, and the picture stops below the phone's
status bar.** On his phone the green arrow simply appeared when he chose, and
Jeremy asked for the second half of the play instead (2026-11-05). Now a timed
card plays on from the freeze to the moment of contact, with the players where
the lead-in moves them, and then on every court card your shot flies from the
contact point to its target with the green path growing behind the ball, as
Watch the play and Watch again already did (D25). An answer that is only where
to move still shows its arrows at once: a move has no flight, and most moves in
the deck are yours, so playing one out would move the camera. With reduced
motion the finished picture shows at once. Watch again during the flight starts
the play over; on a timed card it used to leave the flight running beside it.
Before an answer, R on a card without a clock replays their shot and stops at
contact; it used to fly the answer as well, showing where it goes. In the same
round, Play and Watch again stop the picture 12 px below the status bar: full
screen on an iPhone, the time, a timer and the Dynamic Island sat over the far
court. The margin is the safe-area inset, which is 0 where nothing covers the
page.
