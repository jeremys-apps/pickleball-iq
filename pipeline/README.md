# Content pipeline

Turns podcast episodes into a validated deck of cards. Scripts do the mechanical
steps; Claude Code skills do the reading; you review anything uncertain.

| Stage | Who | Command |
|---|---|---|
| Resolve feeds | script | `python pipeline/piq.py feeds` |
| Download audio | script | `python pipeline/piq.py download --match "stack|floater"` |
| Transcribe + diarize | script | `python pipeline/piq.py transcribe --dry-run`, then without `--dry-run` |
| Map speakers | Claude | `/map-speakers <episode_id>` |
| Prepare transcript | script | `python pipeline/piq.py prepare --episodes <id>` |
| Extract tips | Claude | `/extract-episode <episode_id>` |
| Review | you + Claude | `/review-queue` |
| Merge into principles | Claude | `/merge-principles` |
| Generate cards + scenes | Claude | `/generate-cards` |
| Validate | script | `python pipeline/piq.py validate` |
| Build the deck | script | `python pipeline/piq.py build-deck` |
| Listening spot-check | you | `python pipeline/piq.py spotcheck --episodes <ids>` |

The `/run-pilot` skill runs the whole table for a show's first episodes and
stops only for your setup, review decisions, the spot-check and the push.

`python pipeline/piq.py status` shows a checklist per episode, and
`python pipeline/piq.py list --stage extract --pending` prints ids ready for a stage.

## Two repositories

The code repo (this one) holds no podcast content. Everything derived from
episodes lives in a separate **private** repository, cloned next to this one:

```
pickleball-iq/            this repo (app, pipeline, prompts)
pickleball-iq-data/       PRIVATE
  work/episodes/          feed manifests
  work/audio/             downloaded audio (never committed)
  work/transcripts/       WhisperX output
  work/speakers/          speaker maps
  work/prepared/          condensed transcripts for extraction
  work/tips/              raw tips, one JSONL file per episode
  work/review/            your review decisions
  content/                principles.json, scenes.json, cards.json
  deck/deck.json          what the app loads
  progress/               written by the app, one folder per person, one file per device
```

Create it once:

```bash
cd .. && mkdir pickleball-iq-data && cd pickleball-iq-data && git init
printf 'work/audio/\nwork/spotcheck/*/clips/\n*.part\n' > .gitignore
git add .gitignore && git commit -m "Initialize data repo"
# create a PRIVATE repo on GitHub, then:
git remote add origin git@github.com:<you>/pickleball-iq-data.git && git push -u origin main
```

Point the pipeline elsewhere with `export PIQ_DATA_DIR=/path/to/data`.

## Install

```bash
python -m venv .venv && source .venv/bin/activate   # Git Bash on Windows: source .venv/Scripts/activate
pip install -r pipeline/requirements.txt
python -m unittest discover -s pipeline/tests
```

WhisperX pins its own PyTorch build, so give it a separate environment. As of
WhisperX 3.8 it accepts Python 3.10 to 3.13 and pins PyTorch 2.8; on an NVIDIA
GPU install the CUDA build first, so pip does not pull the CPU build from PyPI:

```bash
python -m venv .venv-whisperx                      # gitignored, inside the repo
source .venv-whisperx/Scripts/activate             # Windows (Git Bash); bin/activate on Linux
pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
pip install whisperx                               # needs ffmpeg on PATH
python -c "import torch; print(torch.cuda.is_available())"
whisperx --help                                    # confirm the flags piq.py uses still exist
```

On a CPU-only machine skip the CUDA line and set `device: cpu`,
`compute_type: int8` in the overlay. A 6 GB GTX 1660 Ti runs `large-v3` in
`float16` with `batch_size: 4`, using about 5 GB of GPU memory.

Diarization uses pyannote models from Hugging Face. Create a read token, accept
the terms on the `pyannote/speaker-diarization-community-1` page (the model the
current WhisperX README names), and make the token available as `HF_TOKEN`: on
Windows a user environment variable (`setx HF_TOKEN hf_...` in a terminal you
then close), on Linux an `export` in the environment file the job sources.
Shells and Claude Code sessions started before the variable was set do not see
it. A failed transcription reports its command with the token masked.

Machine settings go in `config/piq.local.yaml`, gitignored and merged over
`piq.yaml`; copy `piq.local.example.yaml` and set `transcribe.command` to the
full path of that environment's `whisperx`.

