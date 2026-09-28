# Working on Court Sense

Read `docs/PRD.md` before starting. Requirement ids (P-, A-, T-, AC-, Q-) are
the vocabulary for planning and commits.

## Commands

| Task | Command |
|---|---|
| All JS tests | `npm test` |
| Pipeline tests | `python -m unittest discover -s pipeline/tests` |
| Serve the app | `npm run serve`, then http://localhost:8000 and /lab.html |
| Check scenes | `node tools/check-scenes.mjs <scenes.json or deck.json>` |
| Reference renders | `npm run renders` (writes docs/img/) |
| Service-worker manifest | `npm run sw` after any change under `app/` |
| Pipeline status | `python pipeline/piq.py status` |
| Listening spot-check | `python pipeline/piq.py spotcheck --episodes <ids>` |
| Whole pilot | `/run-pilot cheatcode 5` |

## Guardrails

- **Never commit podcast-derived content to this repository**: no audio, transcripts, tips, principles, real cards or decks. They belong in the private data repo (`${PIQ_DATA_DIR:-../pickleball-iq-data}`). Only `app/data/deck.sample.json` lives here: illustrative content, two principles of which paraphrase public episode descriptions and say so.
- Follow the endorsement rules exactly as written in `prompts/extract-tips.md`. When unsure, choose the conservative status and flag for review. Never upgrade a status to get content into the deck.
- Keep a pro's words and Claude's observations apart: observations go only in `claude_note`.
- Do not load scripts, fonts or styles from third-party origins. The GitHub token lives in this origin's storage, and the CSP in `app/index.html` enforces this.
- Card, principle and scene ids are permanent once published; progress refers to them.
- A breaking schema change bumps `schema_version` and ships a migration in the same commit.

## Conventions

- Jeremy runs Claude Code on Windows with Git Bash. Keep commands bash-compatible, call `python` rather than `python3`, and avoid tools that exist only on Linux.
- Vanilla ES modules, no build step, no framework (docs/decisions.md D1). Pure functions for anything testable; DOM code stays in `app/src/ui/`.
- Court cards carry a `mirrorable` decision. Mirrorable cards never use a word starting with left or right (write "correct", not "right"); `validate` enforces it.
- Choice cards carry an option pool (one to three correct phrasings, at least two wrong answers). Never assume a fixed order or a single correct option id; use `pickOptions` in `app/src/choices.js`.
- The renderer is deterministic. Scene changes get checked in the lab from both cameras and at phone and laptop sizes before they ship.
- UI text is short, plain and specific. The app speaks to one user, Jeremy.
- Run the tests and `npm run sw` before every commit that touches `app/`.
- GitHub sync has only been tested against a fake API (`tests/github-sync.test.mjs`). Treat the first real sync as a test, with an exported progress backup.
