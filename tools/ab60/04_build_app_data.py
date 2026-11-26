"""Step 4: derive the slim runtime file src/data/ab60.json from data/*.json.
Every value keeps its verification status (s) so the app can show it. Nothing is added or computed here."""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
D = lambda n: json.loads((ROOT / "data" / n).read_text())
sv = lambda r: {"v": r["value"], "s": r["verification_status"], **({"alt": r["conflicting_values"]} if "conflicting_values" in r else {}), **({"why": r["unavailable_reason"]} if "unavailable_reason" in r else {})}

sched, phases, ex, fb = D("workout_schedule.json"), D("programme_phases.json"), D("exercises.json"), D("full_body_exercises.json")
nut, ass, prog, miss = D("nutrition_rules.json"), D("assessment_rules.json"), D("progression_rules.json"), D("missed_day_rules.json")

days = []
for d in sched["days"]:
    f = d["fields"]
    days.append({"day": d["day"], "category": sv(f["category"]), "title": sv(f["title"]), "phase": f["phase"]["value"]["name"], "steps": sv(f["steps_target"]),
                 "food": sv(f["food_tip"]), "test": f["test_day"]["value"], "waist": f["waist_check"]["value"],
                 "note": sv(f["day_note"]) if "day_note" in f else None,
                 "rounds": sv(f["rounds"]) if "rounds" in f else None, "rest": sv(f["rest_seconds"]) if "rest_seconds" in f else None,
                 "minutes": sv(f["duration_minutes"]) if "duration_minutes" in f else None,
                 "exercises": [{"name": e["name"]["value"], "rx": sv(e["prescription"])} for e in d["exercises"]]})
for dd in days:
    for e in dd["exercises"]: e["rx"]["v"] = e["rx"]["v"]["raw"]

bykey = lambda rules: {r["field"]: sv(r) for r in rules}
out = {
    "source": {"url": sched["_meta"]["landing_url"], "extractedAt": sched["_meta"]["extracted_at"]},
    "days": days,
    "phases": [{"n": p["number"], "name": p["name"], "first": p["day_range"]["value"]["first"], "last": p["day_range"]["value"]["last"], "rounds": p["ab_rounds"]["value"],
                "steps": p["daily_steps"]["value"], "what": p["what_changes"]["value"]} for p in phases["phases"]],
    "moves": [{"name": e["name"]["value"], "tag": e["tag"]["value"], "how": e["how_to"]["value"], "works": e["works"]["value"], "avoid": e["mistakes_to_avoid"]["value"],
               "easy": e["easier"]["value"], "hard": e["harder"]["value"], "safe": e["be_safe"]["value"], "status": e["how_to"]["verification_status"]} for e in ex["exercises"]],
    "nutrition": bykey(nut["rules"]), "assessment": bykey(ass["rules"]), "progression": bykey(prog["rules"]), "missed": bykey(miss["rules"]),
}
(ROOT / "src" / "data").mkdir(exist_ok=True)
(ROOT / "src" / "data" / "ab60.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
print("bytes", (ROOT / "src" / "data" / "ab60.json").stat().st_size)
