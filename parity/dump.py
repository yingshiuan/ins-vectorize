#!/usr/bin/env python3
"""Ground truth for the TypeScript port of the curve fitter.

The fitter in web/src/trace/fit.ts is a port of logo_svg.py, an
unpublished script from an earlier logo project. A port
is only worth as much as its evidence, so this script drives the *original* over a
set of contours and records what it produced; web/src/trace/fit.test.ts runs the
port over the same contours and holds it to the same answers.

Writes two files:
  fixtures/contours.json  the inputs, so both sides fit exactly the same outlines
  expected.json           what logo_svg.py makes of them

Needs that script and NumPy; point LOGO_SVG at it and run from anywhere:
  LOGO_SVG=/path/to/logo_svg.py python parity/dump.py

Regenerate only when the Python changes. If this and the test disagree, the port
is wrong until proven otherwise -- the original is the one with logos shipped from it.
"""
import importlib.util
import json
import math
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get("LOGO_SVG", "logo_svg.py")).expanduser()


def load_logo_svg():
    """Import logo_svg.py by path; it is a script in another project, not a package."""
    spec = importlib.util.spec_from_file_location("logo_svg", SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def circle(cx, cy, r):
    """A circle as four cubics -- the shape a tracer should render in the fewest curves."""
    k = 0.5522847498307936 * r
    pts = [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]
    out = []
    for i in range(4):
        p0, p1 = pts[i], pts[(i + 1) % 4]
        t0 = (k, 0) if i == 0 else (0, k) if i == 1 else (-k, 0) if i == 2 else (0, -k)
        t1 = (0, -k) if i == 0 else (k, 0) if i == 1 else (0, k) if i == 2 else (-k, 0)
        out.append([list(p0), [p0[0] + t0[0], p0[1] + t0[1]], [p1[0] + t1[0], p1[1] + t1[1]], list(p1)])
    return out


def rounded_rect(x0, y0, x1, y1, r):
    """Straights meeting quarter-circle corners: tests that sharp joins survive the fit."""
    k = 0.5522847498307936 * r
    corners = [
        ((x1 - r, y0), (x1, y0 + r), (k, 0), (0, -k)),
        ((x1, y1 - r), (x1 - r, y1), (0, k), (k, 0)),
        ((x0 + r, y1), (x0, y1 - r), (-k, 0), (0, k)),
        ((x0, y0 + r), (x0 + r, y0), (0, -k), (-k, 0)),
    ]
    segs = []
    cur = (x0 + r, y0)
    for (a, b, ta, tb) in corners:
        segs.append([list(cur), list(a)])
        segs.append([list(a), [a[0] + ta[0], a[1] + ta[1]], [b[0] + tb[0], b[1] + tb[1]], list(b)])
        cur = b
    return segs


def blob(n=64, r=40.0, wobble=2.5, seed=7):
    """A closed polyline with reproducible noise on it -- the trace-wobble case the
    curvature-adaptive tolerance exists for."""
    state = seed
    def rnd():
        nonlocal state
        state = (1103515245 * state + 12345) % 2147483648
        return state / 2147483648

    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r + math.sin(3 * a) * 6 + (rnd() - 0.5) * wobble
        pts.append((60 + rr * math.cos(a), 60 + rr * math.sin(a)))
    return [[list(pts[i]), list(pts[(i + 1) % n])] for i in range(n)]


CONTOURS = {
    "circle": circle(50.0, 50.0, 30.0),
    "rounded_rect": rounded_rect(10.0, 10.0, 90.0, 60.0, 12.0),
    "blob": blob(),
}

# (tol_max, sigma) pairs: the shipped defaults, then looser and tighter.
SETTINGS = [(0.8, 1.0), (0.3, 0.5), (2.0, 1.5)]


def main():
    ls = load_logo_svg()
    import numpy as np

    (HERE / "fixtures").mkdir(parents=True, exist_ok=True)
    (HERE / "fixtures" / "contours.json").write_text(json.dumps(CONTOURS, indent=2) + "\n")

    cases = []
    for name, contour in CONTOURS.items():
        segs = [tuple(np.array(p, dtype=float) for p in seg) for seg in contour]
        for tol_max, sigma in SETTINGS:
            ls.SIGMA = sigma  # fit_contour reads it through smooth()
            curves = ls.fit_contour(segs, tol_max)
            cases.append({
                "contour": name,
                "tolMax": tol_max,
                "sigma": sigma,
                "curves": [[[round(float(v), 9) for v in p] for p in c] for c in curves],
            })
            print(f"{name:14} tolMax={tol_max:<4} sigma={sigma:<4} -> {len(curves)} curves")

    (HERE / "expected.json").write_text(json.dumps({"source": SOURCE.name, "cases": cases}, indent=2) + "\n")
    print(f"\nwrote {HERE / 'expected.json'}")


if __name__ == "__main__":
    main()
