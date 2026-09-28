---
name: map-speakers
description: Identify who each diarized speaker (SPEAKER_00, SPEAKER_01...) is in one transcribed podcast episode and write the speaker map. Use when asked to map speakers for an episode, or before preparing a transcript that has no speaker map.
argument-hint: <episode_id>
---

# Map speakers for episode $ARGUMENTS

1. Read `prompts/speaker-map.md` in full. It defines the method and output format.
2. Find the data directory: `echo "${PIQ_DATA_DIR:-../pickleball-iq-data}"`. Call it DATA below.
3. Read the transcript `DATA/work/transcripts/$ARGUMENTS.json`. It can be large: read the first ten minutes of segments closely, then search the rest for names and aliases from `pipeline/config/speakers.yaml` (for example with `grep -n` on the text, or a short Python snippet that prints segments mentioning a name).
4. Read the episode's title and show notes from `DATA/work/episodes/<show_id>.json` (the show id is the prefix of the episode id).
5. Write `DATA/work/speakers/$ARGUMENTS.json` exactly as the prompt specifies.
6. Report each mapping with its confidence in one line, plus any proposed registry additions. If `needs_review` is true, say what Jeremy should listen to and at which timestamps.

Do not edit `pipeline/config/speakers.yaml` yourself. Propose additions and let Jeremy verify credentials.
