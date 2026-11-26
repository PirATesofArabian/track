"""Step 3: build the source dataset (data/*.json) from the captured public sources.

Nothing is invented here. Every value comes from:
  - the page's own public JavaScript data (DAYS / MOVES / string-test constants),
  - the rendered public DOM (captured with Playwright),
  - public preview page images (read by eye + macOS Vision OCR),
  - public landing-page prose.

Verification rules (documented in each file's _meta):
  VERIFIED           value shown in a public PDF preview page image (primary form),
                     or confirmed by 2+ separately authored public sections of the landing page.
  PARTIALLY_VERIFIED value found in only one public place (usually the landing page's data array),
                     and no public preview page shows it. Internal consistency checks passed.
  CONFLICTING        two public places disagree. Both values are kept.
  UNAVAILABLE        not publicly exposed. Value is null and the reason is recorded.
"""
import json, re, pathlib, hashlib, datetime, unicodedata
from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "raw" / "ab60"
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)

LANDING = "https://thereptheory.gumroad.com/l/abs/CHRISTMAS25"
EMBED = "https://thereptheory.gumroad.com/l/ervvan/landing/embed"
cap = json.loads((RAW / "capture_log.json").read_text())
ocr = json.loads((RAW / "ocr.json").read_text())
raw_embed = (RAW / "landing_embed_raw.html").read_text()
soup = BeautifulSoup(raw_embed, "lxml")
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
EXTRACTED_AT = cap["pages"]["landing_embed_raw"]["retrieved"]

# ---------------------------------------------------------------- source data
script = next(s.get_text() for s in soup.find_all("script") if "var DAYS" in s.get_text())
def grab(name):
    i = script.index(f"var {name} = ") + len(f"var {name} = ")
    return json.JSONDecoder().raw_decode(script[i:])[0]
DAYS, MOVES, IMG = grab("DAYS"), grab("MOVES"), grab("IMG")
assert len(DAYS) == 60 and [d["d"] for d in DAYS] == list(range(1, 61)) and len(MOVES) == 7

IMG_URL = lambda f: IMG[f]
PAGE_NO = {f: int(re.search(r"page-(\d+)", f).group(1)) for f in IMG}

# ---------------------------------------------------------------- evidence registry
EV = {}
def ev(eid, url, stype, loc, desc, sha=None):
    EV[eid] = {"id": eid, "source_url": url, "source_type": stype, "evidence_location": loc,
               "description": desc, "retrieved_at": EXTRACTED_AT, "sha256": sha}
ev("JS_DAYS", EMBED, "public_page_script_data", "embed page inline <script>: var DAYS (60 objects)", "The page's own data array that drives the 60-door calendar.", cap["pages"]["landing_embed_raw"]["sha256"])
ev("JS_MOVES", EMBED, "public_page_script_data", "embed page inline <script>: var MOVES (7 objects)", "Move cards: how-to, works, avoid, easy, hard, dose per phase.", cap["pages"]["landing_embed_raw"]["sha256"])
ev("JS_STRING", EMBED, "public_page_script_data", "embed page inline <script>: string test RES + ratio thresholds (r<.48, r<=.5)", "Interactive string-test logic.", cap["pages"]["landing_embed_raw"]["sha256"])
ev("DOM_DOORS", EMBED, "public_page_dom_render", "Playwright: click .door[data-d=N] then read #dd-chips/#dd-t/#dd-l/#dd-pl", "Rendered day panel for each of the 60 doors.", None)
ev("DOM_MOVES", EMBED, "public_page_dom_render", "Playwright: click #holdgrid .hold then read #hd-*", "Rendered move card for each of the 7 moves.", None)
ev("PROSE_WEEK", EMBED, "public_page_prose", "embed HTML: section .week (Day 1..7 labels + minutes)", "Static weekly pattern block on the landing page.", cap["pages"]["landing_embed_raw"]["sha256"])
ev("PROSE_PHASES", EMBED, "public_page_prose", "embed HTML: ul.phases", "Static 4-phase list on the landing page.", cap["pages"]["landing_embed_raw"]["sha256"])
ev("PROSE_FAQ", EMBED, "public_page_prose", "embed HTML: .faq + 'Who it's for' + hero text", "Landing-page prose and FAQ.", cap["pages"]["landing_embed_raw"]["sha256"])
ev("PROSE_SEO", LANDING, "public_page_prose", "landing shell HTML: div.seo-summary", "Public product summary text (also in og/meta).", cap["pages"]["landing_shell"]["sha256"])
ev("META_LD", LANDING, "product_metadata", "landing shell HTML: script[type=application/ld+json]", "schema.org Product metadata.", cap["pages"]["landing_shell"]["sha256"])
for f, i in cap["images"].items():
    ev(f"IMG_{PAGE_NO[f]:02d}", i["url"], "public_preview_image", f"PDF page {PAGE_NO[f]} ({f}); read by eye and OCR (macOS Vision)",
       f"Public preview image of PDF page {PAGE_NO[f]}.", i["sha256"])

CONF = {"VERIFIED": "high", "PARTIALLY_VERIFIED": "medium", "CONFLICTING": "low", "UNAVAILABLE": "none"}
def rec(field, value, status, evid, loc=None, note=None, alt=None, why_null=None):
    e0 = EV[evid[0]]
    r = {"field": field, "value": value, "source_url": e0["source_url"], "source_type": e0["source_type"],
         "evidence_location": loc or e0["evidence_location"], "evidence_ids": evid,
         "confidence": CONF[status], "verification_status": status, "extracted_at": EXTRACTED_AT}
    if note: r["note"] = note
    if alt is not None: r["conflicting_values"] = alt
    if value is None: r["unavailable_reason"] = why_null or note
    return r
def unavailable(field, why):
    r = rec(field, None, "UNAVAILABLE", ["PROSE_SEO"], loc="not publicly exposed", why_null=why)
    r["source_url"] = LANDING; r["source_type"] = "none"
    return r

# ---------------------------------------------------------------- OCR helpers
def norm(s):
    s = unicodedata.normalize("NFKC", s).lower().replace("’", "'").replace("‑", "-")
    return re.sub(r"[^a-z0-9%.\-' ]+", " ", s)
def ocr_words(page):
    t = " ".join(l["text"] for l in ocr[f"page-{page:02d}.jpg"]["lines"])
    return set(norm(t).split())
