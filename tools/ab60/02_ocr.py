"""Step 2: OCR public preview page images with macOS Vision (tesseract not available)."""
import json, pathlib, datetime
import Quartz, Vision
from Foundation import NSURL

ROOT = pathlib.Path(__file__).resolve().parents[2]
IMG = ROOT / "raw" / "ab60" / "img"
out = {}
for f in sorted(IMG.glob("*.jpg")):
    url = NSURL.fileURLWithPath_(str(f))
    src = Quartz.CGImageSourceCreateWithURL(url, None)
    cg = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    req.setUsesLanguageCorrection_(True)
    h = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, None)
    ok, err = h.performRequests_error_([req], None)
    lines = []
    for o in req.results():
        c = o.topCandidates_(1)[0]
        bb = o.boundingBox()
        lines.append({"text": str(c.string()), "conf": round(float(c.confidence()), 3), "y": round(1 - bb.origin.y - bb.size.height, 3), "x": round(bb.origin.x, 3)})
    lines.sort(key=lambda l: (round(l["y"], 2), l["x"]))
    out[f.name] = {"width": Quartz.CGImageGetWidth(cg), "height": Quartz.CGImageGetHeight(cg), "ocr_engine": "macOS Vision VNRecognizeTextRequest (accurate)", "lines": lines,
                   "ocr_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
    print("==", f.name, out[f.name]["width"], out[f.name]["height"], len(lines))
(ROOT / "raw" / "ab60" / "ocr.json").write_text(json.dumps(out, indent=2))
