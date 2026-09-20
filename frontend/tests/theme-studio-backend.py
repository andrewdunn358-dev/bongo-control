"""The Studio's package, judged by the Pi's own validator.

The node test next door checks the Studio's rules; this checks the only
opinion that matters at install time. It runs backend
theme_service.validate_package against the package the Studio just
built (tests/.artifacts/studio-sample.vanos-theme), and asserts the Pi
keeps the parts the app then reads.

Run: node tests/theme-studio.test.mjs && python3 tests/theme-studio-backend.py
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "backend"))

from app.services.theme_service import validate_package  # noqa: E402

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

print("Studio package accepted by the Pi's own validator, with every field it carries intact.")
