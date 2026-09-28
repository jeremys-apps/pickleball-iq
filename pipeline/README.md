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
  progress/               written by the app, one file per device
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

WhisperX pins its own PyTorch build, so give it a separate environment:

```bash
python -m venv ~/.venvs/whisperx && source ~/.venvs/whisperx/bin/activate   # Scripts/activate on Windows
# On Windows with an NVIDIA GPU, install the CUDA build of PyTorch first (pytorch.org lists the command)
pip install whisperx            # needs ffmpeg on PATH; CUDA for GPU speed
whisperx --help                 # confirm the flags piq.py uses still exist
```

Diarization uses pyannote models from Hugging Face. Create a read token, accept
the terms on the model pages the WhisperX README lists, and export it:

```bash
export HF_TOKEN=hf_...
```

Set `transcribe.command` in `config/piq.yaml` to the full path of that
environment's `whisperx` if it is not on your PATH.

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