**Time.** The two shows total roughly 120 episodes, about 70 hours of audio.
On a recent NVIDIA GPU with `large-v3` that is an afternoon to an overnight run.
On CPU (`device: cpu`, `compute_type: int8`) expect days, so start with the pilot.

**Publisher transcripts.** `feeds` reports how many episodes carry a
`podcast:transcript` tag. Those usually lack speaker labels, which the
endorsement rules depend on, so WhisperX with diarization is still the default.

## The pilot (Phase 1 in docs/PRD.md)

Five episodes chosen for tactical density, end to end, before scaling up:

```bash
python pipeline/piq.py feeds
python pipeline/piq.py status --show 402p --limit 20          # pick five
python pipeline/piq.py download --episodes <id1>,<id2>,...
python pipeline/piq.py transcribe --episodes <ids> --dry-run   # check the command
python pipeline/piq.py transcribe --episodes <ids>
# in Claude Code, for each id:  /map-speakers <id>
python pipeline/piq.py prepare --episodes <ids>
# in Claude Code, for each id:  /extract-episode <id>
# then:  /review-queue   /merge-principles   /generate-cards
python pipeline/piq.py validate && python pipeline/piq.py build-deck
cd ../pickleball-iq-data && git add -A && git commit -m "Pilot deck" && git push
```

## Spot-check

```bash
python pipeline/piq.py spotcheck --episodes <ids> --n 10
```

This samples reviewed tips across every endorsement label, cuts a short clip of
each from the audio with ffmpeg (8 seconds of lead-in, up to 90 seconds long),
and writes a local page with an audio player and three yes-or-no questions per
tip: right speaker, right label, faithful paraphrase. It tallies as you go and
produces a results block to paste back into Claude Code. The pilot passes when
at least nine of ten tips are fully right. Clips stay out of git.

Tips with an `edit` decision are shown as edited. When a label's evidence lies
outside a tip's clip, the page cuts a second clip there. After fixes, sample
again with `--fresh` to leave out every tip shown in an earlier spot-check.

## Always-on worker (a Linux VM)

An idle Linux machine can carry the mechanical stages and keep up with new
episodes (plan.md Track H). Everything it makes is committed to the data repo,
so the machine is disposable. Setup, once:

1. A user for the job, `git`, `ffmpeg`, Python 3.10 to 3.13; clone this repo and
   the private data repo side by side, the latter with a deploy key that can push.
2. The pipeline venv (`pipeline/requirements.txt`) and the WhisperX environment
   above without the CUDA line; `config/piq.local.yaml` with `device: cpu`,
   `compute_type: int8`, `batch_size: 4` and the `whisperx` path.
3. `~/.config/piq/env` (mode 600) exporting `PIQ_CODE_DIR`, `PIQ_DATA_DIR`,
   `HF_TOKEN`, and optionally `PIQ_MAX_EPISODES` (default 2) and
   `PIQ_RUN_CLAUDE` (default 0). Add `.cron.lock` to the data repo's `.gitignore`.
4. The crontab line from the top of `pipeline/cron/new-episodes.sh`.

Each run pulls the data repo, refreshes the feeds, downloads and transcribes at
most `PIQ_MAX_EPISODES` new episodes, and commits the results; logs go to
`~/piq-logs/`. With `PIQ_RUN_CLAUDE=1` and Claude Code installed and signed in
with the subscription (never an API key; the script refuses one), it also maps
speakers, prepares and extracts; episodes whose speaker map asks for review are
left for the laptop (`piq.py list --skip-flagged`). Run the script by hand with
a large `PIQ_MAX_EPISODES` to work through a backlog. Expect CPU transcription
at around real time or slower.

## Bulk extraction

Each episode deserves a fresh context. Headless Claude Code in a shell loop does
that. Flag names can change between versions, so check `claude --help` first:

```bash
for ep in $(python pipeline/piq.py list --stage extract --pending); do
  claude -p "Run the extract-episode skill for episode $ep. Follow .claude/skills/extract-episode/SKILL.md exactly." \
    --allowedTools "Read,Write,Bash(python pipeline/piq.py validate:*)"
done
```

With an Anthropic API key you can instead run
`python pipeline/piq.py extract-api --episodes <ids>` (install `anthropic` first).

## Etiquette

Downloads pause between files (`--pause`). Audio and transcripts are for your
own study: keep them in the private repo or out of git entirely, and never
publish them or the derived deck.
