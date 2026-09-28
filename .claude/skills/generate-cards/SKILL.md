---
name: generate-cards
description: Generate quiz cards and court scene data for active principles, check the scenes, and validate. Use after merging principles, or when asked to make or update cards.
argument-hint: "[principle_id ...] (optional: only these principles)"
---

# Generate cards

1. Read `prompts/generate-cards.md` in full, including the formation and height tables. Skim `docs/rendering-notes.md` for the coordinate system.
2. Find the data directory: `echo "${PIQ_DATA_DIR:-../pickleball-iq-data}"`. Call it DATA below.
3. Load `DATA/content/principles.json` (active only) and the existing `DATA/content/cards.json` and `DATA/content/scenes.json`. If `$ARGUMENTS` lists principle ids, work only on those. Otherwise work on principles that have no cards yet.
4. Write cards and scenes following the prompt. Keep existing ids stable.
5. Check the scenes: `node tools/check-scenes.mjs DATA/content/scenes.json`. Fix every error.
6. Validate: `python pipeline/piq.py validate`.
7. Report the number of cards by type, and list two or three new scene ids for Jeremy to inspect in the lab (`npm run serve`, then http://localhost:8000/lab.html, paste the scene JSON).
