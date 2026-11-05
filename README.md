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
npm test             # renderer, scheduler, progress, sync, sign-in Worker and UI tests
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
1. Create a free GitHub organization from your personal account (a namespace you own, not a second login) and transfer or push this repository there. It contains no podcast content, so make it public: GitHub Pages is free only for public repositories. The organization gives the app its own origin, `<org>.github.io`, so the sign-in sessions it stores are not shared with the other Pages project on your account (PRD section 9).
2. Settings, Pages, Source: **GitHub Actions**. The workflow in `.github/workflows/pages.yml` publishes `app/`. Run it once by hand from the Actions tab after switching the source; pushes made before the switch fail at the deploy step.
3. Create the private data repository under your personal account (see `pipeline/README.md`) and a fine-grained
   token limited to it with Contents read and write and no expiration. It goes only into the sign-in Worker, never onto a device.
4. Deploy the sign-in Worker (`server/`) on a free Cloudflare account: `cd server && npm install && npx wrangler login && npx wrangler deploy`, picking a `workers.dev` subdomain when asked. Then `npx wrangler secret put` three times: `GITHUB_TOKEN` (the token), `SESSION_SECRET` (32 random bytes, for example the output of `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) and `FAMILY_CODE` (a few words you give the family). The Worker's address goes in `ACCOUNT_API` (`app/src/store/account.js`) and in `connect-src` in `app/index.html`; the app's origin goes in `ALLOWED_ORIGINS` (`server/wrangler.toml`). Later deploys are `npx wrangler deploy`.
5. Open the app and create your account: your name as the username, a password and the family code. Create yours before you share the code, so nobody else can take your name and the progress filed under it. On your other devices, sign in with the same username and password.
6. On the phone, use Share, Add to Home Screen, so it runs full screen and keeps its storage.

## Family

Several people can share one deck. Each person creates an account in the app,
with their name as the username, a password of at least 8 characters and the
family code, then signs in on every device they use. The app keeps a record per
person on the device and a folder per person in the data repository, so nobody's
reviews touch anyone else's. On a shared device, Home says who is playing, and
Settings lists the people with Switch, Remove and Add a person, which signs
someone in. Switching needs no password.

A forgotten password: delete the person's account file in the data repository,
`accounts/<name>.json` (for Mary Ann, `accounts/mary-ann.json`), and the person
creates the account again under the same name with the family code. On GitHub's
website, which works from a phone: open the file, open the ⋯ menu at the top
right of the file, choose Delete file, then Commit changes. Emptying the file
and committing works too: a file that holds no account counts as deleted. Their
progress is kept: a reset never touches `progress/`, and their devices stay
signed in.

To cut someone off, delete their account record and change the session key
(`cd server && npx wrangler secret put SESSION_SECRET`, with a new value).
Everyone signs in again once, and nobody loses a review. If the family code
leaks, change `FAMILY_CODE` as well, and delete any account records and progress
folders you do not recognize.



## Layout

```
app/        the web app (renderer, scheduler, UI, lab, service worker)
server/     the sign-in Worker (Cloudflare): accounts, sessions, the path-checked pass-through to the data repo
schemas/    JSON Schemas for tips, principles, scenes, cards, deck, progress, accounts
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
