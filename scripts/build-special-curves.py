#!/usr/bin/env python3
"""Build special-population growth-curve CSVs from published open sources.

Sources (see About page / README for full citations):
  - peditools (jhchou)         -> Fenton 2003 preterm, Zemel 2015 Down syndrome  [LMS]
  - groowooth (xiaot945)       -> China NHC / WS-T 423-2022                       [+/-SD values]
  - gigs (SASPAC, SAS port)    -> INTERGROWTH-21st Postnatal Growth standards     [centiles]
  - KDCA (knhanes portal)      -> Korea KNGC2017 growth charts                    [LMS, .xlsx]

Each output CSV uses a uniform schema the plotter understands:
  - LMS sources:        Sex,<X>,L,M,S,P3,P5,P10,P25,P50,P75,P90,P95,P97
  - percentile sources: Sex,<X>,P3,P5,P10,(P25),P50,(P75),P90,P95,P97
Sex is encoded 1=male, 2=female (matching the CDC files already in the repo).

Run from the repo root:  python3 scripts/build-special-curves.py
Re-run is idempotent; it overwrites the generated files under data/.
"""
import csv
import io
import os
import sys
import tarfile
import urllib.request
from statistics import NormalDist

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.environ.get("GHROW_SRC", "/tmp/ghrow-src")
N = NormalDist()

ARCHIVES = {
    "peditools": "https://codeload.github.com/jhchou/peditools/tar.gz/refs/heads/master",
    "groowooth": "https://codeload.github.com/xiaot945/groowooth/tar.gz/refs/heads/master",
    "gigs":      "https://codeload.github.com/SASPAC/gigs/tar.gz/refs/heads/main",
}

PCTS = [3, 5, 10, 25, 50, 75, 90, 95, 97]
PCOLS = [f"P{p}" for p in PCTS]
Z_OF_PCT = {p: N.inv_cdf(p / 100.0) for p in PCTS}


def log(*a):
    print(*a, file=sys.stderr)


def ensure_sources():
    os.makedirs(WORK, exist_ok=True)
    roots = {}
    for name, url in ARCHIVES.items():
        # Reuse an already-extracted dir if present (any *-master / *-main).
        existing = [d for d in os.listdir(WORK) if d.startswith(name + "-") and os.path.isdir(os.path.join(WORK, d))]
        if existing:
            roots[name] = os.path.join(WORK, existing[0])
            continue
        log(f"downloading {name} …")
        data = urllib.request.urlopen(url, timeout=120).read()
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
            tf.extractall(WORK)
        existing = [d for d in os.listdir(WORK) if d.startswith(name + "-") and os.path.isdir(os.path.join(WORK, d))]
        roots[name] = os.path.join(WORK, existing[0])
    return roots


def write_csv(relpath, header, rows):
    out = os.path.join(ROOT, "data", relpath)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)
    log(f"  wrote data/{relpath}  ({len(rows)} rows)")


def lms_percentiles(L, M, S):
    vals = []
    for p in PCTS:
        z = Z_OF_PCT[p]
        if abs(L) < 1e-7:
            v = M * pow(2.718281828459045, S * z)
        else:
            v = M * pow(1 + L * S * z, 1.0 / L)
        vals.append(round(v, 4))
    return vals


def fmt(x):
    return f"{x:g}"


# ---------------------------------------------------------------------------
# peditools: Fenton 2003 + Zemel 2015 Down syndrome  (long-format LMS)
# ---------------------------------------------------------------------------
def load_peditools(root):
    path = os.path.join(root, "data-raw", "charts_long.csv")
    rows = list(csv.DictReader(open(path)))
    return rows


def emit_lms_curve(rows, chart, measure, relpath, x_to_native):
    sub = [r for r in rows if r["chart"] == chart and r["measure"] == measure]
    out = []
    for r in sub:
        sex = 1 if r["gender"].lower().startswith("m") else 2
        x = x_to_native(float(r["age"]))
        L, M, S = float(r["L"]), float(r["M"]), float(r["S"])
        out.append([sex, fmt(round(x, 4)), fmt(L), fmt(M), fmt(S)] + lms_percentiles(L, M, S))
    out.sort(key=lambda z: (z[0], float(z[1])))
    header = ["Sex", "X", "L", "M", "S"] + PCOLS
    write_csv(relpath, header, out)


# ---------------------------------------------------------------------------
# groowooth: China NHC / WS-T 423-2022  (+/-3 SD value tables -> percentiles)
# ---------------------------------------------------------------------------
SD_Z = {"neg3": -3, "neg2": -2, "neg1": -1, "median": 0, "pos1": 1, "pos2": 2, "pos3": 3}
SD_ORDER = ["neg3", "neg2", "neg1", "median", "pos1", "pos2", "pos3"]


