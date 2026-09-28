# Map diarized speakers to people

WhisperX labels voices SPEAKER_00, SPEAKER_01, and so on. Your job is to say who
each label is, using evidence from the episode, so every tip can be attributed.

## Inputs

- The transcript: `<data>/work/transcripts/<episode_id>.json` (segments with `speaker`, `start`, `text`).
- The episode record in `<data>/work/episodes/<show_id>.json` (title, show notes).
- The registry: `pipeline/config/speakers.yaml` (ids, names, aliases, tiers).

## Method

1. Read the first ten minutes closely. Hosts introduce themselves and guests there.
2. Collect direct evidence for each label:
   - Direct address: SPEAKER_01 says "Mircea, what do you think?" and SPEAKER_00 answers. That points to SPEAKER_00 being Mircea.
   - Self-reference: "as a neurologist", "when I won Nationals", "on my channel".
   - Introductions: "I'm here with Tanner Tomassi".
   - Show notes that name the guest.
3. Check consistency across the episode. Diarization sometimes splits one voice into two labels (both map to the same id) or merges two voices into one label (flag it).
4. Never map a label to a registry id without evidence you can cite by timestamp.

## Output

Write `<data>/work/speakers/<episode_id>.json`:

```json
{
  "episode_id": "402p-20240115-af7573",
  "map": {
    "SPEAKER_00": { "speaker_id": "michael-oneal", "confidence": "high", "evidence": "[00:00:05] opens the show as host; [00:03:12] called Michael by SPEAKER_01" },
    "SPEAKER_01": { "speaker_id": "mircea-morariu", "confidence": "high", "evidence": "[00:03:12] addressed as Mircea; [00:07:40] mentions his neurology practice" },
    "SPEAKER_02": { "speaker_id": "unknown-speaker_02", "confidence": "low", "evidence": "Two short turns near 00:52:00; possibly a listener clip" }
  },
  "proposed_registry_additions": [
    { "name": "Guest Name", "suggested_tier": "unknown", "evidence": "Introduced at 00:01:30 as a touring pro; verify before adding" }
  ],
  "notes": ["SPEAKER_03 appears to be the same voice as SPEAKER_01 after 01:10:00 (diarization split)."],
  "needs_review": false
}
```

Rules:

- Use `unknown-<label in lowercase>` for anyone you cannot identify.
- A person who is not in the registry stays unknown in the map. Propose them under `proposed_registry_additions` for Jeremy to verify and add. Do not guess a tier from vibes; cite what was said.
- Set `needs_review: true` if any label that speaks more than two minutes is below high confidence, or if you suspect a split or merge.
- Map every label that appears in the transcript.
