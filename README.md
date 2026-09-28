# Court Sense

A personal pickleball trainer for court reading: ten minutes a day of
pro-sourced lessons, drawn from your own position on the court and scheduled with
spaced repetition. Works on a phone, better on a laptop.

Start with [docs/PRD.md](docs/PRD.md). Working conventions for Claude Code are in
[CLAUDE.md](CLAUDE.md), and the content pipeline is documented in
[pipeline/README.md](pipeline/README.md).

## Quick start

```bash
npm install          # only jsdom, for the UI tests
npm test             # renderer, scheduler, progress, sync and UI tests
npm run serve        # http://localhost:8000 (the app) and /lab.html (renderer lab)

# On Windows, run these in Git Bash, and use: source .venv/Scripts/activate

python -m venv .venv && source .venv/bin/activate
pip install -r pipeline/requirements.txt
python -m unittest discover -s pipeline/tests
# Machine-specific pipeline settings (GPU size, whisperx path) go in a gitignored overlay:
cp pipeline/config/piq.local.example.yaml pipeline/config/piq.local.yaml
```

![A floater from over your shoulder](docs/img/s-floater-backhands-over_shoulder.svg)

![The same moment from above, with the answer](docs/img/s-floater-backhands-topdown.svg)

The app starts on a sample deck of seven illustrative cards. Open **Cards** to
preview any of them at each aid level, including the timed occlusion card.

## Deploy the app

0. Put the code under git if it is not yet: `git init -b main`, commit everything (`node_modules`, `.venv` and real decks are ignored), and push it to a new repository.
1. Create a free GitHub organization from your personal account (a namespace you own, not a second login) and transfer or push this repository there. It contains no podcast content, so make it public: GitHub Pages is free only for public repositories. The organization gives the app its own origin, `<org>.github.io`, so its stored token is not shared with the other Pages project on your account (PRD section 9).
2. Settings, Pages, Source: **GitHub Actions**. The workflow in `.github/workflows/pages.yml` publishes `app/`. Run it once by hand from the Actions tab after switching the source; pushes made before the switch fail at the deploy step.
3. Create the private data repository under your personal account (see `pipeline/README.md`) and a fine-grained
   token limited to it with Contents read and write and an expiry date.
4. Open the app, go to Settings, enter the repository and token, and name the device.
   Repeat on the second device.
5. On the phone, use Share, Add to Home Screen, so it runs full screen and keeps its storage.



## Layout

```
app/        the web app (renderer, scheduler, UI, lab, service worker)
schemas/    JSON Schemas for tips, principles, scenes, cards, deck, progress
pipeline/   piq.py: feeds, download, transcribe, prepare, review, validate, build-deck
prompts/    rules for each Claude step
.claude/    Claude Code skills
tools/      scene checker, reference renders, service-worker manifest generator
tests/      node --test suites
docs/       PRD, learning design, rendering notes, sources, decisions, reference images
```

## Licenses

Vendored: ts-fsrs (MIT, `app/vendor/ts-fsrs/LICENSE`) and the Barlow fonts (SIL
Open Font License, `app/fonts/OFL.txt`). Choose a license for your own code
before publishing the repository.
