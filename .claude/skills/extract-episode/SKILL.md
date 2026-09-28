---
name: extract-episode
description: Extract actionable, attributed, endorsement-labeled pickleball tips from one prepared podcast transcript into JSONL. Use when asked to extract tips from an episode.
argument-hint: <episode_id>
---

# Extract tips from episode $ARGUMENTS

1. Read `prompts/extract-tips.md` in full. It is the rulebook, including the endorsement table and the worked examples.
2. Find the data directory: `echo "${PIQ_DATA_DIR:-../pickleball-iq-data}"`. Call it DATA below.
3. Read `DATA/work/prepared/$ARGUMENTS.md`. If it does not exist, run `python pipeline/piq.py prepare --episodes $ARGUMENTS`. If that reports a missing speaker map, stop and suggest `/map-speakers $ARGUMENTS` first.
4. Work through the whole transcript in order. Check the speaker legend for who counts as a pro before labeling any endorsement.
5. Write `DATA/work/tips/$ARGUMENTS.jsonl`, one raw tip per line, no other text.
6. Validate: `python pipeline/piq.py validate --file DATA/work/tips/$ARGUMENTS.jsonl --kind raw-tip`. Fix every problem and re-run until it reports all files valid.
7. Report: the number of tips by endorsement status, how many need review and why (grouped), and any concern about the speaker map. Do not paste the tips.

Rules that matter most: paraphrase rather than quote; `why` stays null unless a speaker gave a reason; your own observations go only in `claude_note`; soft pushback from a pro counts as refutation; when unsure, choose the more conservative status and flag it.
