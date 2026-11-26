"""Independent validation of data/*.json (does not import the builder).
Re-reads the raw captured page script and checks every schedule value against it, plus schema rules."""
import json, pathlib, re, sys
from bs4 import BeautifulSoup
ROOT = pathlib.Path(__file__).resolve().parents[2]
D = ROOT / "data"
FILES = "source_inventory exercises full_body_exercises workout_schedule programme_phases progression_rules assessment_rules nutrition_rules missed_day_rules source_evidence".split()
STATUS = {"VERIFIED", "PARTIALLY_VERIFIED", "UNAVAILABLE", "CONFLICTING"}
REQ = {"field", "value", "source_url", "source_type", "evidence_location", "confidence", "verification_status"}
errs = []
data = {f: json.loads((D / f"{f}.json").read_text()) for f in FILES}

n = 0
def walk(o, path):
    global n
    if isinstance(o, dict):
        if "verification_status" in o:
            n += 1
            miss = REQ - set(o)
            if miss: errs.append(f"{path}: missing {miss}")
            if o["verification_status"] not in STATUS: errs.append(f"{path}: bad status")
            if o["value"] is None and o["verification_status"] != "UNAVAILABLE": errs.append(f"{path}: null but {o['verification_status']}")
            if o["verification_status"] == "UNAVAILABLE" and not (o.get("unavailable_reason") and o["value"] is None): errs.append(f"{path}: UNAVAILABLE without reason/null")
            if o["verification_status"] == "CONFLICTING" and not o.get("conflicting_values"): errs.append(f"{path}: CONFLICTING without both values")
            if not str(o["source_url"]).startswith("https://"): errs.append(f"{path}: bad url")
        for k, v in o.items(): walk(v, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o): walk(v, f"{path}[{i}]")
for f in FILES:
    if f in ("source_inventory", "source_evidence"): continue
    walk(data[f], f)

# schedule vs raw page script
s = BeautifulSoup((ROOT / "raw/ab60/landing_embed_raw.html").read_text(), "lxml")
sc = next(x.get_text() for x in s.find_all("script") if "var DAYS" in x.get_text())
i = sc.index("var DAYS = ") + 11
DAYS = json.JSONDecoder().raw_decode(sc[i:])[0]
days = data["workout_schedule"]["days"]
if [d["day"] for d in days] != list(range(1, 61)): errs.append("day numbers not 1..60")
LET = {"ABS A": "A", "ABS B": "B", "ABS C": "C", "FULL BODY": "F", "FULL BODY + LONG WALK": "F", "WALK": "W", "REST + WAIST CHECK": "R", "FINAL TEST": "T"}
for d, r in zip(days, DAYS):
    f = d["fields"]
    if LET[f["category"]["value"]] != r["l"]: errs.append(f"day {r['d']} category")
    if f["steps_target"]["value"] != r["s"]: errs.append(f"day {r['d']} steps")
    if f["phase"]["value"]["name"] != r["pn"]: errs.append(f"day {r['d']} phase")
    got = [(e["name"]["value"], e["prescription"]["value"]["raw"]) for e in d["exercises"]]
    if got != [tuple(b) for b in r["b"]]: errs.append(f"day {r['d']} exercises {got} != {r['b']}")
    if [e["order"]["value"] for e in d["exercises"]] != list(range(1, len(got) + 1)): errs.append(f"day {r['d']} order")
    if r["r"] and f["rounds"]["value"] != r["r"]: errs.append(f"day {r['d']} rounds")
    if r["r"] and f["rest_seconds"]["value"] != r["rest"]: errs.append(f"day {r['d']} rest")
    if (r["l"] in "ABCF") != bool(d["exercises"]): errs.append(f"day {r['d']} exercise presence")
    if f["test_day"]["value"] != (r["d"] in (1, 15, 29, 43, 60)): errs.append(f"day {r['d']} test flag")

# Only the 11 named exercises exist
allowed = {"Front plank", "Reverse crunch", "Flat-back bug", "Side plank", "Squeeze crunch", "Hollow hold", "Lying leg raise", "Push-ups", "Split squats", "Table rows", "Couch hip thrust"}
used = {e["name"]["value"] for d in days for e in d["exercises"]}
if not used <= allowed: errs.append(f"unexpected exercises {used - allowed}")
if used != allowed: errs.append(f"missing exercises {allowed - used}")
if [e["name"]["value"] for e in data["exercises"]["exercises"]] != ["Front plank", "Reverse crunch", "Flat-back bug", "Side plank", "Squeeze crunch", "Hollow hold", "Lying leg raise"]: errs.append("ab move list/order")
if [e["name"]["value"] for e in data["full_body_exercises"]["exercises"]] != ["Push-ups", "Split squats", "Table rows", "Couch hip thrust"]: errs.append("full body list")
# no telegram data
blob = " ".join((D / f"{f}.json").read_text() for f in FILES if f != "source_inventory")
for bad in ("t.me/", "license key", "/deleteme"):
    if bad in blob.lower(): errs.append(f"telegram/licence text found: {bad}")
# phase structure
ph = {p["name"]: (p["day_range"]["value"]["first"], p["day_range"]["value"]["last"]) for p in data["programme_phases"]["phases"]}
if ph != {"Foundation": (1, 14), "Build": (15, 28), "Carve": (29, 42), "Reveal": (43, 60)}: errs.append(f"phases {ph}")
# evidence ids referenced exist
ev = {e["id"] for e in data["source_evidence"]["evidence"]}
def ids(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "evidence_ids":
                for x in v:
                    if x not in ev: errs.append(f"unknown evidence id {x}")
            else: ids(v)
    elif isinstance(o, list):
        for v in o: ids(v)
for f in FILES: ids(data[f])

print(f"records checked: {n}; files: {len(FILES)}; errors: {len(errs)}")
for e in errs[:30]: print(" -", e)
sys.exit(1 if errs else 0)
