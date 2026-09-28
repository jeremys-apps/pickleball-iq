---
name: merge-principles
description: Merge reviewed raw tips from all episodes into deduplicated principles with sources, refutation handling, tensions and priorities. Use after extraction and review, or when asked to update principles.
---

# Merge principles

1. Read `prompts/merge-principles.md` in full.
2. Find the data directory: `echo "${PIQ_DATA_DIR:-../pickleball-iq-data}"`. Call it DATA below.
3. Check the review queue first: `python pipeline/piq.py review-list 2>&1 | tail -1`. If tips are still waiting, tell Jeremy and ask whether to merge anyway (unreviewed tips flagged `needs_review` are skipped either way).
4. Load every `DATA/work/tips/*.jsonl`, apply `DATA/work/review/decisions.jsonl` (drop rejected, apply edits), and load the existing `DATA/content/principles.json` if present. For large corpora, write a short Python script to load, filter and group candidates by `topic`, then do the judgment work (grouping, refutations, statements) yourself topic by topic.
5. Write the complete `DATA/content/principles.json` and `DATA/work/merge-report.md` as the prompt specifies.
6. Run `python pipeline/piq.py validate` and fix every problem.
7. Summarize: principles added, updated and struck, the tensions found, and the ten highest priorities.
