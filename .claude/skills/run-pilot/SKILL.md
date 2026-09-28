---
name: run-pilot
description: Run the Phase 1 pilot end to end for one podcast - pick the first episodes, download, transcribe, map speakers, extract tips, run the review queue, merge, generate cards, build the deck, and prepare the listening spot-check. Use when asked to run the pilot or to process the first episodes of a show.
argument-hint: "[show_id] [count]  (default: cheatcode 5)"
---

# Run the pilot

Arguments: `$ARGUMENTS`. The first word is a show id from `pipeline/config/sources.yaml`
(default `cheatcode`), the second the number of episodes (default 5). Episodes are
taken oldest first, so "the first five" means the show's first five episodes.

You do all of the pipeline work. Stop for Jeremy only for one-time setup you cannot
do for him, for decisions on flagged tips, for the listening spot-check, and before
pushing to GitHub. Commands below use bash syntax, which also works in Git Bash on Windows.
Let DATA be `${PIQ_DATA_DIR:-../pickleball-iq-data}`.

## 0. Preflight

Check each item and report everything missing at once, with the fix:

- `python pipeline/piq.py --help` runs (install `pipeline/requirements.txt` if not).
- `ffmpeg -version` runs.
- WhisperX: the `transcribe.command` (from `pipeline/config/piq.local.yaml`, merged over `piq.yaml`) runs with `--help`. Machine settings live in that local file; a 6 GB card needs `batch_size: 4`.
- `HF_TOKEN` is set, and Jeremy has accepted the terms for the pyannote model WhisperX uses (`pyannote/speaker-diarization-community-1` in the current README). You cannot accept those terms for him. Claude Code sessions started before the variable was set do not see it; read it from the user registry at run time or restart the session.
- A GPU: `nvidia-smi`. Without one, warn that five hour-long episodes can take most of a day on CPU (set `device: cpu` and `compute_type: int8`) and ask whether to continue.
- DATA exists and is a git repository with a private GitHub remote. If not, set it up as in `pipeline/README.md`. Creating the private GitHub repository needs Jeremy, or `gh repo create <name> --private` if the GitHub CLI is signed in.

## 1. Pick the episodes

```bash
python pipeline/piq.py feeds --show <show>
python pipeline/piq.py status --show <show> --oldest-first --limit <count>
```

Show Jeremy the titles. If one is mostly introductions or news with little
instruction, suggest swapping in the next episode, and take his call.

## 2. Download and transcribe

```bash
python pipeline/piq.py download --episodes <ids>
python pipeline/piq.py transcribe --episodes <ids> --dry-run
```

Start the real transcription in the background with output to a log, for example
`python pipeline/piq.py transcribe --episodes <ids> > "$DATA/work/transcribe.log" 2>&1 &`
(or Claude Code's background command support). Check the log every few minutes rather
than waiting on one long command. Tell Jeremy roughly how long it will take.

## 3. Speakers and extraction

For each episode in order: follow `.claude/skills/map-speakers/SKILL.md`, run
`python pipeline/piq.py prepare --episodes <id>`, then follow
`.claude/skills/extract-episode/SKILL.md`. Give each episode a fresh context: a
subagent per episode if available, otherwise the headless `claude -p` loop in
`pipeline/README.md`. If a speaker map needs review, ask Jeremy before extracting
that episode.

## 4. Review queue

Follow `.claude/skills/review-queue/SKILL.md` with Jeremy. Offer him the choice:
go through each flagged tip with your recommendation, or accept all your
recommendations and rely on the spot-check.

## 5. Principles, cards, deck

Follow `.claude/skills/merge-principles/SKILL.md`, then
`.claude/skills/generate-cards/SKILL.md`, then:

```bash
python pipeline/piq.py validate
python pipeline/piq.py build-deck
node tools/check-scenes.mjs "$DATA/content/scenes.json"
```

## 6. Spot-check (Jeremy listens)

```bash
python pipeline/piq.py spotcheck --episodes <ids> --n 10
```

Give Jeremy the page it prints. He listens to ten short clips, answers three
questions per clip, and pastes the results back to you. Nine of ten fully right
passes. If it fails, find the cause (transcription, speaker map, or extraction
rules), fix it, re-run the affected steps, and spot-check again.

## 7. Publish to the data repo

Show `git status` for DATA. Confirm that no audio or clips are staged
(`work/audio/` and `work/spotcheck/*/clips/` are ignored). Ask Jeremy before
committing and pushing.

## Report

Episodes processed; tips by endorsement status; principles added, struck and in
tension; cards by type and by category; the spot-check result; and anything that
needs his decision, such as speakers to add to the registry.
