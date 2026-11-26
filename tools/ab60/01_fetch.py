"""Step 1: capture public sources with Playwright. Public URLs only; no login, no checkout, no downloads of paid files."""
import json, datetime, hashlib, pathlib, re, urllib.request
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "raw" / "ab60"
RAW.mkdir(parents=True, exist_ok=True)
LANDING = "https://thereptheory.gumroad.com/l/abs/CHRISTMAS25"
EMBED = "https://thereptheory.gumroad.com/l/ervvan/landing/embed"
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

log = {"started": now(), "network": [], "pages": {}, "doors": {}, "moves": {}}

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, user_agent="Mozilla/5.0 (personal-use data capture)")
    pg = ctx.new_page()
    pg.on("response", lambda r: log["network"].append({"url": r.url, "status": r.status, "type": r.request.resource_type, "t": now()}))

    # 1) landing shell (iframe wrapper)
    pg.goto(LANDING, wait_until="networkidle")
    shell = pg.content()
    (RAW / "landing_shell.html").write_text(shell)
    log["pages"]["landing_shell"] = {"url": LANDING, "retrieved": now(), "sha256": hashlib.sha256(shell.encode()).hexdigest()}
    pg.screenshot(path=str(RAW / "landing_shell.png"))

    # 2) embed page (the actual public landing content)
    pg.goto(EMBED, wait_until="networkidle")
    pg.wait_for_timeout(1500)
    html = pg.content()
    (RAW / "landing_embed_rendered.html").write_text(html)
    log["pages"]["landing_embed"] = {"url": EMBED, "retrieved": now(), "sha256": hashlib.sha256(html.encode()).hexdigest()}
    pg.screenshot(path=str(RAW / "landing_embed_full.png"), full_page=True)

    # 3) click every door and capture the rendered detail panel
    for d in range(1, 61):
        pg.click(f'.door[data-d="{d}"]')
        chips = pg.eval_on_selector_all("#dd-chips span", "els=>els.map(e=>e.textContent)")
        title = pg.inner_text("#dd-t")
        items = pg.eval_on_selector_all("#dd-l li", "els=>els.map(e=>({cls:e.className,text:e.textContent}))")
        plank = pg.inner_text("#dd-pl")
        log["doors"][d] = {"chips": chips, "title": title, "items": items, "plank_note": plank, "captured": now()}

    # 4) click every move tile and capture the rendered card
    n = pg.locator("#holdgrid .hold").count()
    for i in range(n):
        pg.locator("#holdgrid .hold").nth(i).click()
        pg.wait_for_timeout(50)
        log["moves"][i] = {
            "name": pg.inner_text("#hd-n"),
            "chips": pg.eval_on_selector_all("#hd-chips span", "els=>els.map(e=>e.textContent)"),
            "how": pg.eval_on_selector_all("#hd-h li", "els=>els.map(e=>e.textContent)"),
            "works": pg.inner_text("#hd-f"), "easy": pg.inner_text("#hd-e"), "hard": pg.inner_text("#hd-x"),
            "avoid": pg.inner_text("#hd-a"), "safe": pg.inner_text("#hd-s"),
            "dose": pg.eval_on_selector_all("#hd-d span", "els=>els.map(e=>e.textContent)"),
            "captured": now(),
        }
    b.close()

# 5) embedded script (the page's own public JS) saved verbatim
emb = (RAW / "landing_embed_rendered.html").read_text()
raw_embed = urllib.request.urlopen(urllib.request.Request(EMBED, headers={"User-Agent": "Mozilla/5.0"})).read().decode()
(RAW / "landing_embed_raw.html").write_text(raw_embed)
log["pages"]["landing_embed_raw"] = {"url": EMBED, "retrieved": now(), "sha256": hashlib.sha256(raw_embed.encode()).hexdigest()}

# 6) public preview images listed in the page's own IMG map
m = re.search(r"var IMG = (\{.*?\});", raw_embed, re.S)
img_map = json.loads(m.group(1))
(RAW / "img").mkdir(exist_ok=True)
log["images"] = {}
for name, url in img_map.items():
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r:
        data = r.read(); ctype = r.headers.get("content-type")
    path = RAW / "img" / name
    path.write_bytes(data)
    log["images"][name] = {"url": url, "content_type": ctype, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "retrieved": now()}

log["finished"] = now()
(RAW / "capture_log.json").write_text(json.dumps(log, indent=2))
print("doors", len(log["doors"]), "moves", len(log["moves"]), "images", len(log["images"]))