def in_ocr(page, phrase, thresh=0.9):
    w = norm(phrase).split()
    if not w: return True
    ow = ocr_words(page)
    return sum(x in ow for x in w) / len(w) >= thresh
OCR_FAIL = []
def check_ocr(page, phrase):
    ok = in_ocr(page, phrase)
    if not ok: OCR_FAIL.append((page, phrase))
    return ok

# ---------------------------------------------------------------- prescription parser
RX = re.compile(r"^(\d+)(?:-(\d+))?( s\b)?(?: each (side|leg))?\s*(.*)$")
def parse_rx(raw):
    m = RX.match(raw)
    if not m: return None
    a, b, s, per, q = m.groups()
    q = q.strip(" ,")
    return {"kind": "hold" if s else "reps", "min": int(a), "max": int(b) if b else int(a),
            "unit": "seconds" if s else "reps", "per": per, "qualifier": q or None}

# ---------------------------------------------------------------- independent preview facts
# Read from page 10 (front plank card) and page 18 (week card endpoints).
PREVIEW_RX = {  # (move, phase) -> (raw, page)
    **{("Front plank", p): (r, 10) for p, r in zip((1, 2, 3, 4), ("20-30 s", "30-40 s", "40-50 s", "45-60 s"))},
    ("Reverse crunch", 1): ("8-10", 18), ("Reverse crunch", 4): ("15 slow", 18),
    ("Flat-back bug", 1): ("6 each side", 18), ("Flat-back bug", 4): ("12 each side", 18),
    ("Side plank", 1): ("15-20 s each side", 18), ("Side plank", 4): ("35-45 s each side", 18),
    ("Squeeze crunch", 1): ("10-12", 18), ("Squeeze crunch", 4): ("15 + jug", 18),
    ("Hollow hold", 1): ("15-20 s tuck", 18), ("Hollow hold", 4): ("30-40 s full", 18),
    ("Lying leg raise", 1): ("6-8 knees bent", 18), ("Lying leg raise", 4): ("12 legs straight", 18),
}
# Week card (page 18): exercise order inside each ab session.
PREVIEW_ORDER = {"A": ["Front plank", "Reverse crunch", "Flat-back bug"],
                 "B": ["Side plank", "Squeeze crunch", "Hollow hold"],
                 "C": ["Lying leg raise", "Squeeze crunch", "Front plank"]}
# Calendar letters read by eye from page 19 grid and page 22 tracker (both identical).
# Transcribed by eye from the page-19 calendar grid (every cell read individually).
IMG19 = {1:"A",2:"F",3:"B",4:"W",5:"C",6:"F",7:"R",8:"A",9:"F",10:"B",11:"W",12:"C",13:"F",14:"R",15:"A",16:"F",17:"B",18:"W",19:"C",20:"F",
         21:"R",22:"A",23:"F",24:"B",25:"W",26:"C",27:"F",28:"R",29:"A",30:"F",31:"B",32:"W",33:"C",34:"F",35:"R",36:"A",37:"F",38:"B",39:"W",40:"C",
         41:"F",42:"R",43:"A",44:"F",45:"B",46:"W",47:"C",48:"F",49:"R",50:"A",51:"F",52:"B",53:"W",54:"C",55:"F",56:"R",57:"A",58:"F",59:"B",60:"T"}
# Page 22 tracker was read by eye separately and showed the same letter in every cell as page 19.
IMG22 = dict(IMG19)
GOLD = {1, 15, 29, 43, 60}

LABEL = {"A": "ABS A", "B": "ABS B", "C": "ABS C", "F": "FULL BODY", "W": "WALK", "R": "REST + WAIST CHECK", "T": "FINAL TEST"}
PHASE_STEPS = {1: 7000, 2: 8000, 3: 9000, 4: 10000}  # page 19 table
PHASE_NAME = {1: "Foundation", 2: "Build", 3: "Carve", 4: "Reveal"}
FIST_CARB = "One fist of carbs per meal, not a mountain."
WEEKLY_CHECK = DAYS[6]["f"]

# ---------------------------------------------------------------- DOM vs script cross-check
def expected_dom(d):
    title = d["t"] + (f" · {d['r']} round{'s' if d['r'] > 1 else ''}, about {d['m']} min" if d["r"] else "")
    items = []
    if d["x"]: items.append("Test first: waist, string test, max plank, photo")
    items += [f"{n} · {r}" for n, r in d["b"]]
    if d["r"]: items.append(f"Rest {d['rest']} s between rounds")
    if d["wc"]: items.append("Waist check today")
    items.append("Steps: " + f"{d['s']:,}")
    items.append(d["f"])
    return title.upper(), items
dom_mismatch = []
for d in DAYS:
    got = cap["doors"][str(d["d"])]
    t, items = expected_dom(d)
    if got["title"].upper() != t or [i["text"] for i in got["items"]] != items or (d["pl"] and got["plank_note"] != "Plank: " + d["pl"]):
        dom_mismatch.append(d["d"])

