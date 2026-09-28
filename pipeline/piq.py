#!/usr/bin/env python3
"""Court Sense content pipeline.

Stages (who does each):
  feeds        script   resolve RSS feeds, write episode manifests
  download     script   fetch episode audio
  transcribe   script   WhisperX with diarization (GPU strongly recommended)
  map-speakers Claude   /map-speakers skill: SPEAKER_00 -> registry ids
  prepare      script   condensed, speaker-labeled transcript for extraction
  extract      Claude   /extract-episode skill (or `extract-api` with an API key)
  review       you      /review-queue skill, backed by review-list / review-decide
  merge        Claude   /merge-principles skill
  cards        Claude   /generate-cards skill
  validate     script   JSON Schema + cross-reference checks
  build-deck   script   filter by endorsement rules, write deck/deck.json
  spotcheck    you      sample tips, cut audio clips, check labels by ear

Data lives in a clone of your PRIVATE data repo (config data_dir or PIQ_DATA_DIR).
Run `python pipeline/piq.py <command> --help` for options.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SCHEMAS = ROOT / "schemas"
PROMPTS = ROOT / "prompts"

NS = {
    "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
    "podcast": "https://podcastindex.org/namespace/1.0",
    "content": "http://purl.org/rss/1.0/modules/content/",
}
TS_RE = re.compile(r"^\d{2}:[0-5]\d:[0-5]\d$")


# ---------------------------------------------------------------- config

def load_yaml(path: Path) -> dict:
    import yaml

    return yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}


class Ctx:
    def __init__(self, config_path: Path):
        self.config_path = Path(config_path)
        self.cfg = load_yaml(self.config_path)
        cfg_dir = self.config_path.parent
        self.shows = {s["id"]: s for s in load_yaml(cfg_dir / "sources.yaml").get("shows", [])}
        self.speakers = {s["id"]: s for s in load_yaml(cfg_dir / "speakers.yaml").get("speakers", [])}
        self.vocab_path = cfg_dir / "vocab.txt"
        raw = os.environ.get("PIQ_DATA_DIR") or self.cfg.get("data_dir", "../pickleball-iq-data")
        p = Path(raw).expanduser()
        self.data = p if p.is_absolute() else (ROOT / p).resolve()
        self.work = self.data / "work"
        self.content = self.data / "content"

    def out(self, *parts: str) -> Path:
        p = self.data.joinpath(*parts)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def pro_tiers(self) -> set[str]:
        return set(self.cfg.get("deck", {}).get("pro_tiers", ["touring_pro", "senior_pro"]))

    @property
    def provisional_tiers(self) -> set[str]:
        """Speakers whose own advice counts unless a full pro contradicts it, and who cannot endorse others."""
        return set(self.cfg.get("deck", {}).get("provisional_pro_tiers", ["provisional_pro"]))


# ---------------------------------------------------------------- helpers

def hms(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def strip_html(s: str) -> str:
    s = re.sub(r"(?i)<br\s*/?>|</p>|</li>", "\n", s or "")
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in s.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def episode_id(show_id: str, published: dt.datetime | None, guid: str) -> str:
    day = published.strftime("%Y%m%d") if published else "00000000"
    return f"{show_id}-{day}-{hashlib.sha1(guid.encode('utf-8')).hexdigest()[:6]}"


def parse_number(title: str, itunes_episode: str) -> int | None:
    if itunes_episode and itunes_episode.strip().isdigit():
        return int(itunes_episode)
    m = re.match(r"^\s*(?:ep(?:isode)?\.?\s*)?#?(\d{1,4})\s*[:.\-\u2013|]", title or "", re.I)
    return int(m.group(1)) if m else None


def _text(el, tag: str) -> str:
    child = el.find(tag, NS)
    return (child.text or "").strip() if child is not None and child.text else ""


def parse_feed(raw: bytes, show_id: str) -> list[dict]:
    """Parse an RSS 2.0 podcast feed into episode records (newest first)."""
    channel = ET.fromstring(raw).find("channel")
    if channel is None:
        raise ValueError("Not an RSS feed: no <channel> element")
    eps = []
    for it in channel.findall("item"):
        title = _text(it, "title")
        enc = it.find("enclosure")
        audio = enc.get("url") if enc is not None else None
        guid = _text(it, "guid") or audio or _text(it, "link") or title
        pub = _text(it, "pubDate")
        published = None
        if pub:
            try:
                published = parsedate_to_datetime(pub).astimezone(dt.timezone.utc)
            except (TypeError, ValueError):
                published = None
        notes = strip_html(_text(it, "content:encoded") or _text(it, "description") or _text(it, "itunes:summary"))
        transcripts = [
            {"url": t.get("url"), "type": t.get("type")} for t in it.findall("podcast:transcript", NS) if t.get("url")
        ]
        eps.append(
            {
                "id": episode_id(show_id, published, guid),
                "show_id": show_id,
                "guid": guid,
                "title": title,
                "number": parse_number(title, _text(it, "itunes:episode")),
                "published": published.isoformat() if published else None,
                "audio_url": audio,
                "link": _text(it, "link") or None,
                "duration": _text(it, "itunes:duration") or None,
                "show_notes": notes,
                "transcripts": transcripts,
            }
        )
    eps.sort(key=lambda e: e["published"] or "", reverse=True)
    return eps


def http_get(url: str, ua: str, stream: bool = False):
    import requests

    for attempt in range(3):
        try:
            r = requests.get(url, headers={"User-Agent": ua}, timeout=60, stream=stream)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            if attempt == 2:
                raise
            print(f"  retrying after error: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def all_episodes(ctx: Ctx) -> list[dict]:
    eps = []
    for f in sorted((ctx.work / "episodes").glob("*.json")):
        eps.extend(json.loads(f.read_text(encoding="utf-8"))["episodes"])
    return eps


def select(ctx: Ctx, args) -> list[dict]:
    eps = all_episodes(ctx)
    if not eps:
        sys.exit("No episode manifests yet. Run: python pipeline/piq.py feeds")
    if getattr(args, "show", None):
        eps = [e for e in eps if e["show_id"] == args.show]
    if getattr(args, "episodes", None):
        wanted = set(args.episodes.split(","))
        eps = [e for e in eps if e["id"] in wanted]
    if getattr(args, "match", None):
        rx = re.compile(args.match, re.I)
        eps = [e for e in eps if rx.search(e["title"] or "")]
    eps.sort(key=lambda e: e["published"] or "", reverse=not getattr(args, "oldest_first", False))
    if getattr(args, "limit", None):
        eps = eps[: args.limit]
    return eps


def audio_path(ctx: Ctx, ep: dict) -> Path | None:
    hits = [p for p in (ctx.work / "audio").glob(f"{ep['id']}.*") if not p.name.endswith(".part")]
    return hits[0] if hits else None


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def review_decisions(ctx: Ctx) -> dict[str, dict]:
    f = ctx.work / "review" / "decisions.jsonl"
    return {d["tip_id"]: d for d in load_jsonl(f)} if f.exists() else {}


def stage_state(ctx: Ctx, ep: dict, decisions: dict | None = None) -> dict:
    eid = ep["id"]
    tips_f = ctx.work / "tips" / f"{eid}.jsonl"
    reviewed = False
    if tips_f.exists():
        decisions = decisions if decisions is not None else review_decisions(ctx)
        pending = [t for t in load_jsonl(tips_f) if t.get("needs_review") and t["id"] not in decisions]
        reviewed = not pending
    return {
        "audio": audio_path(ctx, ep) is not None,
        "transcript": (ctx.work / "transcripts" / f"{eid}.json").exists(),
        "speakers": (ctx.work / "speakers" / f"{eid}.json").exists(),
        "prepared": (ctx.work / "prepared" / f"{eid}.md").exists(),
        "tips": tips_f.exists(),
        "reviewed": reviewed,
    }


STAGES = ["audio", "transcript", "speakers", "prepared", "tips", "reviewed"]


# ---------------------------------------------------------------- commands

def cmd_feeds(ctx: Ctx, args):
    ua = ctx.cfg.get("user_agent", "court-sense-pipeline/0.1 (personal use)")
    for sid, show in ctx.shows.items():
        if args.show and sid != args.show:
            continue
        feed_url = show.get("rss")
        if not feed_url:
            data = http_get(f"https://itunes.apple.com/lookup?id={show['apple_id']}&entity=podcast", ua).json()
            feed_url = data["results"][0]["feedUrl"]
        raw = http_get(feed_url, ua).content
        eps = parse_feed(raw, sid)
        out = ctx.out("work", "episodes", f"{sid}.json")
        out.write_text(
            json.dumps({"show_id": sid, "feed_url": feed_url, "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(), "episodes": eps}, indent=2),
            encoding="utf-8",
        )
        with_tr = sum(1 for e in eps if e["transcripts"])
        print(f"{sid}: {len(eps)} episodes ({with_tr} with publisher transcripts) from {feed_url}")


def cmd_download(ctx: Ctx, args):
    ua = ctx.cfg.get("user_agent", "court-sense-pipeline/0.1 (personal use)")
    for ep in select(ctx, args):
        if not ep.get("audio_url"):
            print(f"{ep['id']}: no enclosure in the feed, skipping")
            continue
        if audio_path(ctx, ep):
            print(f"{ep['id']}: already downloaded")
            continue
        ext = Path(ep["audio_url"].split("?")[0]).suffix.lower() or ".mp3"
        dest = ctx.out("work", "audio", f"{ep['id']}{ext if len(ext) <= 5 else '.mp3'}")
        tmp = dest.with_name(dest.name + ".part")
        print(f"{ep['id']}: downloading {ep['title'][:70]}")
        with http_get(ep["audio_url"], ua, stream=True) as r, open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.rename(dest)
        time.sleep(args.pause)


def cmd_transcribe(ctx: Ctx, args):
    t = ctx.cfg.get("transcribe", {})
    prompt = ctx.vocab_path.read_text(encoding="utf-8").strip() if ctx.vocab_path.exists() else ""
    token = os.environ.get(t.get("hf_token_env", "HF_TOKEN"), "")
    out_dir = ctx.out("work", "transcripts", "_").parent
    for ep in select(ctx, args):
        audio = audio_path(ctx, ep)
        if not audio:
            print(f"{ep['id']}: no audio yet (run download)")
            continue
        if (out_dir / f"{ep['id']}.json").exists() and not args.force:
            print(f"{ep['id']}: already transcribed")
            continue
        cmd = [
            t.get("command", "whisperx"), str(audio),
            "--model", t.get("model", "large-v3"),
            "--language", t.get("language", "en"),
            "--device", t.get("device", "cuda"),
            "--compute_type", t.get("compute_type", "float16"),
            "--batch_size", str(t.get("batch_size", 16)),
            "--output_dir", str(out_dir),
            "--output_format", "all",
        ]
        if prompt:
            cmd += ["--initial_prompt", prompt]
        if t.get("diarize", True):
            if not token and not args.dry_run:
                sys.exit(f"Diarization needs a Hugging Face token in ${t.get('hf_token_env', 'HF_TOKEN')} (see pipeline/README.md).")
            cmd += ["--diarize", "--hf_token", token or "$HF_TOKEN",
                    "--min_speakers", str(t.get("min_speakers", 2)), "--max_speakers", str(t.get("max_speakers", 4))]
        shown = " ".join("$HF_TOKEN" if (token and c == token) else shlex.quote(c) for c in cmd)
        if args.dry_run:
            print(shown)
            continue
        print(f"{ep['id']}: transcribing ({ep['title'][:60]})")
        started = time.time()
        subprocess.run(cmd, check=True)
        print(f"{ep['id']}: done in {(time.time() - started) / 60:.1f} min")


def condense(transcript: dict, speaker_map: dict | None = None, gap_s: float = 1.5, max_turn_s: float = 45) -> list[str]:
    """Merge WhisperX segments into speaker turns, with a fresh timestamp at least every max_turn_s."""
    turns: list[dict] = []
    for s in transcript.get("segments", []):
        text = (s.get("text") or "").strip()
        if not text:
            continue
        spk = s.get("speaker", "SPEAKER_UNKNOWN")
        last = turns[-1] if turns else None
        if last and last["speaker"] == spk and s["start"] - last["end"] <= gap_s and s["end"] - last["start"] <= max_turn_s:
            last["text"] += " " + text
            last["end"] = s["end"]
        else:
            turns.append({"speaker": spk, "start": s["start"], "end": s["end"], "text": text})
    names = {k: v.get("speaker_id", k) for k, v in (speaker_map or {}).items()}
    return [f"[{hms(t['start'])}] {names.get(t['speaker'], t['speaker'])}: {t['text']}" for t in turns]


def cmd_prepare(ctx: Ctx, args):
    for ep in select(ctx, args):
        tr_f = ctx.work / "transcripts" / f"{ep['id']}.json"
        if not tr_f.exists():
            print(f"{ep['id']}: no transcript yet")
            continue
        sp_f = ctx.work / "speakers" / f"{ep['id']}.json"
        smap = json.loads(sp_f.read_text(encoding="utf-8"))["map"] if sp_f.exists() else {}
        if not smap:
            print(f"{ep['id']}: warning, no speaker map yet; lines keep diarization labels")
        show = ctx.shows.get(ep["show_id"], {})
        legend = []
        for label, m in sorted(smap.items()):
            reg = ctx.speakers.get(m.get("speaker_id"), {})
            tier = reg.get("tier", "unknown")
            if tier in ctx.pro_tiers:
                pro = " (counts as a pro)"
            elif tier in ctx.provisional_tiers:
                pro = " (provisional pro: own advice counts unless a full pro contradicts it; cannot endorse others)"
            else:
                pro = ""
            legend.append(f"- {m.get('speaker_id', label)}: {reg.get('name', 'unidentified')}, {tier}{pro}. Diarization label {label}, mapping confidence {m.get('confidence', '?')}.")
        body = [
            f"# Episode {ep['id']}",
            f"Show: {show.get('name', ep['show_id'])}",
            f"Title: {ep['title']}",
            f"Published: {(ep['published'] or '')[:10]}",
            f"Link: {ep.get('link') or ''}",
            "",
            "## Speakers",
            *(legend or ["- No speaker map. Treat every speaker as unknown and set needs_review."]),
            "",
            "## Show notes",
            ep.get("show_notes") or "(none)",
            "",
            "## Transcript",
            *condense(json.loads(tr_f.read_text(encoding="utf-8")), smap),
        ]
        out = ctx.out("work", "prepared", f"{ep['id']}.md")
        out.write_text("\n".join(body) + "\n", encoding="utf-8")
        print(f"{ep['id']}: wrote {out.relative_to(ctx.data)} ({len(body)} lines)")


def cmd_status(ctx: Ctx, args):
    decisions = review_decisions(ctx)
    eps = select(ctx, args)
    print(f"{'episode':<28} {'aud':>3} {'trn':>3} {'spk':>3} {'prp':>3} {'tip':>3} {'rev':>3}  title")
    totals = dict.fromkeys(STAGES, 0)
    for ep in eps:
        st = stage_state(ctx, ep, decisions)
        for k in STAGES:
            totals[k] += st[k]
        marks = " ".join(f"{'x' if st[k] else '.':>3}" for k in STAGES)
        print(f"{ep['id']:<28} {marks}  {ep['title'][:48]}")
    print(f"{len(eps)} episodes: " + ", ".join(f"{k} {v}" for k, v in totals.items()))


def cmd_list(ctx: Ctx, args):
    """Print episode ids that are ready for a stage and not done yet (for shell loops)."""
    # Each stage needs only its direct inputs, so deleting audio after
    # transcription does not block later stages.
    need, prereqs = {
        "download": ("audio", []),
        "transcribe": ("transcript", ["audio"]),
        "speakers": ("speakers", ["transcript"]),
        "prepare": ("prepared", ["transcript", "speakers"]),
        "extract": ("tips", ["prepared"]),
        "review": ("reviewed", ["tips"]),
    }[args.stage]
    decisions = review_decisions(ctx)
    for ep in select(ctx, args):
        st = stage_state(ctx, ep, decisions)
        if all(st[k] for k in prereqs) and (not st[need] or not args.pending):
            print(ep["id"])


def cmd_review_list(ctx: Ctx, args):
    decisions = review_decisions(ctx)
    n = 0
    for f in sorted((ctx.work / "tips").glob("*.jsonl")):
        for t in load_jsonl(f):
            if t.get("needs_review") and t["id"] not in decisions:
                n += 1
                print(json.dumps(t, ensure_ascii=False))
    print(f"# {n} tips waiting for review", file=sys.stderr)


def cmd_review_decide(ctx: Ctx, args):
    if args.decision == "edit" and not args.set:
        sys.exit("edit needs at least one --set field=value")
    edits = dict(s.split("=", 1) for s in (args.set or []))
    rec = {"tip_id": args.tip_id, "decision": args.decision, "edits": edits, "note": args.note or "", "at": dt.datetime.now(dt.timezone.utc).isoformat()}
    with open(ctx.out("work", "review", "decisions.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"{args.tip_id}: {args.decision}")


# ---------------------------------------------------------------- validation

def validators() -> dict:
    from jsonschema import Draft202012Validator, FormatChecker
    from referencing import Registry, Resource

    schemas = {p.name.replace(".schema.json", ""): json.loads(p.read_text(encoding="utf-8")) for p in SCHEMAS.glob("*.schema.json")}
    registry = Registry()
    for s in schemas.values():
        registry = registry.with_resource(s["$id"], Resource.from_contents(s))
    return {k: Draft202012Validator(s, registry=registry, format_checker=FormatChecker()) for k, s in schemas.items()}


def check_items(kind: str, items: list, label: str, v, ctx: Ctx | None = None) -> list[str]:
    errs = []
    for i, it in enumerate(items):
        for e in v.iter_errors(it):
            path = "/".join(str(p) for p in e.absolute_path)
            errs.append(f"{label}[{i}] {it.get('id', '?')} {path}: {e.message[:180]}")
        if kind == "raw-tip" and ctx is not None:
            if not str(it.get("id", "")).startswith(str(it.get("episode_id", "")) + "-t"):
                errs.append(f"{label}[{i}] {it.get('id')}: id must start with its episode_id")
            sid = it.get("speaker_id", "")
            if sid not in ctx.speakers and not sid.startswith("unknown-"):
                errs.append(f"{label}[{i}] {it.get('id')}: speaker_id {sid!r} is not in speakers.yaml")
            en = it.get("endorsement", {})
            eid = en.get("endorser_id")
            if en.get("status") in {"endorsed_explicit", "endorsed_implicit", "qualified", "refuted"}:
                if ctx.speakers.get(eid, {}).get("tier") not in ctx.pro_tiers:
                    errs.append(f"{label}[{i}] {it.get('id')}: status {en.get('status')} needs a pro endorser_id; provisional pros cannot endorse (got {eid!r})")
            if en.get("status") == "pro_stated" and ctx.speakers.get(sid, {}).get("tier") not in ctx.pro_tiers | ctx.provisional_tiers:
                errs.append(f"{label}[{i}] {it.get('id')}: pro_stated but {sid!r} is not a pro tier")
    return errs


def content_errors(ctx: Ctx, principles: list, scenes: list, cards: list, v: dict) -> list[str]:
    errs = check_items("principle", principles, "principles", v["principle"])
    errs += check_items("scene", scenes, "scenes", v["scene"])
    errs += check_items("card", cards, "cards", v["card"])
    pids = {p["id"] for p in principles}
    sids = {s["id"] for s in scenes}
    for kind, arr in (("principle", principles), ("scene", scenes), ("card", cards)):
        seen = set()
        for x in arr:
            if x.get("id") in seen:
                errs.append(f"duplicate {kind} id {x.get('id')}")
            seen.add(x.get("id"))
    for c in cards:
        if c.get("principle_id") not in pids:
            errs.append(f"card {c.get('id')}: unknown principle_id {c.get('principle_id')}")
        if c.get("scene_id") and c["scene_id"] not in sids:
            errs.append(f"card {c.get('id')}: unknown scene_id {c['scene_id']}")
        opts = c.get("options") or []
        if opts:
            n_right = sum(1 for o in opts if o.get("correct"))
            if not 1 <= n_right <= 3:
                errs.append(f"card {c.get('id')}: needs one to three phrasings of the correct play (has {n_right})")
            if len(opts) - n_right < 2:
                errs.append(f"card {c.get('id')}: needs at least two wrong answers (has {len(opts) - n_right})")
        if c.get("mirrorable"):
            if not c.get("scene_id"):
                errs.append(f"card {c.get('id')}: mirrorable needs a court scene")
            words = sorted({m.group(0).lower() for m in SIDE_WORDS.finditer(card_text(c))})
            if words:
                errs.append(f"card {c.get('id')}: mirrorable, but its text names a side ({', '.join(words)}); reword it or set mirrorable to false")
    return errs


TIMED_OPTION_MAX = 60
# Same rule as SIDE_WORDS in app/src/court/mirror.js: any word starting with left
# or right, or southpaw. Mirrorable cards must not contain one.
SIDE_WORDS = re.compile(r"\b(?:left|right)\w*|southpaw\w*", re.I)


def card_text(c: dict) -> str:
    parts = [c.get("prompt"), c.get("explanation"), c.get("answer"), c.get("focus_cue")]
    for o in c.get("options") or []:
        parts += [o.get("text"), o.get("feedback")]
    return " ".join(p for p in parts if p)


def content_warnings(cards: list) -> list[str]:
    """Non-fatal issues. Timed choices are read before Play, but must be quick to find again at the freeze."""
    w = []
    for c in cards:
        if c.get("scene_id") and "mirrorable" not in c:
            w.append(f"card {c['id']}: court card without a mirrorable decision (true or false)")
        if c.get("type") != "timed_decision":
            continue
        for o in c.get("options") or []:
            if len(o.get("text", "")) > TIMED_OPTION_MAX:
                w.append(f"card {c['id']}: timed option {o.get('id')} has {len(o['text'])} characters; keep timed options to {TIMED_OPTION_MAX} or fewer")
    return w


def category_mix(deck: dict) -> dict[str, int]:
    cat = {p["id"]: p.get("category", "strategy") for p in deck["principles"]}
    mix: dict[str, int] = {}
    for c in deck["cards"]:
        k = cat.get(c["principle_id"], "unknown")
        mix[k] = mix.get(k, 0) + 1
    return dict(sorted(mix.items(), key=lambda kv: -kv[1]))


def cmd_validate(ctx: Ctx, args):
    v = validators()
    errs: list[str] = []
    if args.file:
        f = Path(args.file)
        items = load_jsonl(f) if f.suffix == ".jsonl" else json.loads(f.read_text(encoding="utf-8"))
        if isinstance(items, dict) and args.kind != "deck":
            items = [items]
        if args.kind == "deck":
            errs += [f"deck: {e.message[:180]} at {'/'.join(map(str, e.absolute_path))}" for e in v["deck"].iter_errors(items)]
        else:
            errs += check_items(args.kind, items, f.name, v[args.kind], ctx)
    else:
        for f in sorted((ctx.work / "tips").glob("*.jsonl")):
            errs += check_items("raw-tip", load_jsonl(f), f.name, v["raw-tip"], ctx)
        c = ctx.content
        if (c / "principles.json").exists():
            load = lambda n: json.loads((c / n).read_text(encoding="utf-8")) if (c / n).exists() else []
            errs += content_errors(ctx, load("principles.json"), load("scenes.json"), load("cards.json"), v)
            for w in content_warnings(load("cards.json")):
                print(f"warning: {w}")
        deck_f = ctx.data / "deck" / "deck.json"
        if deck_f.exists():
            errs += [f"deck: {e.message[:180]}" for e in v["deck"].iter_errors(json.loads(deck_f.read_text(encoding="utf-8")))]
    for e in errs:
        print(e)
    print(f"{len(errs)} problems found" if errs else "All files valid.")
    sys.exit(1 if errs else 0)


# ---------------------------------------------------------------- deck

def build_deck(ctx: Ctx, principles: list, scenes: list, cards: list, include_samples: bool = False) -> dict:
    d = ctx.cfg.get("deck", {})
    allowed = set(d.get("allowed_endorsements", ["pro_stated", "endorsed_explicit", "endorsed_implicit", "qualified"]))
    allow_notes = bool(d.get("allow_show_notes_sources", False))

    def keep(p: dict) -> bool:
        if p.get("status") != "active":
            return False
        if p.get("sample") and not include_samples:
            return False
        for s in p["sources"]:
            if s["kind"] == "transcript" and s["endorsement"] in allowed:
                return True
            if s["kind"] == "show_notes" and (allow_notes or include_samples):
                return True
            if s["kind"] == "illustrative" and include_samples:
                return True
        return False

    kept = [p for p in principles if keep(p)]
    pids = {p["id"] for p in kept}
    kept_cards = [c for c in cards if c["principle_id"] in pids and (include_samples or not c.get("sample"))]
    sids = {c["scene_id"] for c in kept_cards if c.get("scene_id")}
    kept_scenes = [s for s in scenes if s["id"] in sids]

    speaker_ids, episode_ids, show_ids = set(), set(), set()
    for p in kept:
        for s in p["sources"]:
            if s["kind"] == "transcript":
                speaker_ids.add(s["speaker_id"])
                if s.get("endorser_id"):
                    speaker_ids.add(s["endorser_id"])
                episode_ids.add(s["episode_id"])
            if s.get("show_id"):
                show_ids.add(s["show_id"])
    eps = {e["id"]: e for e in all_episodes(ctx)} if (ctx.work / "episodes").exists() else {}
    episodes = {}
    for eid in sorted(episode_ids):
        e = eps.get(eid)
        if e:
            show_ids.add(e["show_id"])
            episodes[eid] = {"show": ctx.shows.get(e["show_id"], {}).get("name", e["show_id"]), "title": e["title"], "url": e.get("link") or "", "published": (e["published"] or "")[:10]}
    speakers = {}
    for sid in sorted(speaker_ids):
        reg = ctx.speakers.get(sid)
        if reg:
            speakers[sid] = {"name": reg["name"], "tier": reg["tier"], "credential": reg.get("credential", "")}
    shows = {sid: {"name": ctx.shows[sid]["name"]} for sid in sorted(show_ids) if sid in ctx.shows}

    body = {"principles": kept, "scenes": kept_scenes, "cards": kept_cards}
    digest = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:12]
    return {
        "schema_version": 1,
        "deck_id": d.get("deck_id", "court-sense"),
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "content_hash": digest,
        "sample": include_samples,
        "speakers": speakers,
        "shows": shows,
        "episodes": episodes,
        **body,
    }


def cmd_build_deck(ctx: Ctx, args):
    c = ctx.content
    load = lambda n: json.loads((c / n).read_text(encoding="utf-8")) if (c / n).exists() else []
    principles, scenes, cards = load("principles.json"), load("scenes.json"), load("cards.json")
    if not principles:
        sys.exit(f"No principles yet in {c}. Run the merge-principles and generate-cards skills first.")
    v = validators()
    errs = content_errors(ctx, principles, scenes, cards, v)
    if errs:
        print("\n".join(errs))
        sys.exit(f"{len(errs)} problems in content/. Fix them before building.")
    deck = build_deck(ctx, principles, scenes, cards, include_samples=args.include_samples)
    derr = list(v["deck"].iter_errors(deck))
    if derr:
        sys.exit("Built deck failed validation: " + derr[0].message)
    out = Path(args.out) if args.out else ctx.out("deck", "deck.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(deck, indent=1, ensure_ascii=False), encoding="utf-8")
    dropped = len(principles) - len(deck["principles"])
    print(f"Wrote {out}: {len(deck['principles'])} principles ({dropped} filtered out), {len(deck['cards'])} cards, {len(deck['scenes'])} scenes, hash {deck['content_hash']}")
    for w in content_warnings(deck["cards"]):
        print(f"warning: {w}")
    choice = [c for c in deck["cards"] if c.get("options")]
    rotating = sum(1 for c in choice if sum(1 for o in c["options"] if not o.get("correct")) > 3)
    if choice:
        print(f"Choice cards whose wrong answers rotate between showings: {rotating} of {len(choice)} (the rest show all of theirs, shuffled)")
    mix = category_mix(deck)
    if mix:
        total = sum(mix.values())
        print("Cards by category: " + ", ".join(f"{k} {n} ({round(100 * n / total)}%)" for k, n in mix.items()))
    if not deck["cards"]:
        print("Warning: the deck has no cards. Principles need an allowed endorsement (deck.allowed_endorsements in piq.yaml); "
              "sample and show-notes content is excluded unless --include-samples or allow_show_notes_sources.", file=sys.stderr)


# ---------------------------------------------------------------- spot-check

def ts_seconds(ts: str) -> int:
    h, m, sec = (int(x) for x in ts.split(":"))
    return h * 3600 + m * 60 + sec


def sample_spotcheck(tips: list[dict], n: int = 10, seed: int = 1) -> list[dict]:
    """Stratified by endorsement status, so every kind of label gets checked."""
    import random

    rnd = random.Random(seed)
    groups: dict[str, list] = {}
    for t in tips:
        groups.setdefault(t["endorsement"]["status"], []).append(t)
    for g in groups.values():
        rnd.shuffle(g)
    picked: list[dict] = []
    keys = sorted(groups)
    while len(picked) < n and any(groups.values()):
        for k in keys:
            if groups[k] and len(picked) < n:
                picked.append(groups[k].pop())
    return picked


SPOTCHECK_CSS = """
body { font: 16px/1.5 system-ui, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; color: #16212B; }
.tip { border: 1px solid #C9D3CE; border-radius: 10px; padding: 12px 16px; margin: 16px 0; }
.tip h2 { font-size: 17px; margin: 0 0 4px; }
.meta { color: #52616E; margin: 0 0 8px; }
audio { width: 100%; margin: 8px 0; }
fieldset { border: 0; padding: 0; margin: 6px 0; display: flex; gap: 18px; flex-wrap: wrap; }
textarea { width: 100%; min-height: 40px; }
#results { width: 100%; min-height: 160px; font: 12px ui-monospace, monospace; }
"""

SPOTCHECK_JS = """
const rows = [...document.querySelectorAll('.tip')];
function collect() {
  const out = rows.map((r) => {
    const get = (q) => {
      const el = r.querySelector('input[name="' + r.dataset.id + '-' + q + '"]:checked');
      return el ? el.value === 'yes' : null;
    };
    return { id: r.dataset.id, speaker: get('speaker'), label: get('label'), faithful: get('faithful'), note: r.querySelector('textarea').value.trim() };
  });
  const done = out.filter((o) => o.speaker !== null && o.label !== null && o.faithful !== null);
  const right = done.filter((o) => o.speaker && o.label && o.faithful).length;
  document.getElementById('tally').textContent = done.length + ' of ' + out.length + ' checked, ' + right + ' fully right. The pilot passes at ' + Math.ceil(out.length * 0.9) + ' of ' + out.length + '.';
  document.getElementById('results').value = JSON.stringify(out, null, 1);
}
document.addEventListener('change', collect);
document.addEventListener('input', collect);
collect();
"""


def write_spotcheck(ctx: Ctx, picked: list[dict], eps: dict, out_dir: Path, ffmpeg: str | None, before: float = 8.0, after: float = 20.0) -> Path:
    esc = html.escape
    clips = out_dir / "clips"
    parts = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>",
        f"<title>Spot-check, {len(picked)} tips</title><style>{SPOTCHECK_CSS}</style></head><body>",
        "<h1>Spot-check</h1>",
        "<p>Listen to each clip and answer three questions: did the right person say it, is the endorsement label right, and does the tip say what they meant? When you are done, copy the results at the bottom into Claude Code.</p>",
    ]
    for n, t in enumerate(picked, 1):
        ep = eps.get(t["episode_id"], {})
        sp = ctx.speakers.get(t["speaker_id"], {})
        en = t["endorsement"]
        endorser = ctx.speakers.get(en.get("endorser_id") or "", {}).get("name", en.get("endorser_id"))
        label = en["status"] + (f", by {endorser}" if en.get("endorser_id") else "")
        if en.get("evidence"):
            label += f" ({en['evidence']}" + (f", at {en['evidence_timestamp']}" if en.get("evidence_timestamp") else "") + ")"
        start = max(0.0, ts_seconds(t["timestamp_start"]) - before)
        end = ts_seconds(t.get("timestamp_end") or t["timestamp_start"]) + after
        dur = min(90.0, max(15.0, end - start))
        audio = audio_path(ctx, {"id": t["episode_id"]})
        player = f"<p class='meta'>Listen at {esc(t['timestamp_start'])} in the episode (no clip was cut).</p>"
        if ffmpeg and audio:
            clips.mkdir(parents=True, exist_ok=True)
            clip = clips / f"{t['id']}.mp3"
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.2f}", "-i", str(audio),
                            "-t", f"{dur:.2f}", "-vn", "-ac", "1", "-b:a", "64k", str(clip)], check=True)
            player = f"<audio controls preload='none' src='clips/{esc(clip.name)}'></audio><p class='meta'>The clip starts {int(before)} seconds before {esc(t['timestamp_start'])}.</p>"
        q = lambda key, text: (f"<span>{text} <label><input type='radio' name='{esc(t['id'])}-{key}' value='yes'> yes</label> "
                               f"<label><input type='radio' name='{esc(t['id'])}-{key}' value='no'> no</label></span>")
        why = f" <b>Why:</b> {esc(t['why'])}" if t.get("why") else ""
        parts += [
            f"<section class='tip' data-id='{esc(t['id'])}'>",
            f"<h2>{n}. {esc(t['action'])}</h2>",
            f"<p class='meta'>{esc(ep.get('title', t['episode_id']))}, at {esc(t['timestamp_start'])}. Tip {esc(t['id'])}.</p>",
            f"<p><b>Speaker:</b> {esc(sp.get('name', t['speaker_id']))} ({esc(sp.get('tier', t.get('speaker_tier', 'unknown')))}). <b>Label:</b> {esc(label)}.</p>",
            f"<p><b>Situation:</b> {esc(t['situation'])}{why}</p>",
            player,
            "<fieldset>" + q("speaker", "Right speaker?") + q("label", "Right label?") + q("faithful", "Faithful?") + "</fieldset>",
            "<textarea placeholder='Notes (optional)'></textarea></section>",
        ]
    parts += ["<h2>Results</h2><p id='tally'></p><textarea id='results' readonly></textarea>", f"<script>{SPOTCHECK_JS}</script></body></html>"]
    page = out_dir / "index.html"
    page.write_text("\n".join(parts), encoding="utf-8")
    (out_dir / "sample.json").write_text(json.dumps(picked, indent=1, ensure_ascii=False), encoding="utf-8")
    return page


def cmd_spotcheck(ctx: Ctx, args):
    decisions = review_decisions(ctx)
    wanted = set(args.episodes.split(",")) if args.episodes else None
    pool = []
    for f in sorted((ctx.work / "tips").glob("*.jsonl")):
        for t in load_jsonl(f):
            if wanted and t["episode_id"] not in wanted:
                continue
            d = decisions.get(t["id"])
            if (d and d["decision"] == "reject") or (t.get("needs_review") and not d):
                continue  # rejected, or still waiting in the review queue
            pool.append(t)
    if not pool:
        sys.exit("No reviewed tips to sample yet.")
    ffmpeg = None if args.no_clips else shutil.which("ffmpeg")
    if not args.no_clips and not ffmpeg:
        print("ffmpeg was not found, so the page lists timestamps instead of clips.")
    out_dir = ctx.out("work", "spotcheck", dt.datetime.now().strftime("%Y%m%d-%H%M%S"), "index.html").parent
    page = write_spotcheck(ctx, sample_spotcheck(pool, args.n, args.seed), {e["id"]: e for e in all_episodes(ctx)}, out_dir, ffmpeg, args.before, args.after)
    print(f"Spot-check page: {page}\nOpen it in a browser: {page.as_uri()}")


def cmd_extract_api(ctx: Ctx, args):
    """Optional: extraction through the Anthropic API instead of a Claude Code session."""
    try:
        import anthropic
    except ImportError:
        sys.exit("pip install anthropic, and set ANTHROPIC_API_KEY")
    client = anthropic.Anthropic()
    system = (PROMPTS / "extract-tips.md").read_text(encoding="utf-8")
    model = args.model or ctx.cfg.get("extract", {}).get("model", "claude-sonnet-5")
    max_tokens = int(ctx.cfg.get("extract", {}).get("max_tokens", 16000))
    v = validators()
    for ep in select(ctx, args):
        prepared = ctx.work / "prepared" / f"{ep['id']}.md"
        out = ctx.out("work", "tips", f"{ep['id']}.jsonl")
        if not prepared.exists():
            print(f"{ep['id']}: run prepare first")
            continue
        if out.exists() and not args.force:
            print(f"{ep['id']}: already extracted")
            continue
        msg = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prepared.read_text(encoding="utf-8") + "\n\nReturn only JSONL: one raw tip object per line, nothing else."}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        lines = [ln for ln in text.splitlines() if ln.strip().startswith("{")]
        out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        errs = check_items("raw-tip", load_jsonl(out), out.name, v["raw-tip"], ctx)
        print(f"{ep['id']}: {len(lines)} tips, {len(errs)} validation problems" + ("" if not errs else "\n  " + "\n  ".join(errs[:10])))


# ---------------------------------------------------------------- cli

def main(argv=None):
    ap = argparse.ArgumentParser(prog="piq", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(HERE / "config" / "piq.yaml"))
    sub = ap.add_subparsers(dest="cmd", required=True)

    def sel(p):
        p.add_argument("--show")
        p.add_argument("--episodes", help="comma-separated episode ids")
        p.add_argument("--match", help="regex on episode title")
        p.add_argument("--limit", type=int)
        p.add_argument("--oldest-first", action="store_true")
        return p

    p = sub.add_parser("feeds", help="resolve feeds and write episode manifests")
    p.add_argument("--show")
    p.set_defaults(fn=cmd_feeds)
    p = sel(sub.add_parser("download", help="download episode audio"))
    p.add_argument("--pause", type=float, default=1.0, help="seconds between downloads")
    p.set_defaults(fn=cmd_download)
    p = sel(sub.add_parser("transcribe", help="run WhisperX with diarization"))
    p.add_argument("--force", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="print the command only")
    p.set_defaults(fn=cmd_transcribe)
    sel(sub.add_parser("prepare", help="write condensed transcripts for extraction")).set_defaults(fn=cmd_prepare)
    sel(sub.add_parser("status", help="stage checklist per episode")).set_defaults(fn=cmd_status)
    p = sel(sub.add_parser("list", help="episode ids ready for a stage (for loops)"))
    p.add_argument("--stage", required=True, choices=["download", "transcribe", "speakers", "prepare", "extract", "review"])
    p.add_argument("--pending", action="store_true", help="only those not done yet")
    p.set_defaults(fn=cmd_list)
    sub.add_parser("review-list", help="print tips that need review (JSONL)").set_defaults(fn=cmd_review_list)
    p = sub.add_parser("review-decide", help="record a review decision")
    p.add_argument("tip_id")
    p.add_argument("decision", choices=["approve", "reject", "edit"])
    p.add_argument("--set", action="append", help="field=value for edit (repeatable)")
    p.add_argument("--note")
    p.set_defaults(fn=cmd_review_decide)
    p = sub.add_parser("validate", help="check files against the schemas")
    p.add_argument("--file")
    p.add_argument("--kind", default="raw-tip", choices=["raw-tip", "principle", "scene", "card", "deck"])
    p.set_defaults(fn=cmd_validate)
    p = sub.add_parser("build-deck", help="filter content and write deck/deck.json")
    p.add_argument("--include-samples", action="store_true")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_build_deck)
    p = sub.add_parser("spotcheck", help="sample reviewed tips and cut audio clips for a listening check")
    p.add_argument("--episodes", help="comma-separated episode ids (default: all)")
    p.add_argument("--n", type=int, default=10)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--before", type=float, default=8.0, help="seconds of lead-in before each tip")
    p.add_argument("--after", type=float, default=20.0, help="seconds after the tip's end")
    p.add_argument("--no-clips", action="store_true", help="skip ffmpeg; list timestamps only")
    p.set_defaults(fn=cmd_spotcheck)
    p = sel(sub.add_parser("extract-api", help="optional: extract tips through the Anthropic API"))
    p.add_argument("--model")
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_extract_api)

    args = ap.parse_args(argv)
    args.fn(Ctx(Path(args.config)), args)


if __name__ == "__main__":
    main()
