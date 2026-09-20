"""The Studio's package, judged by the Pi's own validator.

The node test next door checks the Studio's rules; this checks the only
opinion that matters at install time. It runs backend
theme_service.validate_package against the package the Studio just
built (tests/.artifacts/studio-sample.vanos-theme), and asserts the Pi
keeps the parts the app then reads.

Run: node tests/theme-studio.test.mjs && python3 tests/theme-studio-backend.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODULE = HERE.parent.parent / "backend" / "app" / "services" / "theme_service.py"

# Loaded BY PATH, not as app.services.theme_service: importing it through
# the package runs backend/app/services/__init__.py, which imports every
# service and so needs httpx and the rest of the backend's dependencies.
# This job has Node and the standard library, nothing else - and
# theme_service itself imports only the standard library, which is what
# makes loading it alone both possible and honest: this is the real
# validator, not a copy of it.
spec = importlib.util.spec_from_file_location("vanos_theme_service", MODULE)
assert spec and spec.loader, f"Could not load {MODULE}"
theme_service = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = theme_service
spec.loader.exec_module(theme_service)
validate_package = theme_service.validate_package

package = HERE / ".artifacts" / "studio-sample.vanos-theme"
if not package.exists():
    sys.exit("Run tests/theme-studio.test.mjs first - it writes the package this checks.")

meta = validate_package(package.read_bytes())

assert meta["name"] == "Frankie's Pod", meta["name"]
assert meta["id"] == "frankie-s-pod", meta["id"]
assert meta["formatVersion"] == 1
assert meta["tokens"]["ink"] == "244 249 255", meta["tokens"]
assert meta["density"] == "compact"
assert meta["cockpit"] == "adventure"
assert meta["assets"] == {"hero": "assets/hero.png"}, meta["assets"]
assert meta["assetPaths"] == ["assets/hero.png"], meta["assetPaths"]
assert meta["heroCamera"] is False
assert meta["heroContent"]["title"] == "Pull up a sandbag.", meta["heroContent"]
assert meta["heroContent"]["quoteAuthor"] == "", meta["heroContent"]
assert meta["widgets"] == {"battery": {"variant": "illustrated"}}, meta["widgets"]
assert [i["widget"] for i in meta["homeLayout"]["items"]] == ["hero", "battery", "solar"], meta["homeLayout"]

# And the one with state-driven artwork: the Pi must keep the mapping,
# and keep only frames the package really contains.
artwork_package = HERE / ".artifacts" / "studio-artwork.vanos-theme"
if not artwork_package.exists():
    sys.exit("Run tests/theme-studio.test.mjs first - it writes the packages this checks.")

art_meta = validate_package(artwork_package.read_bytes())
art = art_meta["artwork"]
assert art is not None, "the Pi dropped the artwork block entirely"
assert [s["image"] for s in art["battery"]["levels"]] == ["assets/bat-25.png", "assets/bat-full.png"], art["battery"]
assert art["battery"]["levels"][0]["upTo"] == 25.0
assert "upTo" not in art["battery"]["levels"][1], "the open-ended frame must stay open-ended"
assert art["battery"]["charging"] == "assets/bat-charging.png"
assert art["battery"]["fill"] == {"body": "assets/body.png", "fill": "assets/liquid.png", "bottom": 0.86, "top": 0.14}
assert [s["image"] for s in art["solar"]["bands"]] == ["assets/s-idle.png", "assets/s-high.png"]
assert art["weather"]["conditions"] == {"rain": "assets/w-rain.png"}, art["weather"]

# A frame the package does not contain is dropped, not installed broken.
import io, json, zipfile  # noqa: E402

raw = artwork_package.read_bytes()
with zipfile.ZipFile(io.BytesIO(raw)) as zf:
    manifest = json.loads(zf.read("manifest.json"))
    definition = json.loads(zf.read("theme.json"))
    keep = [n for n in zf.namelist() if n != "assets/bat-25.png"]
    parts = {n: zf.read(n) for n in keep}
definition["artwork"]["battery"]["levels"].append({"upTo": 90, "image": "assets/never-packed.png"})
parts["theme.json"] = json.dumps(definition).encode()
parts["manifest.json"] = json.dumps(manifest).encode()
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w") as zf:
    for name, data in parts.items():
        zf.writestr(name, data)
patched = validate_package(buffer.getvalue())["artwork"]
images = [s["image"] for s in patched["battery"]["levels"]]
assert "assets/never-packed.png" not in images, images
assert "assets/bat-25.png" not in images, "a frame removed from the package must be dropped too"
assert images == ["assets/bat-full.png"], images

print("Studio packages accepted by the Pi's own validator: fields intact, and artwork")
print("frames the package does not contain are dropped rather than installed broken.")