def interp_value_at_z(zv_pairs, z):
    # zv_pairs sorted ascending by z; linear interpolation, clamp to range.
    if z <= zv_pairs[0][0]:
        return zv_pairs[0][1]
    if z >= zv_pairs[-1][0]:
        return zv_pairs[-1][1]
    for i in range(1, len(zv_pairs)):
        z1, v1 = zv_pairs[i - 1]
        z2, v2 = zv_pairs[i]
        if z <= z2:
            f = (z - z1) / (z2 - z1)
            return v1 + f * (v2 - v1)
    return zv_pairs[-1][1]


def emit_china_curve(root, basename, relpath):
    out = []
    for sex, suffix in ((1, "male"), (2, "female")):
        p = os.path.join(root, "data", "csv", "nhc", f"{basename}-{suffix}.csv")
        for r in csv.DictReader(open(p)):
            zv = sorted((SD_Z[k], float(r[k])) for k in SD_ORDER)
            pcts = [round(interp_value_at_z(zv, Z_OF_PCT[p]), 4) for p in PCTS]
            out.append([sex, fmt(float(r["x"]))] + pcts)
    out.sort(key=lambda z: (z[0], float(z[1])))
    write_csv(relpath, ["Sex", "X"] + PCOLS, out)


# ---------------------------------------------------------------------------
# gigs (SAS): INTERGROWTH-21st Postnatal Growth standards (centiles)
# ---------------------------------------------------------------------------
def load_gigs_png(root):
    import zipfile
    zpath = os.path.join(root, "gigs.zip")
    with zipfile.ZipFile(zpath) as zf:
        name = next(n for n in zf.namelist() if "ig_png_centiles_data" in n)
        text = zf.read(name).decode("utf-8", "replace")
    # Extract the CARDS4 datalines block.
    lines = text.splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.strip() == "CARDS4;")
    rows = []
    for ln in lines[start + 1:]:
        s = ln.strip()
        if s.startswith(";") or s.startswith("run") or not s:
            if s.startswith(";"):
                break
            continue
        parts = s.split()
        # acronym x_unit y_unit sex x P03 P05 P10 P50 P90 P95 P97
        if len(parts) < 12:
            continue
        rows.append(parts)
    return rows


def emit_ig_png(rows, acronym, relpath):
    sub = [r for r in rows if r[0].upper() == acronym]
    out = []
    for r in sub:
        sex = 1 if r[3].upper() == "M" else 2
        x = float(r[4])
        p03, p05, p10, p50, p90, p95, p97 = (float(v) for v in r[5:12])
        out.append([sex, fmt(x), p03, p05, p10, p50, p90, p95, p97])
    out.sort(key=lambda z: (z[0], float(z[1])))
    write_csv(relpath, ["Sex", "X", "P3", "P5", "P10", "P50", "P90", "P95", "P97"], out)


# ---------------------------------------------------------------------------
# KDCA: Korea KNGC2017 (LMS .xlsx behind a session + token download flow)
# ---------------------------------------------------------------------------
KDCA_BASE = "https://knhanes.kdca.go.kr"
KDCA_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
# 2017 "기본자료" data table (dataNo 7, fileSeq 2 = "성장도표 데이터 테이블.xls", actually xlsx)
KOREA_SHEETS = {
    "연령별 신장": ("korea/kngc2017-height-age.csv", 2),
    "연령별 체중": ("korea/kngc2017-weight-age.csv", 2),
    "연령별 체질량지수": ("korea/kngc2017-bmi-age.csv", 2),
    "연령별 머리둘레": ("korea/kngc2017-head-age.csv", 2),
    "신장별 체중(2세미만)": ("korea/kngc2017-weight-length-u2.csv", 1),
    "신장별 체중(3세 이상)": ("korea/kngc2017-weight-height-3plus.csv", 1),
}


def fetch_korea_xlsx(dest):
    import http.cookiejar
    import json as _json
    local = os.environ.get("GHROW_KOREA_XLSX")
    if local and os.path.exists(local):
        log(f"  using local KNGC2017 file {local}")
        with open(local, "rb") as fh, open(dest, "wb") as out:
            out.write(fh.read())
        return
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    opener.addheaders = [("User-Agent", KDCA_UA), ("Referer", KDCA_BASE + "/knhanes/grtcht/dwnld/dtDtl.do")]
    opener.open(KDCA_BASE + "/knhanes/grtcht/dwnld/dtLst.do", timeout=60).read()  # establish session
    req = urllib.request.Request(
        KDCA_BASE + "/knhanes/api/file/download.json",
        data=_json.dumps({"type": "GC", "dtlSn": 7, "flSn": 2}).encode(),
        headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
    )
    down_url = _json.loads(opener.open(req, timeout=60).read())["data"]["downUrl"]
    data = opener.open(urllib.request.Request(down_url), timeout=120).read()
    with open(dest, "wb") as out:
        out.write(data)