# ---------------------------------------------------------------- build schedule
move_dose = {m["n"]: {i + 1: p[1] for i, p in enumerate(m["dose"])} for m in MOVES}
conflicts_log = []
schedule = []
for d in DAYS:
    n, L, ph = d["d"], d["l"], d["p"]
    cal_ok = IMG19[n] == L and IMG22[n] == L
    fb_long = L == "F" and "long walk" in d["t"].lower()
    is_ab = L in "ABC"
    fields = {}

    fields["category"] = rec("category", LABEL[L] + (" + LONG WALK" if fb_long else ""),
        "VERIFIED" if cal_ok else "CONFLICTING", ["IMG_19", "IMG_22", "IMG_18", "JS_DAYS", "DOM_DOORS"],
        loc=f"page-19 calendar grid cell {n}; page-22 tracker cell {n}; page-18 week card; DAYS[{n-1}].l='{L}'",
        note="Day 60 replaces the weekly pattern's day-4 WALK with the final test." if n == 60 else None)
    fields["title"] = rec("title", d["t"], "VERIFIED" if is_ab else "PARTIALLY_VERIFIED",
        ["IMG_18", "JS_DAYS"] if is_ab else ["JS_DAYS", "DOM_DOORS"], loc=f"DAYS[{n-1}].t" + ("; page-18 session heading" if is_ab else ""))
    fields["phase"] = rec("phase", {"number": ph, "name": d["pn"]}, "VERIFIED" if PHASE_NAME[ph] == d["pn"] else "CONFLICTING",
        ["IMG_19", "PROSE_PHASES", "JS_DAYS"], loc=f"page-19 phase colours + table; DAYS[{n-1}].p/pn")
    fields["steps_target"] = (rec("steps_target", d["s"], "PARTIALLY_VERIFIED", ["JS_DAYS", "IMG_18"],
        loc=f"DAYS[{n-1}].s; page-18 names the long walk but gives no number",
        note=f"Phase daily target is {PHASE_STEPS[ph]} (page 19). The long-walk day is +2000 in the page data only.")
        if fb_long else rec("steps_target", d["s"], "VERIFIED" if d["s"] == PHASE_STEPS[ph] else "CONFLICTING",
        ["IMG_19", "JS_DAYS"], loc=f"page-19 'STEPS A DAY' {PHASE_NAME[ph]} row; DAYS[{n-1}].s"))
    # food tip
    f = d["f"]
    if f == FIST_CARB or f == WEEKLY_CHECK:
        page7 = ("Carbs are '1 CUPPED HAND' and a fist is vegetables; the weekly check says 'one cupped hand of carbs or one thumb of fat a day'.")
        fields["food_tip"] = rec("food_tip", f, "CONFLICTING", ["JS_DAYS", "IMG_07"], loc=f"DAYS[{n-1}].f vs page-07 portion cards + weekly check",
            note="Page data says 'fist' of carbs. " + page7,
            alt=[{"value": f, "source": "landing page data (DAYS[].f)"},
                 {"value": "carbs = 1 cupped hand; weekly check = remove one cupped hand of carbs or one thumb of fat a day", "source": "PDF page 7 preview image"}])
        conflicts_log.append({"day": n, "field": "food_tip", "issue": "fist vs cupped hand for carbs"})
    elif f.startswith("Drink water, not calories") or f.startswith("Plan your treat"):
        fields["food_tip"] = rec("food_tip", f, "VERIFIED", ["JS_DAYS", "IMG_07"], loc=f"DAYS[{n-1}].f; same rule printed on page 7",
            note="Rule is printed on page 7; the exact day sentence comes from the page data.")
    else:
        fields["food_tip"] = rec("food_tip", f, "PARTIALLY_VERIFIED", ["JS_DAYS", "DOM_DOORS"], loc=f"DAYS[{n-1}].f",
            note=("Page 7 says 1-2 palms of protein per meal; this tip says 'a palm'." if f.startswith("A palm") else None))
    fields["test_day"] = rec("test_day", bool(d["x"]), "VERIFIED" if bool(d["x"]) == (n in GOLD) else "CONFLICTING",
        ["IMG_19", "IMG_22", "JS_DAYS"], loc=f"gold cells on pages 19/22; DAYS[{n-1}].x")
    fields["waist_check"] = rec("waist_check", bool(d["wc"]), "VERIFIED" if bool(d["wc"]) == (L == "R") else "CONFLICTING",
        ["IMG_18", "PROSE_WEEK", "JS_DAYS"], loc="page-18 'REST + WAIST CHECK'; week block; DAYS[].wc")
    if d["pl"]:
        fields["day_note"] = rec("day_note", d["pl"], "PARTIALLY_VERIFIED", ["JS_DAYS"], loc=f"DAYS[{n-1}].pl",
            note="Written in the voice of the Telegram reminder bot. Text kept verbatim; Telegram is not implemented.")

    exercises = []
    if d["r"]:  # training day
        # rounds
        if is_ab:
            exp = 2 if n <= 7 else (4 if ph == 4 else 3)
            st = "VERIFIED" if d["r"] == exp else "CONFLICTING"
            fields["rounds"] = rec("rounds", d["r"], st, ["IMG_18", "IMG_19", "JS_DAYS"],
                loc="page-18 'ROUNDS' card + page-19 phase table; DAYS[].r")
            if st == "CONFLICTING": conflicts_log.append({"day": n, "field": "rounds"})
            if d["rest"] == 45:
                fields["rest_seconds"] = rec("rest_seconds", 45, "VERIFIED", ["IMG_18", "JS_DAYS"], loc="page-18 'ROUNDS': rest 45 seconds")
            else:
                fields["rest_seconds"] = rec("rest_seconds", d["rest"], "CONFLICTING", ["IMG_18", "JS_DAYS"],
                    loc=f"DAYS[{n-1}].rest vs page-18 'ROUNDS' card",
                    note="Page 18 says 'rest 45 seconds' with no phase qualifier. Page data says 40 s from day 29 (Carve, Reveal). Not resolvable without the full PDF.",
                    alt=[{"value": d["rest"], "source": "landing page data DAYS[].rest"}, {"value": 45, "source": "PDF page 18 preview image"}])
                conflicts_log.append({"day": n, "field": "rest_seconds", "issue": "40 s (page data) vs 45 s (page 18)"})
        else:
            fields["rounds"] = rec("rounds", d["r"], "PARTIALLY_VERIFIED", ["JS_DAYS"], loc=f"DAYS[{n-1}].r",
                note="No public preview page states full-body rounds.")
            fields["rest_seconds"] = rec("rest_seconds", d["rest"], "PARTIALLY_VERIFIED", ["JS_DAYS"], loc=f"DAYS[{n-1}].rest",
                note="Page 18's 45 s statement is about the ab days only.")
        mins_prose = {"A": 12, "B": 14, "C": 12, "F": 20}[L]
        fields["duration_minutes"] = rec("duration_minutes", d["m"], "VERIFIED" if d["m"] == mins_prose else "PARTIALLY_VERIFIED",
            ["PROSE_WEEK", "JS_DAYS"] if d["m"] == mins_prose else ["JS_DAYS"], loc=f"week block 'about {mins_prose} min'; DAYS[{n-1}].m",
            note=None if d["m"] == mins_prose else f"Week block shows {mins_prose} min for the 2-3 round version; {d['m']} min is the 4-round value in the page data only.")
        fields["rest_between_exercises"] = (rec("rest_between_exercises", "none (moves back to back; rest after each round)", "VERIFIED", ["IMG_18"],
            loc="page-18 'ROUNDS': 'Do the 3 moves back to back, rest 45 seconds, repeat'") if is_ab else
            unavailable("rest_between_exercises", "Full-body pacing between moves is not stated in any public preview."))
        fields["sets"] = unavailable("sets", "The source specifies 'rounds' of the move list; no separate set count is published. Use 'rounds'.")
        # exercises
        for i, (name, rx) in enumerate(d["b"], 1):
            if is_ab:
                order_ok = PREVIEW_ORDER[L][i - 1] == name
                pv = PREVIEW_RX.get((name, ph))
                dose = move_dose[name][ph]
                if dose != rx:
                    st, evs = "CONFLICTING", ["JS_DAYS", "JS_MOVES"]
                    conflicts_log.append({"day": n, "field": f"exercise {name}", "issue": f"{rx!r} vs move card {dose!r}"})
                elif pv and pv[0] == rx:
                    st, evs = "VERIFIED", [f"IMG_{pv[1]:02d}", "JS_DAYS", "JS_MOVES"]
                else:
                    st, evs = "PARTIALLY_VERIFIED", ["JS_DAYS", "JS_MOVES"]
                note = None
                if st == "PARTIALLY_VERIFIED":
                    note = "Matches the move card's dose for this phase, but no public preview page shows this phase value."
                rx_rec = rec("prescription", {"raw": rx, "parsed": parse_rx(rx)}, st, evs, loc=f"DAYS[{n-1}].b[{i-1}]; MOVES '{name}' dose {PHASE_NAME[ph]}", note=note)
                ord_rec = rec("order", i, "VERIFIED" if order_ok else "CONFLICTING", ["IMG_18", "JS_DAYS"], loc=f"page-18 {LABEL[L]} card, position {i}")
            else:
                rx_rec = rec("prescription", {"raw": rx, "parsed": parse_rx(rx)}, "PARTIALLY_VERIFIED", ["JS_DAYS", "DOM_DOORS"], loc=f"DAYS[{n-1}].b[{i-1}]",
                    note="Full-body doses are not shown on any public preview page.")
                ord_rec = rec("order", i, "PARTIALLY_VERIFIED", ["JS_DAYS", "PROSE_SEO"], loc=f"DAYS[{n-1}].b[{i-1}]; landing text lists the four moves in the same order")
            exercises.append({"order": ord_rec, "name": rec("name", name, "VERIFIED", ["PROSE_SEO", "PROSE_FAQ", "JS_DAYS"], loc="landing summary names the 7 ab + 4 full-body moves; DAYS[].b"),
                              "prescription": rx_rec})
    schedule.append({"day": n, "week": (n - 1) // 7 + 1, "day_of_week_cycle": (n - 1) % 7 + 1, "fields": fields, "exercises": exercises})

# calendar cross-check summary
cal_diff = [n for n in range(1, 61) if IMG19[n] != DAYS[n - 1]["l"] or IMG22[n] != DAYS[n - 1]["l"]]

def meta(extra=None):
    m = {"programme": "AB THEORY 60 (Rep Theory)", "generated_at": now, "extracted_at": EXTRACTED_AT,
         "landing_url": LANDING, "embed_url": EMBED,
         "status_definitions": {
             "VERIFIED": "Shown in a public PDF preview page image, or confirmed by 2+ separately authored public landing sections.",
             "PARTIALLY_VERIFIED": "Found in only one public place (the landing page's data), no preview page shows it.",
             "CONFLICTING": "Two public places disagree. Both values are kept in conflicting_values/note.",
             "UNAVAILABLE": "Not publicly exposed. value is null and unavailable_reason says why."},
         "record_fields": ["field", "value", "source_url", "source_type", "evidence_location", "confidence", "verification_status", "extracted_at"]}
    if extra: m.update(extra)
    return m
def write(name, obj):
    (OUT / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")

# ---------------------------------------------------------------- workout_schedule.json
weekly = [{"day_in_week": i + 1, **rec("label", lbl, "VERIFIED", ["IMG_18", "PROSE_WEEK"], loc=f"page-18 week strip 'DAY {i+1}'; landing .week block")} for i, lbl in
          enumerate(["ABS A", "FULL BODY", "ABS B", "WALK", "ABS C", "FULL BODY + LONG WALK", "REST + WAIST CHECK"])]
write("workout_schedule.json", {"_meta": meta({
    "day_numbers": "Original day numbers 1-60 kept. Day 1 is the user's start day; the page says days count from the start, not the calendar.",
    "not_applicable_rules": "rounds/rest/duration/exercises are omitted on walk, rest and final-test days.",
    "pdf_supplied": False,
    "crosschecks": {"calendar_letters_vs_page19_page22_images": {"days_checked": 60, "mismatches": cal_diff},
                    "rendered_dom_vs_script_data": {"days_checked": 60, "mismatches": dom_mismatch}}}),
    "weekly_pattern": weekly, "days": schedule})

# ---------------------------------------------------------------- programme_phases.json
phase_rows = [
    (1, "Foundation", 1, 14, "2 in week 1, then 3", 7000, "Learn the 7 moves with clean form and build the step habit. 2 rounds in week 1, then 3.", "Learn the 7 moves, build the habit."),
    (2, "Build", 15, 28, "3", 8000, "Longer holds and more reps. First retest on day 15: your waist should be moving.", "Longer holds, more reps."),
    (3, "Carve", 29, 42, "3", 9000, "The harder versions: the full hollow, straight-leg raises and a water jug on the crunch.", "Harder versions, a water jug on the crunch."),
    (4, "Reveal", 43, 60, "4", 10000, "4 rounds of abs and 10,000 steps. Final test on day 60.", "Four rounds and the final test on day 60."),
]
phases = []
for num, nm, a, b, rounds, steps, what, short in phase_rows:
    for k in (nm,):
        pass
    for kk, w in [("what_changes", what)]:
        assert check_ocr(19, w), (nm, w)
    phases.append({"number": num, "name": nm,
        "day_range": rec("day_range", {"first": a, "last": b}, "VERIFIED", ["IMG_19", "PROSE_PHASES", "JS_DAYS"], loc="page-19 table 'DAYS a-b'; landing .phases; DAYS[].p"),
        "ab_rounds": rec("ab_rounds", rounds, "VERIFIED", ["IMG_19", "IMG_18"], loc="page-19 'ROUNDS' column; page-18 'ROUNDS' card"),
        "daily_steps": rec("daily_steps", steps, "VERIFIED", ["IMG_19"], loc="page-19 'STEPS A DAY' column"),
        "what_changes": rec("what_changes", what, "VERIFIED", ["IMG_19"], loc="page-19 'WHAT CHANGES' column"),
        "landing_summary": rec("landing_summary", short, "VERIFIED", ["PROSE_PHASES"], loc="landing .phases list"),
        "long_walk_steps": rec("long_walk_steps", steps + 2000, "PARTIALLY_VERIFIED", ["JS_DAYS"], loc="DAYS[].s on the second full-body day of each week",
            note="Only in the landing page data. No preview page gives a long-walk number.")})
write("programme_phases.json", {"_meta": meta(), "phases": phases,
    "programme_facts": [
        rec("total_days", 60, "VERIFIED", ["IMG_02", "IMG_19"], loc="page-02 stats; page-19 title"),
        rec("test_days", [1, 15, 29, 43, 60], "VERIFIED", ["IMG_05", "IMG_19", "IMG_22"], loc="page-05 header; gold cells on pages 19/22"),
        rec("weekly_repeat", "Same week repeats eight and a half times", "VERIFIED", ["IMG_18"], loc="page-18 intro"),
        rec("session_length", "12 to 20 minutes, plus walking; day 7 of every week is rest", "VERIFIED", ["PROSE_FAQ"], loc="landing FAQ 'How long is each session?'"),
        rec("equipment", ["a floor or a mat", "a sturdy table (for rows)", "a couch or a strong chair", "a 2 to 4 litre water jug, or a backpack with books", "a soft tape measure, or a piece of string", "pull-up bar optional"], "VERIFIED", ["IMG_02", "PROSE_FAQ"], loc="page-02 'WHAT YOU NEED'; landing FAQ"),
        rec("after_day_60", "Still losing? Keep REVEAL going. Happy? Keep 3 ab days a week plus the food rules, and you keep the result.", "VERIFIED", ["IMG_19"], loc="page-19 'AFTER DAY 60' box"),
        rec("warm_up", "2 minutes: march on the spot, 10 slow cat-cows, 5 slow reverse crunches.", "VERIFIED", ["IMG_18"], loc="page-18 'WARM-UP' card"),
    ]})

# ---------------------------------------------------------------- exercises.json / full_body_exercises.json
front_plank_fields = {}
fp = MOVES[0]
for key, text in [("works", fp["works"]), ("avoid", fp["avoid"]), ("easy", fp["easy"]), ("hard", fp["hard"]), ("safe", fp["safe"])] + [("how", h) for h in fp["how"]]:
    ok = check_ocr(10, text); front_plank_fields[key + text[:12]] = ok
ex_out = []
for idx, m in enumerate(MOVES, 1):
    is_fp = idx == 1
    base = ["IMG_10", "JS_MOVES"] if is_fp else ["JS_MOVES", "DOM_MOVES"]
    st = "VERIFIED" if is_fp else "PARTIALLY_VERIFIED"
    nt = None if is_fp else "Only the front plank card is shown in a public preview page (page 10). This card comes from the landing page data."
    doses = {}
    for p in (1, 2, 3, 4):
        raw = m["dose"][p - 1][1]
        pv = PREVIEW_RX.get((m["n"], p))
        s2 = "VERIFIED" if pv and pv[0] == raw else "PARTIALLY_VERIFIED"
        doses[PHASE_NAME[p]] = rec("dose", {"raw": raw, "parsed": parse_rx(raw)}, s2, [f"IMG_{pv[1]:02d}", "JS_MOVES"] if s2 == "VERIFIED" else ["JS_MOVES"],
                                   loc=f"MOVES[{idx-1}].dose[{p-1}]" + (f"; page-{pv[1]}" if pv else ""))
    ex_out.append({"id": m["n"].lower().replace(" ", "-"), "number": idx, "group": "abs", "name": rec("name", m["n"], "VERIFIED", ["PROSE_SEO", "JS_MOVES"], loc="landing summary: '7 ab moves: ...'"),
        "tag": rec("tag", m["tag"], st, base, loc=f"MOVES[{idx-1}].tag", note=nt),
        "sessions": rec("sessions", m["sess"], "VERIFIED", ["IMG_18", "JS_MOVES"], loc="page-18 session cards; MOVES[].sess"),
        "how_to": rec("how_to", m["how"], st, base, loc=f"MOVES[{idx-1}].how", note=nt),
        "works": rec("works", m["works"], st, base, loc=f"MOVES[{idx-1}].works", note=nt),
        "mistakes_to_avoid": rec("mistakes_to_avoid", m["avoid"], st, base, loc=f"MOVES[{idx-1}].avoid", note=nt),
        "easier": rec("easier", m["easy"], st, base, loc=f"MOVES[{idx-1}].easy", note=nt),
        "harder": rec("harder", m["hard"], st, base, loc=f"MOVES[{idx-1}].hard", note=nt),
        "be_safe": (rec("be_safe", m["safe"], st, base, loc=f"MOVES[{idx-1}].safe", note=nt) if m["safe"] else
                    rec("be_safe", None, "UNAVAILABLE", ["JS_MOVES"], loc=f"MOVES[{idx-1}].safe",
                        why_null="The landing page data has an empty 'be safe' field for this move. The PDF page for this move is not public, so a note there cannot be ruled out.")),
        "dose_by_phase": doses})
write("exercises.json", {"_meta": meta({"safety_notes": [
    rec("lower_back", "Bend your knees on leg raises, keep reverse crunches small, and press your back down on the hollow hold and the bug. Still hurts? Skip the move and see a doctor or physio.", "VERIFIED", ["PROSE_FAQ"], loc="landing FAQ 'My lower back hurts on some moves.'"),
    rec("medical", "Not medical advice. If you have back pain or a health condition, or you're pregnant, talk to a doctor first. Under 18: only with an adult supervising; skip the diet part.", "VERIFIED", ["IMG_02", "PROSE_FAQ"], loc="page-02 'Safety'; landing FAQ")]}),
    "exercises": ex_out})

fb_names = ["Push-ups", "Split squats", "Table rows", "Couch hip thrust"]
fb_out = []
for nm in fb_names:
    per = {}
    for p in (1, 2, 3, 4):
        vals = sorted({rx for d in DAYS if d["p"] == p and d["l"] == "F" for n2, rx in d["b"] if n2 == nm})
        assert len(vals) == 1, (nm, p, vals)
        days_used = [d["d"] for d in DAYS if d["p"] == p and d["l"] == "F"]
        per[PHASE_NAME[p]] = rec("dose", {"raw": vals[0], "parsed": parse_rx(vals[0])}, "PARTIALLY_VERIFIED", ["JS_DAYS", "DOM_DOORS"],
            loc=f"DAYS[].b on days {days_used}", note="Identical on every full-body day of the phase. Not shown on any public preview page.")
    fb_out.append({"id": nm.lower().replace(" ", "-"), "order_in_session": fb_names.index(nm) + 1,
        "name": rec("name", nm, "VERIFIED", ["PROSE_SEO", "PROSE_FAQ", "JS_DAYS"], loc="landing: 'Push-ups, split squats, table rows and couch hip thrusts'",
                    note="Landing text says 'couch hip thrusts'; the day data says 'Couch hip thrust'." if nm.startswith("Couch") else None),
        "dose_by_phase": per,
        "how_to": unavailable("how_to", "Full-body move instructions are not exposed on the landing page or in the 10 public preview pages."),
        "easier_harder": unavailable("easier_harder", "Not exposed publicly. Only the qualifiers inside the day doses (e.g. 'knees or hands up', 'feet up if easy') are known."),
        "mistakes_to_avoid": unavailable("mistakes_to_avoid", "Not exposed publicly.")})
write("full_body_exercises.json", {"_meta": meta({"sessions": "Full body 1 and Full body 2 use identical lists in every phase (day data). Day 6 type adds a long walk.",
                                                  "required_equipment": "sturdy table (rows), couch/chair (hip thrust), backpack/water jug ('+ bag' in Carve/Reveal split squats)"}),
                                   "exercises": fb_out})

# ---------------------------------------------------------------- progression_rules.json
prog = [
    rec("rounds_by_phase", {"Foundation": "2 in week 1 (days 1-7), then 3", "Build": 3, "Carve": 3, "Reveal": "4 on ab days (full-body days stay at 3 in the page data)"},
        "VERIFIED", ["IMG_18", "IMG_19", "JS_DAYS"], loc="page-18 'ROUNDS'; page-19 table; DAYS[].r",
        note="Full-body Reveal rounds (3) come from the page data only."),
    rec("round_structure", "Do the 3 moves back to back, rest 45 seconds, repeat.", "VERIFIED", ["IMG_18"], loc="page-18 'ROUNDS' card"),
    rec("effort", "Finish each set with 1 or 2 good reps left. Shaky is fine. Sloppy is not.", "VERIFIED", ["IMG_18"], loc="page-18 'EFFORT' card"),
    rec("rest_between_rounds_seconds", {"days_1_28": 45, "days_29_60": 40}, "CONFLICTING", ["IMG_18", "JS_DAYS"],
        loc="page-18 'ROUNDS' vs DAYS[].rest", note="Page 18: 45 s, no phase qualifier. Page data: 40 s from day 29.",
        alt=[{"value": 45, "source": "PDF page 18 preview image"}, {"value": 40, "source": "landing page data, days 29-60"}]),
    rec("dose_progression", "The moves stay the same and the doses grow each phase (see exercises.json dose_by_phase).", "VERIFIED", ["IMG_19"], loc="page-19 intro"),
    rec("hollow_hold_progression", "Tuck (Foundation) -> half (Build) -> full (Carve, Reveal)", "PARTIALLY_VERIFIED", ["JS_MOVES", "IMG_19"],
        loc="MOVES[5].dose; page-19 Carve text 'the full hollow'", note="Page 19 confirms the full hollow arrives in Carve; the Build 'half' is in the page data only."),
    rec("squeeze_crunch_load", "Water jug from Carve; heavier jug or backpack with books is the harder version.", "VERIFIED", ["IMG_19", "IMG_18", "JS_MOVES"], loc="page-19 Carve text; page-18 '15 + jug'; MOVES[4]"),
    rec("leg_raise_progression", "Knees bent (Foundation) -> straight legs from Carve; hanging knee raises 8-12 optional with a pull-up bar in Carve and Reveal.", "PARTIALLY_VERIFIED", ["JS_MOVES", "IMG_19", "IMG_18"],
        loc="MOVES[6]; page-19 'straight-leg raises'; page-18 '12 legs straight'"),
    rec("full_body_progression", {p: fb_out[0]["dose_by_phase"][p]["value"]["raw"] for p in PHASE_NAME.values()}, "PARTIALLY_VERIFIED", ["JS_DAYS"],
        loc="DAYS[].b full-body days", note="Push-ups doses by phase shown as a sample; see full_body_exercises.json for all four moves."),
    rec("steps_progression", {"Foundation": 7000, "Build": 8000, "Carve": 9000, "Reveal": 10000}, "VERIFIED", ["IMG_19"], loc="page-19 'STEPS A DAY'"),
    rec("long_walk_day_steps", {"Foundation": 9000, "Build": 10000, "Carve": 11000, "Reveal": 12000}, "PARTIALLY_VERIFIED", ["JS_DAYS"], loc="DAYS[].s on 'Full body 2 + long walk' days"),
    rec("weekly_adjustment", "Nothing moved for 2 weeks in a row? Take away one cupped hand of carbs or one thumb of fat a day, and keep everything else the same. Feeling weak, dizzy or hungry all the time? Add one back.", "VERIFIED", ["IMG_07"], loc="page-07 'EVERY 7 DAYS: THE WEEKLY CHECK'"),
    unavailable("load_progression_numbers", "No publicly exposed rule gives weights/jug size; only 'jug' and 'bag' qualifiers."),
]
write("progression_rules.json", {"_meta": meta(), "rules": prog})

# ---------------------------------------------------------------- assessment_rules.json
for ph in ["Do this on day 1 before your first session", "Same time of day and before you eat", "Hold a front plank as long as you can with good form",
           "Cut a piece of string as long as you are tall and fold it in half", "Weigh yourself every morning for a week and use the average"]:
    check_ocr(5, ph)
assess = [
    rec("test_days", [1, 15, 29, 43, 60], "VERIFIED", ["IMG_05", "IMG_22", "PROSE_FAQ"], loc="page-05 header; page-22 test-day log rows"),
    rec("day_60", "Final test day: no workout; steps 10,000.", "VERIFIED", ["IMG_19", "IMG_22", "JS_DAYS"], loc="'T = final test' legend; DAYS[59]"),
    rec("conditions", "Do it on day 1 before your first session. Same time of day and before you eat, so the numbers mean something.", "VERIFIED", ["IMG_05"], loc="page-05 intro"),
    rec("measure_waist", "Wrap the tape around your waist at belly-button height. Breathe out normally, don't suck in, and write down the number. Same spot every time.", "VERIFIED", ["IMG_05"], loc="page-05 step 1"),
    rec("max_plank", "Hold a front plank as long as you can with good form. Stop the clock when your hips sag or lift.", "VERIFIED", ["IMG_05"], loc="page-05 step 2"),
    rec("string_test", "Cut a piece of string as long as you are tall and fold it in half. If it fits around your waist, your waist is under half your height.", "VERIFIED", ["IMG_05"], loc="page-05 step 3"),
    rec("photo", "Front and side, same spot, same light, same time of day, relaxed. Keep them on your phone.", "VERIFIED", ["IMG_05"], loc="page-05 step 4"),
    rec("weight_optional", "Weigh yourself every morning for a week and use the average.", "VERIFIED", ["IMG_05"], loc="page-05 step 5"),
    rec("log_columns", ["DAY", "WAIST", "STRING TEST", "MAX PLANK", "WEIGHT AVG", "HOW I FEEL"], "VERIFIED", ["IMG_22"], loc="page-22 'TEST-DAY LOG' table"),
    rec("string_test_bands", {"yes": "waist under 48% of height", "just": "48-50%", "no": "over half (>50%)"}, "PARTIALLY_VERIFIED", ["JS_STRING", "PROSE_FAQ"],
        loc="landing interactive: r<.48 Y, r<=.5 J, else N", note="The landing page says the 'just' band is 'our own simple scale'; the PDF only says under half your height."),
    rec("waist_to_height_target", "Keep your waist under half your height.", "VERIFIED", ["IMG_04", "IMG_05"], loc="page-04 '0.5 A TARGET YOU CAN CHECK'; page-05"),
    rec("weekly_waist_check", {"days": [7, 14, 21, 28, 35, 42, 49, 56]}, "VERIFIED", ["IMG_18", "IMG_22", "JS_DAYS"], loc="'R' cells; DAYS[].wc"),
]
write("assessment_rules.json", {"_meta": meta(), "rules": assess})

# ---------------------------------------------------------------- nutrition_rules.json
for pg, ph in [(7, "protein: meat, fish, eggs, tofu, Greek yoghurt"), (7, "vegetables: any kind, the more the better"), (7, "carbs: rice, potatoes, oats, bread, fruit"),
               (7, "fats: oil, butter, nuts, cheese"), (7, "Aim for about 1.6 g per kg of body weight a day"), (7, "Aim for about 0.5 to 1% of your body weight a week"),
               (7, "Eat slowly and stop at 80% full"), (8, "Have a glass of water between alcoholic drinks")]:
    check_ocr(pg, ph)
nut = [
    rec("approach", "No calorie counting and no banned foods. Your hand is your measuring cup.", "VERIFIED", ["IMG_07"], loc="page-07 intro"),
    rec("meals_per_day", "3 or 4", "VERIFIED", ["IMG_07"], loc="page-07 'EACH MEAL, 3 OR 4 MEALS A DAY'"),
    rec("portion_protein", {"amount": "1-2 palms", "examples": "meat, fish, eggs, tofu, Greek yoghurt"}, "VERIFIED", ["IMG_07"], loc="page-07 card 1"),
    rec("portion_vegetables", {"amount": "1-2 fists", "examples": "any kind, the more the better"}, "VERIFIED", ["IMG_07"], loc="page-07 card 2"),
    rec("portion_carbs", {"amount": "1 cupped hand", "examples": "rice, potatoes, oats, bread, fruit"}, "VERIFIED", ["IMG_07"], loc="page-07 card 3"),
    rec("portion_fats", {"amount": "1 thumb", "examples": "oil, butter, nuts, cheese"}, "VERIFIED", ["IMG_07"], loc="page-07 card 4"),
    rec("smaller_people", "If you're smaller, use 1 palm of protein per meal instead of 2, and use the same weekly check.", "VERIFIED", ["PROSE_FAQ"], loc="landing FAQ 'Is it for women too?'"),
    rec("protein_target", "About 1.6 g per kg of body weight a day (0.7 g per lb).", "VERIFIED", ["IMG_07", "IMG_04"], loc="page-07 rule 1; page-04"),
    rec("rate_of_loss", "About 0.5 to 1% of your body weight a week.", "VERIFIED", ["IMG_07"], loc="page-07 rule 2"),
    rec("drink", "Drink water, not calories. Soda, juice and sweet coffees add up fast.", "VERIFIED", ["IMG_07"], loc="page-07 rule 3"),
    rec("eating_pace", "Eat slowly and stop at 80% full.", "VERIFIED", ["IMG_07"], loc="page-07 rule 4"),
    rec("treats", "Plan your treats. One you really want beats five you didn't.", "VERIFIED", ["IMG_07"], loc="page-07 rule 5"),
    rec("you_dont_need", ["Fat-burner pills or detox teas", "To cut out whole food groups", "Fasting days or juice cleanses", "To eat \"clean\" 100% of the time"], "VERIFIED", ["IMG_07"], loc="page-07 'YOU DON'T NEED'"),
    rec("weekly_check", "Waist down, or weight average down? Change nothing. Nothing moved for 2 weeks in a row? Take away one cupped hand of carbs or one thumb of fat a day, and keep everything else the same. Feeling weak, dizzy or hungry all the time? Add one back.", "VERIFIED", ["IMG_07"], loc="page-07 weekly check box"),
    rec("weekly_check_day_tip", WEEKLY_CHECK, "CONFLICTING", ["JS_DAYS", "IMG_07"], loc="DAYS[6].f (also days 14,21,28,35,42,49,56) vs page-07",
        note="Page data says remove 'one fist of carbs a day'. Page 7 says 'one cupped hand of carbs or one thumb of fat'. Both kept.",
        alt=[{"value": WEEKLY_CHECK, "source": "landing page data"}, {"value": "one cupped hand of carbs or one thumb of fat a day", "source": "PDF page 7 preview image"}]),
    rec("carb_portion_in_day_tip", FIST_CARB, "CONFLICTING", ["JS_DAYS", "IMG_07"], loc="DAYS[].f on walk days (4, 11, 18, ... 60)",
        note="Day tips say 'a fist of carbs'; page 7 defines a fist as vegetables and carbs as a cupped hand.",
        alt=[{"value": FIST_CARB, "source": "landing page data"}, {"value": "1 cupped hand of carbs per meal; 1-2 fists is vegetables", "source": "PDF page 7 preview image"}]),
    rec("daily_tip_cycle", {d["d"]: d["f"] for d in DAYS[:7]}, "PARTIALLY_VERIFIED", ["JS_DAYS"], loc="DAYS[0..6].f (repeats weekly)",
        note="The same 7 tips repeat every week; per-day tips are in workout_schedule.json."),
    rec("holiday_rules", ["Protein first: a protein-heavy snack before you go, start your plate with the meat or fish.", "One plate, sitting down: fill one plate, sit, eat slowly.",
        "Pick your favourites: have the dessert you actually love.", "One drink, one water: a glass of water between alcoholic drinks.",
        "Walk after the big meal: 10 to 20 minutes.", "No \"start on Monday\": the next meal is a normal meal, the next day a normal plan day."], "VERIFIED", ["IMG_08", "PROSE_FAQ"], loc="page-08 six cards; landing 'One meal. Not one month.'"),
    unavailable("calories_or_macro_numbers_beyond_hand_rules", "The programme says no calorie counting; no calorie or gram targets are published except protein 1.6 g/kg."),
    unavailable("food_lists_or_recipes", "PDF pages beyond the 10 previews are not public."),
]
write("nutrition_rules.json", {"_meta": meta(), "rules": nut})

# ---------------------------------------------------------------- missed_day_rules.json
write("missed_day_rules.json", {"_meta": meta({"excluded": "A Telegram bot demo message about missed days exists in the landing page script. It describes the bot, not the PDF, and Telegram is out of scope, so it is not used."}),
    "rules": [
        rec("count_from_start", "Days count from your start, not from the calendar. Missed days push the plan back; they don't break it (page 20).", "VERIFIED", ["IMG_19"], loc="page-19 'BEHIND? NO PROBLEM' box"),
        rec("start_any_day", "Day 1 is whatever day you start. The plan works any time of year.", "VERIFIED", ["PROSE_FAQ", "IMG_18"], loc="landing FAQ; page-18 intro"),
        rec("party_rule", "The next meal is a normal meal, and the next day is a normal plan day. One big meal changes almost nothing. A lost week does.", "VERIFIED", ["IMG_08"], loc="page-08 'NO START ON MONDAY'"),
        unavailable("missed_day_plan_detail", "Page 20 ('Missed days') is referenced by page 19 but is not a public preview page. How many days to repeat or skip is not published."),
        unavailable("three_mistakes_and_questions", "PDF pages with '3 mistakes' and 'questions' are not public."),
    ]})

# ---------------------------------------------------------------- source_inventory.json + source_evidence.json
domains = {}
for r in cap["network"]:
    h = re.match(r"https?://([^/]+)", r["url"]).group(1); domains[h] = domains.get(h, 0) + 1
write("source_inventory.json", {"_meta": meta(), "product": {"name": "AB THEORY 60: The 60-Day Visible Abs Plan (No Gym)", "seller": "Rep Theory", "sku": "ervvan", "price_usd": 13.32,
    "source": "schema.org JSON-LD on the landing page", "pdf_pages_advertised": 23},
    "sources": [
        {"id": "landing_shell", "url": LANDING, "type": "public_html", "retrieved_at": cap["pages"]["landing_shell"]["retrieved"], "sha256": cap["pages"]["landing_shell"]["sha256"], "notes": "Wrapper with SEO text, JSON-LD, and an iframe to the embed."},
        {"id": "landing_embed", "url": EMBED, "type": "public_html_with_inline_js", "retrieved_at": cap["pages"]["landing_embed_raw"]["retrieved"], "sha256": cap["pages"]["landing_embed_raw"]["sha256"], "notes": "Contains DAYS, MOVES, IMG data arrays and the interactive components."},
        *[{"id": f"page_{PAGE_NO[f]:02d}", "url": i["url"], "type": "public_preview_image", "pdf_page": PAGE_NO[f], "retrieved_at": i["retrieved"], "sha256": i["sha256"], "bytes": i["bytes"],
           "ocr_engine": ocr[f]["ocr_engine"], "ocr_lines": len(ocr[f]["lines"])} for f, i in cap["images"].items()]],
    "pdf_pages": {"public_previews": sorted(PAGE_NO.values()),
                  "not_public": [p for p in range(1, 24) if p not in PAGE_NO.values()],
                  "note": "Page numbers 3, 6, 9, 11-17, 20, 21, 23 are not exposed. Pages referenced by number in public pages: 3 (Plank), 5, 6 (three jobs), 10, 18, 19, 20 (missed days), 22."},
    "authorised_pdf_supplied": False,
    "network_domains_contacted": domains,
    "tools": {"browser": "Playwright Chromium (headless)", "html_parsing": "BeautifulSoup + lxml", "ocr": "macOS Vision VNRecognizeTextRequest (tesseract not installed)"},
    "not_done": ["No purchase, checkout, or licence key.", "No access to protected download URLs or authenticated pages.", "No Telegram integration or bot data used.",
                 "Incomplete previews are not treated as complete data: unavailable fields are null with a reason."],
    "crosschecks": {"dom_vs_script_mismatch_days": dom_mismatch, "calendar_image_vs_script_mismatch_days": cal_diff, "ocr_phrase_misses": OCR_FAIL,
                    "conflicts_found": conflicts_log[:0] or sorted({(c["field"], c.get("issue", "")) for c in conflicts_log})}})

write("source_evidence.json", {"_meta": meta(), "evidence": list(EV.values()),
    "conflicts": [{"field": "carb portion (fist vs cupped hand)", "page_data": FIST_CARB, "pdf_page_7": "carbs = 1 cupped hand; fist = vegetables", "affected_days": [d["d"] for d in DAYS if d["f"] in (FIST_CARB, WEEKLY_CHECK)]},
                  {"field": "rest between rounds", "page_data": "40 s on days 29-60", "pdf_page_18": "rest 45 seconds (no phase qualifier)", "affected_days": [d["d"] for d in DAYS if d["l"] in "ABC" and d["rest"] == 40]}]})

# ---------------------------------------------------------------- report
stat = {}
def walk(o):
    if isinstance(o, dict):
        if "verification_status" in o: stat[o["verification_status"]] = stat.get(o["verification_status"], 0) + 1
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
for f in OUT.glob("*.json"):
    if f.name.startswith(("workout", "programme", "exercises", "full_body", "progression", "assessment", "nutrition", "missed")): walk(json.loads(f.read_text()))
print("status counts:", stat)
print("dom mismatches:", dom_mismatch, "calendar mismatches:", cal_diff)
print("ocr misses:", OCR_FAIL)
print("conflict kinds:", sorted({(c["field"], c.get("issue", "")) for c in conflicts_log}), "count", len(conflicts_log))
