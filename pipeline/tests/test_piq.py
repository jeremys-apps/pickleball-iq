"""Pipeline tests. Run from the repo root: python -m unittest discover -s pipeline/tests"""
import argparse
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import piq  # noqa: E402

FIX = HERE / "fixtures"
ROOT = HERE.parent.parent
SAMPLE = json.loads((ROOT / "app" / "data" / "deck.sample.json").read_text(encoding="utf-8"))


class TempData(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        cfg_dir = self.tmp / "config"
        shutil.copytree(HERE.parent / "config", cfg_dir)
        cfg = (cfg_dir / "piq.yaml").read_text().replace("data_dir: ../pickleball-iq-data", f"data_dir: {self.tmp / 'data'}")
        (cfg_dir / "piq.yaml").write_text(cfg)
        (cfg_dir / piq.LOCAL_CONFIG_NAME).unlink(missing_ok=True)  # this machine's overlay must not leak into tests
        self.ctx = piq.Ctx(cfg_dir / "piq.yaml")

    def tearDown(self):
        shutil.rmtree(self.tmp)


class ConfigTests(TempData):
    def test_local_overlay_merges_one_level_deep(self):
        cfg_dir = self.ctx.config_path.parent
        (cfg_dir / piq.LOCAL_CONFIG_NAME).write_text("transcribe:\n  device: cpu\n  compute_type: int8\nuser_agent: local-agent\n", encoding="utf-8")
        ctx = piq.Ctx(self.ctx.config_path)
        self.assertEqual(ctx.cfg["transcribe"]["device"], "cpu")
        self.assertEqual(ctx.cfg["transcribe"]["compute_type"], "int8")
        self.assertEqual(ctx.cfg["transcribe"]["model"], "large-v3", "keys the overlay does not name survive")
        self.assertEqual(ctx.cfg["user_agent"], "local-agent", "top-level scalars are replaced")
        self.assertEqual(ctx.cfg["deck"]["deck_id"], "court-sense", "sections the overlay does not name survive")

    def test_without_an_overlay_the_shared_config_stands(self):
        self.assertEqual(self.ctx.cfg["transcribe"]["device"], "cuda")
        self.assertEqual(piq.merge_config({"a": {"x": 1}}, {}), {"a": {"x": 1}})
        self.assertEqual(piq.merge_config({"a": {"x": 1}}, {"a": None}), {"a": None}, "a non-dict value replaces the section")


class FeedTests(unittest.TestCase):
    def test_parse_feed(self):
        eps = piq.parse_feed((FIX / "feed.xml").read_bytes(), "402p")
        self.assertEqual(len(eps), 2)
        newest, oldest = eps
        self.assertEqual(newest["number"], 12)
        self.assertEqual(oldest["number"], 68)
        self.assertEqual(oldest["transcripts"][0]["url"], "https://example.com/68.srt")
        self.assertIn("Drive to set up an easy drop.", oldest["show_notes"])
        self.assertIn("&", oldest["show_notes"])
        self.assertTrue(oldest["published"].startswith("2024-01-15"))
        self.assertEqual(newest["published"][:10], "2025-07-01")

    def test_episode_ids_are_stable_and_match_tip_pattern(self):
        a = piq.parse_feed((FIX / "feed.xml").read_bytes(), "402p")
        b = piq.parse_feed((FIX / "feed.xml").read_bytes(), "402p")
        self.assertEqual([e["id"] for e in a], [e["id"] for e in b])
        tip_re = re.compile(r"^[a-z0-9]+-[a-z0-9-]+-t[0-9]{3}$")
        for e in a:
            self.assertRegex(e["id"], r"^402p-\d{8}-[0-9a-f]{6}$")
            self.assertRegex(e["id"] + "-t001", tip_re)


class TranscribeTests(TempData):
    def test_a_failed_run_reports_the_command_with_the_token_masked(self):
        eid = "cheatcode-20250101-abcdef"
        manifest = {"show_id": "cheatcode", "episodes": [{"id": eid, "show_id": "cheatcode", "title": "Test", "published": "2025-01-01T00:00:00+00:00", "audio_url": "x"}]}
        self.ctx.out("work", "episodes", "cheatcode.json").write_text(json.dumps(manifest), encoding="utf-8")
        # The "audio" is a script that exits non-zero, and the "whisperx" command is this Python, which runs it.
        self.ctx.out("work", "audio", f"{eid}.mp3").write_text("import sys; sys.exit(3)\n", encoding="utf-8")
        self.ctx.cfg["transcribe"]["command"] = sys.executable
        args = argparse.Namespace(show=None, episodes=eid, match=None, limit=None, oldest_first=False, force=False, dry_run=False)
        with mock.patch.dict(os.environ, {"HF_TOKEN": "hf_secret_token"}), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as cm:
                piq.cmd_transcribe(self.ctx, args)
        message = str(cm.exception)
        self.assertIn("exited with status 3", message)
        self.assertIn("$HF_TOKEN", message)
        self.assertNotIn("hf_secret_token", message)


class ListTests(TempData):
    def test_skip_flagged_leaves_out_speaker_maps_that_need_review(self):
        ids = ["cheatcode-20250101-aaaaaa", "cheatcode-20250108-bbbbbb"]
        manifest = {"show_id": "cheatcode", "episodes": [{"id": i, "show_id": "cheatcode", "title": i, "published": f"2025-01-0{n + 1}T00:00:00+00:00"} for n, i in enumerate(ids)]}
        self.ctx.out("work", "episodes", "cheatcode.json").write_text(json.dumps(manifest), encoding="utf-8")
        for i, flagged in zip(ids, (True, False)):
            self.ctx.out("work", "transcripts", f"{i}.json").write_text("{}", encoding="utf-8")
            self.ctx.out("work", "speakers", f"{i}.json").write_text(json.dumps({"map": {}, "needs_review": flagged}), encoding="utf-8")
            self.ctx.out("work", "prepared", f"{i}.md").write_text("# x", encoding="utf-8")

        def listed(skip):
            args = argparse.Namespace(stage="extract", pending=True, skip_flagged=skip, show=None, episodes=None, match=None, limit=None, oldest_first=True)
            with contextlib.redirect_stdout(io.StringIO()) as out:
                piq.cmd_list(self.ctx, args)
            return out.getvalue().split()

        self.assertEqual(listed(False), ids)
        self.assertEqual(listed(True), [ids[1]])
        self.assertFalse(piq.speaker_map_flagged(self.ctx, "cheatcode-20250115-cccccc"), "no map at all is not flagged")


class PrepareTests(TempData):
    def test_prepared_transcript_carries_the_speaker_map_notes_and_flag(self):
        eid = "cheatcode-20250101-abcdef"
        manifest = {"show_id": "cheatcode", "episodes": [{"id": eid, "show_id": "cheatcode", "title": "Test", "published": "2025-01-01T00:00:00+00:00", "show_notes": "Notes."}]}
        self.ctx.out("work", "episodes", "cheatcode.json").write_text(json.dumps(manifest), encoding="utf-8")
        self.ctx.out("work", "transcripts", f"{eid}.json").write_text(json.dumps({"segments": [{"start": 1.0, "end": 3.0, "text": "Hello there.", "speaker": "SPEAKER_00"}]}), encoding="utf-8")
        smap = {"episode_id": eid, "map": {"SPEAKER_00": {"speaker_id": "tanner-tomassi", "confidence": "high", "evidence": "[00:00:01] intro"}},
                "proposed_registry_additions": [], "notes": ["[00:22:35] one SPEAKER_01 segment holds both voices"], "needs_review": True}
        self.ctx.out("work", "speakers", f"{eid}.json").write_text(json.dumps(smap), encoding="utf-8")
        args = argparse.Namespace(show=None, episodes=eid, match=None, limit=None, oldest_first=False)
        with contextlib.redirect_stdout(io.StringIO()):
            piq.cmd_prepare(self.ctx, args)
        text = (self.ctx.work / "prepared" / f"{eid}.md").read_text(encoding="utf-8")
        self.assertIn("- tanner-tomassi: Tanner Tomassi, touring_pro (counts as a pro). Diarization label SPEAKER_00, mapping confidence high.", text)
        self.assertIn("- Note from the speaker map: [00:22:35] one SPEAKER_01 segment holds both voices", text)
        self.assertIn("flagged for review", text)
        self.assertIn("[00:00:01] tanner-tomassi: Hello there.", text)


class TranscriptTests(unittest.TestCase):
    def test_condense_merges_turns_and_restamps_long_ones(self):
        tr = json.loads((FIX / "whisperx.json").read_text())
        lines = piq.condense(tr, {"SPEAKER_01": {"speaker_id": "mircea-morariu"}})
        self.assertEqual(lines[0], "[00:00:05] SPEAKER_00: Welcome back to the show. Today we're talking floaters.")
        self.assertTrue(lines[1].startswith("[00:00:12] mircea-morariu: When it pops up"))
        self.assertTrue(lines[2].startswith("[00:00:40] mircea-morariu: And aim"), "turns longer than 45 s get a new timestamp")
        self.assertEqual(len(lines), 3, "empty segments are dropped")


class ValidationTests(TempData):
    def tip(self, **over):
        t = {
            "id": "402p-20240115-abc123-t001", "schema_version": 1, "episode_id": "402p-20240115-abc123",
            "timestamp_start": "00:14:32", "speaker_id": "michael-oneal", "speaker_tier": "advanced_amateur",
            "endorsement": {"status": "endorsed_implicit", "endorser_id": "mircea-morariu"},
            "category": "strategy", "situation": "Ball floats up", "action": "Attack the middle",
            "confidence": "high", "needs_review": False,
        }
        t.update(over)
        return t

    def test_good_tip_passes(self):
        v = piq.validators()
        self.assertEqual(piq.check_items("raw-tip", [self.tip()], "t", v["raw-tip"], self.ctx), [])

    def test_bad_timestamp_and_non_pro_endorser_fail(self):
        v = piq.validators()
        errs = piq.check_items("raw-tip", [self.tip(timestamp_start="14:32")], "t", v["raw-tip"], self.ctx)
        self.assertTrue(any("timestamp_start" in e for e in errs))
        errs = piq.check_items("raw-tip", [self.tip(endorsement={"status": "endorsed_explicit", "endorser_id": "brodie-smith"})], "t", v["raw-tip"], self.ctx)
        self.assertTrue(any("needs a pro endorser_id" in e for e in errs))
        errs = piq.check_items("raw-tip", [self.tip(endorsement={"status": "pro_stated"})], "t", v["raw-tip"], self.ctx)
        self.assertTrue(any("not a pro tier" in e for e in errs))

    def test_provisional_pro_counts_alone_but_cannot_endorse(self):
        v = piq.validators()
        kevin = self.tip(speaker_id="kevin-tsati", speaker_tier="provisional_pro", endorsement={"status": "pro_stated"})
        self.assertEqual(piq.check_items("raw-tip", [kevin], "t", v["raw-tip"], self.ctx), [])
        by_kevin = self.tip(endorsement={"status": "endorsed_explicit", "endorser_id": "kevin-tsati"})
        errs = piq.check_items("raw-tip", [by_kevin], "t", v["raw-tip"], self.ctx)
        self.assertTrue(any("provisional pros cannot endorse" in e for e in errs))

    def test_mirrorable_cards_must_not_name_a_side(self):
        v = piq.validators()
        fp = [c for c in SAMPLE["cards"] if c["id"] == "c-floater-fp-1"][0]
        bad = dict(fp, prompt="Their righty floats one up. How do you play it?")
        errs = piq.content_errors(self.ctx, SAMPLE["principles"], SAMPLE["scenes"], [bad], v)
        self.assertTrue(any("names a side (righty)" in e for e in errs), errs)
        why = [c for c in SAMPLE["cards"] if c["id"] == "c-floater-why-1"][0]
        errs = piq.content_errors(self.ctx, SAMPLE["principles"], SAMPLE["scenes"], [dict(why, mirrorable=True)], v)
        self.assertTrue(any("mirrorable needs a court scene" in e for e in errs), errs)

    def test_court_cards_need_a_mirror_decision(self):
        warns = piq.content_warnings([{"id": "c-y-1", "type": "scenario_mc", "scene_id": "s-x", "options": []}])
        self.assertTrue(any("mirrorable decision" in w for w in warns))
        self.assertEqual(piq.content_warnings([c for c in SAMPLE["cards"]]), [], "every sample court card has a decision")

    def test_option_pools(self):
        v = piq.validators()
        fp = [c for c in SAMPLE["cards"] if c["id"] == "c-floater-fp-1"][0]
        self.assertEqual(piq.content_errors(self.ctx, SAMPLE["principles"], SAMPLE["scenes"], [fp], v), [], "two phrasings and six wrong answers")
        right = [o for o in fp["options"] if o["correct"]]
        wrong = [o for o in fp["options"] if not o["correct"]]
        errs = piq.content_errors(self.ctx, SAMPLE["principles"], SAMPLE["scenes"], [dict(fp, options=right + wrong[:1])], v)
        self.assertTrue(any("at least two wrong answers" in e for e in errs), errs)

    def test_long_timed_options_warn(self):
        card = {"id": "c-x-1", "type": "timed_decision", "options": [{"id": "a", "text": "x" * 61}, {"id": "b", "text": "short"}]}
        warns = piq.content_warnings([card])
        self.assertEqual(len(warns), 1)
        self.assertIn("timed option a", warns[0])

    def test_sample_content_is_consistent(self):
        errs = piq.content_errors(self.ctx, SAMPLE["principles"], SAMPLE["scenes"], SAMPLE["cards"], piq.validators())
        self.assertEqual(errs, [])


class DeckTests(TempData):
    def principle(self, pid, endorsement="endorsed_implicit", status="active"):
        return {
            "id": pid, "schema_version": 1, "status": status, "category": "strategy", "statement": "s",
            "situation": "s", "action": "a", "priority": 1,
            "sources": [{"kind": "transcript", "raw_tip_id": "402p-20240115-abc123-t001", "episode_id": "402p-20240115-abc123",
                         "speaker_id": "michael-oneal", "speaker_tier": "advanced_amateur", "endorsement": endorsement,
                         "endorser_id": "mircea-morariu", "timestamp": "00:14:32"}],
        }

    def card(self, cid, pid):
        return {"id": cid, "schema_version": 1, "principle_id": pid, "type": "why", "prompt": "p", "answer": "a", "explanation": "e"}

    def test_filters_by_status_and_endorsement(self):
        ps = [self.principle("p-implicit"), self.principle("p-stated", "pro_stated"), self.principle("p-struck", status="struck")]
        cs = [self.card("c-1", "p-implicit"), self.card("c-2", "p-stated"), self.card("c-3", "p-struck")]
        deck = piq.build_deck(self.ctx, ps, [], cs)
        self.assertEqual({p["id"] for p in deck["principles"]}, {"p-implicit", "p-stated"})
        self.assertEqual({c["id"] for c in deck["cards"]}, {"c-1", "c-2"})
        self.assertIn("mircea-morariu", deck["speakers"])
        self.assertEqual(list(piq.validators()["deck"].iter_errors(deck)), [])

        self.ctx.cfg["deck"]["allowed_endorsements"] = ["pro_stated", "endorsed_explicit", "qualified"]
        tight = piq.build_deck(self.ctx, ps, [], cs)
        self.assertEqual({p["id"] for p in tight["principles"]}, {"p-stated"}, "tightening drops implicit endorsements")

    def test_samples_only_on_request(self):
        args = (SAMPLE["principles"], SAMPLE["scenes"], SAMPLE["cards"])
        self.assertEqual(piq.build_deck(self.ctx, *args)["cards"], [])
        with_samples = piq.build_deck(self.ctx, *args, include_samples=True)
        self.assertEqual(len(with_samples["cards"]), len(SAMPLE["cards"]))
        self.assertEqual(list(piq.validators()["deck"].iter_errors(with_samples)), [])


class MixAndSpotcheckTests(TempData):
    def test_category_mix(self):
        deck = piq.build_deck(self.ctx, SAMPLE["principles"], SAMPLE["scenes"], SAMPLE["cards"], include_samples=True)
        self.assertEqual(piq.category_mix(deck), {"strategy": 6, "drill": 1})

    def test_sampling_covers_every_label(self):
        statuses = ["pro_stated"] * 8 + ["refuted"] * 2 + ["endorsed_implicit"] * 3
        tips = [{"id": f"t{i}", "endorsement": {"status": st}} for i, st in enumerate(statuses)]
        picked = piq.sample_spotcheck(tips, n=6, seed=3)
        self.assertEqual(len(picked), 6)
        self.assertEqual({t["endorsement"]["status"] for t in picked}, {"pro_stated", "refuted", "endorsed_implicit"})
        self.assertEqual([t["id"] for t in picked], [t["id"] for t in piq.sample_spotcheck(tips, n=6, seed=3)], "seeded")

    def spot_tip(self, eid):
        return {"id": f"{eid}-t001", "episode_id": eid, "timestamp_start": "00:00:30", "speaker_id": "tanner-tomassi",
                "endorsement": {"status": "pro_stated"}, "situation": "A ball floats up", "action": "Punch it through the middle"}

    def test_page_without_clips(self):
        eid = "cheatcode-20250101-abcdef"
        out = self.ctx.out("work", "spotcheck", "t1", "index.html").parent
        page = piq.write_spotcheck(self.ctx, [self.spot_tip(eid)], {eid: {"title": "Test episode"}}, out, None)
        text = page.read_text()
        self.assertIn("Listen at 00:00:30", text)
        self.assertIn("Tanner Tomassi", text)
        self.assertTrue((out / "sample.json").exists())

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
    def test_page_with_clips(self):
        eid = "cheatcode-20250101-abcdef"
        audio = self.ctx.out("work", "audio", f"{eid}.mp3")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=60", "-ac", "1", str(audio)], check=True)
        out = self.ctx.out("work", "spotcheck", "t2", "index.html").parent
        page = piq.write_spotcheck(self.ctx, [self.spot_tip(eid)], {eid: {"title": "Test episode"}}, out, shutil.which("ffmpeg"))
        self.assertIn("<audio", page.read_text())
        self.assertGreater((out / "clips" / f"{eid}-t001.mp3").stat().st_size, 1000)


if __name__ == "__main__":
    unittest.main()
