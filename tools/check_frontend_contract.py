#!/usr/bin/env python3
"""
FRONTEND CONTRACT GUARD

Fails the build if the UI would claim something the hardware cannot
verify, or repeats a bug this project has already had.

Each check below exists because the exact mistake was made once and
cost real debugging time. None of them fail a type check or a build,
which is why they are asserted here.

Run: python3 tools/check_frontend_contract.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"
failures: list[str] = []


def tsx_files():
    for p in SRC.rglob("*.ts*"):
        if "node_modules" in p.parts:
            continue
        yield p


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def check_current_a_alone() -> None:
    """BATTERY has TWO publishers - the Victron MPPT and the SmartShunt.
    When the MPPT's message is most recent it carries voltage but no
    current, so testing current_a alone reports 'no shunt' on a van that
    has had one fitted for months. Use hasShunt()."""
    pattern = re.compile(r"current_a\s*(==|!=)=?\s*null")
    for p in tsx_files():
        body = strip_comments(p.read_text())
        for line in body.splitlines():
            if not pattern.search(line) or "hasShunt" in line:
                continue
            # Displaying the VALUE conditionally is fine - you cannot show a
            # current that isn't there. What is not fine is concluding
            # something about the HARDWARE from the field's absence.
            claims = ("shunt", "voltage only", "mppt", "bms", "smartshunt", "not measurable", "fitted")
            if not any(c in line.lower() for c in claims):
                continue
            if "Math.abs" in line:
                continue
            failures.append(
                    f"{p.relative_to(SRC)}: tests current_a on its own. BATTERY has two "
                    f"publishers; use hasShunt(). -> {line.strip()[:90]}"
                )


def check_connectivity_domain() -> None:
    """Nothing in the backend publishes CONNECTIVITY except
    plugins/simulation. Any widget built on it reads 'offline'
    permanently on the real van."""
    for p in tsx_files():
        if p.name in ("telemetry.ts", "types.ts", "demo.ts"):
            continue
        body = strip_comments(p.read_text())
        if "useConnectivity" in body:
            failures.append(
                f"{p.relative_to(SRC)}: uses useConnectivity(). Nothing publishes the "
                "CONNECTIVITY domain on the real van - derive from useConnected() instead."
            )


def check_roof_position_claims() -> None:
    """There is no roof position sensor. OPEN/CLOSE as BUTTON LABELS is
    fine; presenting them as a known state is not."""
    # Follows the roof UI wherever it lives. Phase 2 of the composable
    # work moves telemetry cards into components/widgets/, and a guard
    # that only greps screens/ would go on passing against a file that
    # no longer drives the UI - the safety net lapsing exactly when the
    # most is moving. Repointed BEFORE the roof becomes widget-driven,
    # deliberately, rather than after.
    sources = [SRC / "screens" / "Roof.tsx"] + sorted((SRC / "components" / "widgets").glob("*Roof*.tsx"))
    present = [f for f in sources if f.is_file()]
    if not present:
        failures.append("no roof UI found in screens/ or components/widgets/")
        return
    body = "\n".join(f.read_text() for f in present)
    if "UNKNOWN" not in body:
        failures.append(
            "The roof UI no longer shows position as UNKNOWN. There is no position "
            "sensor - the app must never claim the roof is open or closed."
        )
    if not re.search(r"position sensor", body, re.I):
        failures.append(
            "The roof UI no longer explains that no position sensor is fitted."
        )


def check_relay_state_claims() -> None:
    """Relays sit in parallel with physical wall switches with no sense
    line, so state is commanded and never measured. The Switches screen
    must say so."""
    # Same reasoning as the roof check above: follow the relay UI into
    # components/widgets/ when it moves there.
    sources = [SRC / "screens" / "Switches.tsx"] + sorted((SRC / "components" / "widgets").glob("*Relay*.tsx")) \
        + sorted((SRC / "components" / "widgets").glob("*Switch*.tsx"))
    present = [f for f in sources if f.is_file()]
    if not present:
        failures.append("no relay UI found in screens/ or components/widgets/")
        return
    body = "\n".join(f.read_text() for f in present)
    if not re.search(r"command|parallel|cannot measure", body, re.I):
        failures.append(
            "The relay UI no longer discloses that relay state is commanded, "
            "not measured. Relays are wired in parallel with the wall switches."
        )


def check_api_base_same_origin() -> None:
    """Same-origin relative paths are load-bearing: the app must work
    identically on the LAN and through the Cloudflare Tunnel with no
    rebuild between them."""
    cfg = SRC / "lib" / "config.ts"
    if not cfg.is_file():
        failures.append("lib/config.ts is missing")
        return
    body = cfg.read_text()
    if "VITE_API_URL" in body or re.search(r"API_BASE\s*=\s*['\"]https?://", body):
        failures.append(
            "lib/config.ts: API_BASE must stay same-origin '/api'. An absolute URL or "
            "VITE_API_URL breaks either the LAN or the tunnel."
        )


def check_theme_css_prefixed() -> None:
    """Every theme's CSS ships in the bundle even though only one theme
    mounts, so an unprefixed selector in one theme silently restyles the
    others."""
    cockpits = SRC / "components" / "cockpits"
    if not cockpits.is_dir():
        return
    allowed = re.compile(r"^\.(vm|van|vi|vc)-")
    for css in cockpits.glob("*.css"):
        body = re.sub(r"/\*.*?\*/", "", css.read_text(), flags=re.S)
        selectors = re.findall(r"(?:^|[}\s,])(\.[A-Za-z][\w-]*)", body)
        bad = sorted({s for s in set(selectors) if not allowed.match(s)})
        if bad:
            failures.append(
                f"components/cockpits/{css.name}: unprefixed selectors {bad[:4]} - "
                "theme CSS must be namespaced or it leaks into other themes."
            )


def main() -> int:
    check_current_a_alone()
    check_connectivity_domain()
    check_roof_position_claims()
    check_relay_state_claims()
    check_api_base_same_origin()
    check_theme_css_prefixed()

    if failures:
        print("FRONTEND CONTRACT VIOLATION\n")
        for f in failures:
            print(f"  ✗ {f}")
        print(
            "\nEach of these checks exists because the mistake was made once already.\n"
            "See docs/FRONTEND-CONTRACT.md for the reasoning behind each rule."
        )
        return 1

    print("Frontend contract OK - shunt detection, connectivity source, roof position")
    print("honesty, relay state disclosure, same-origin API and theme CSS isolation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