def build_korea():
    try:
        import openpyxl
    except ImportError:
        log("  openpyxl not installed (pip install openpyxl); skipping Korea.")
        return
    xlsx = os.path.join(WORK, "kngc2017.xlsx")
    if not os.path.exists(xlsx):
        os.makedirs(WORK, exist_ok=True)
        fetch_korea_xlsx(xlsx)
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    for title, (relpath, xcol) in KOREA_SHEETS.items():
        ws = wb[title]
        lcol = xcol + 1  # L, then M, S
        out = []
        for r in ws.iter_rows(min_row=3, values_only=True):
            if str(r[0]) not in ("1", "2"):
                continue
            try:
                sex = int(r[0]); x = float(r[xcol]); L = float(r[lcol]); M = float(r[lcol + 1]); S = float(r[lcol + 2])
            except (TypeError, ValueError):
                continue
            out.append([sex, fmt(x), fmt(L), fmt(M), fmt(S)] + lms_percentiles(L, M, S))
        out.sort(key=lambda z: (z[0], float(z[1])))
        write_csv(relpath, ["Sex", "X", "L", "M", "S"] + PCOLS, out)


def main():
    roots = ensure_sources()

    log("Fenton 2003 (peditools)…")
    ped = load_peditools(roots["peditools"])
    ident = lambda v: v
    emit_lms_curve(ped, "fenton_2003", "weight", "fenton/fenton2003-weight.csv", ident)
    emit_lms_curve(ped, "fenton_2003", "length", "fenton/fenton2003-length.csv", ident)
    emit_lms_curve(ped, "fenton_2003", "head_circ", "fenton/fenton2003-head.csv", ident)

    log("Down syndrome — Zemel 2015 (peditools)…")
    emit_lms_curve(ped, "zemel_2015_infant", "weight", "down/zemel2015-weight-infant.csv", ident)
    emit_lms_curve(ped, "zemel_2015_infant", "length", "down/zemel2015-length-infant.csv", ident)
    emit_lms_curve(ped, "zemel_2015_infant", "head_circ", "down/zemel2015-head-infant.csv", ident)
    yrs_to_mo = lambda v: v * 12.0
    emit_lms_curve(ped, "zemel_2015_pedi", "weight", "down/zemel2015-weight-pedi.csv", yrs_to_mo)
    emit_lms_curve(ped, "zemel_2015_pedi", "height", "down/zemel2015-height-pedi.csv", yrs_to_mo)
    emit_lms_curve(ped, "zemel_2015_pedi", "bmi", "down/zemel2015-bmi-pedi.csv", yrs_to_mo)
    emit_lms_curve(ped, "zemel_2015_pedi", "head_circ", "down/zemel2015-head-pedi.csv", yrs_to_mo)

    log("China NHC / WS-T 423-2022 (groowooth)…")
    g = roots["groowooth"]
    emit_china_curve(g, "weight-for-age", "china/china-nhc-weight-age.csv")
    emit_china_curve(g, "height-for-age", "china/china-nhc-height-age.csv")
    emit_china_curve(g, "bmi-for-age", "china/china-nhc-bmi-age.csv")
    emit_china_curve(g, "head-for-age", "china/china-nhc-head-age.csv")
    emit_china_curve(g, "weight-for-height", "china/china-nhc-weight-height.csv")
    emit_china_curve(g, "weight-for-length", "china/china-nhc-weight-length.csv")

    log("INTERGROWTH-21st Postnatal Growth (gigs)…")
    png = load_gigs_png(roots["gigs"])
    emit_ig_png(png, "WFA", "intergrowth/ig-png-weight.csv")
    emit_ig_png(png, "LFA", "intergrowth/ig-png-length.csv")
    emit_ig_png(png, "HCFA", "intergrowth/ig-png-head.csv")

    log("Korea KNGC2017 (KDCA)…")
    try:
        build_korea()
    except Exception as exc:  # network/session flakiness shouldn't fail the whole build
        log(f"  Korea build skipped: {exc}")

    log("done.")


if __name__ == "__main__":
    main()
