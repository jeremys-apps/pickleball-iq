#!/usr/bin/env bash
# Court Sense: keep up with new episodes (plan.md Track H4). Runs on an always-on
# Linux machine from cron, or by hand for a backlog. Everything it writes goes
# into the data repo, so the machine is disposable.
#
# Environment (put it in ~/.config/piq/env, chmod 600; cron sources it):
#   PIQ_CODE_DIR      clone of the public code repo (this repository)
#   PIQ_DATA_DIR      clone of the private data repo, with a deploy key that can push
#   HF_TOKEN          Hugging Face read token for the pyannote models
#   PIQ_MAX_EPISODES  new episodes to download and transcribe per run (default 2)
#   PIQ_RUN_CLAUDE    1 to also map speakers, prepare and extract with claude -p (default 0)
#   PIQ_LOG_DIR       where run logs go (default ~/piq-logs)
#
# Crontab line, daily at 03:00:
#   0 3 * * * . "$HOME/.config/piq/env" && "$PIQ_CODE_DIR/pipeline/cron/new-episodes.sh"
#
# This machine writes only work/episodes, work/transcripts, work/speakers,
# work/prepared and work/tips. The laptop owns work/review, content and deck;
# the app owns progress. Claude steps run on the Claude Code subscription only;
# the script refuses to run them when an API key is present (plan.md A15).
set -euo pipefail

: "${PIQ_CODE_DIR:?set PIQ_CODE_DIR}" "${PIQ_DATA_DIR:?set PIQ_DATA_DIR}"
MAX="${PIQ_MAX_EPISODES:-2}"
RUN_CLAUDE="${PIQ_RUN_CLAUDE:-0}"
LOG_DIR="${PIQ_LOG_DIR:-$HOME/piq-logs}"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/$(date +%Y%m%d-%H%M%S).log" 2>&1
echo "== $(date -Is) new-episodes: max $MAX, claude $RUN_CLAUDE"

# One run at a time: a transcription can outlast the cron interval.
exec 9>"$PIQ_DATA_DIR/.cron.lock"
if ! flock -n 9; then
  echo "another run holds the lock; exiting"
  exit 0
fi

cd "$PIQ_CODE_DIR"
if [ -f .venv/bin/activate ]; then
  # shellcheck disable=SC1091
  . .venv/bin/activate
fi
piq() { python pipeline/piq.py "$@"; }

git -C "$PIQ_DATA_DIR" pull --rebase --quiet

piq feeds

# Newest first, capped per run: download, then transcribe whatever has audio and no transcript.
ids=$(piq list --stage download --pending | head -n "$MAX" | paste -sd, -)
if [ -n "$ids" ]; then
  piq download --episodes "$ids"
fi
todo=$(piq list --stage transcribe --pending | head -n "$MAX" | paste -sd, -)
if [ -n "$todo" ]; then
  piq transcribe --episodes "$todo"
fi

if [ "$RUN_CLAUDE" = "1" ] && ! command -v claude >/dev/null; then
  echo "claude is not installed; skipping the Claude stages"
  RUN_CLAUDE=0
fi
if [ "$RUN_CLAUDE" = "1" ]; then
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ANTHROPIC_API_KEY is set; refusing to run the Claude stages on a paid key"
    exit 1
  fi
  for ep in $(piq list --stage speakers --pending); do
    claude -p "Run the map-speakers skill for episode $ep. Follow .claude/skills/map-speakers/SKILL.md exactly." \
      --allowedTools "Read,Grep,Write,Bash(python pipeline/piq.py:*)" || echo "map-speakers failed for $ep"
  done
  prep=$(piq list --stage prepare --pending --skip-flagged | paste -sd, -)
  if [ -n "$prep" ]; then
    piq prepare --episodes "$prep"
  fi
  for ep in $(piq list --stage extract --pending --skip-flagged); do
    claude -p "Run the extract-episode skill for episode $ep. Follow .claude/skills/extract-episode/SKILL.md exactly." \
      --allowedTools "Read,Grep,Write,Bash(python pipeline/piq.py:*)" || echo "extract failed for $ep"
  done
fi

cd "$PIQ_DATA_DIR"
for d in work/episodes work/transcripts work/speakers work/prepared work/tips; do
  if [ -d "$d" ]; then git add "$d"; fi
done
if git diff --cached --quiet; then
  echo "nothing new to commit"
else
  git commit --quiet -m "cron: new episodes $(date +%Y-%m-%d)"
  git push --quiet || { git pull --rebase --quiet && git push --quiet; }
fi
echo "== $(date -Is) done"
