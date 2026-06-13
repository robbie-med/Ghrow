# Growth Curve Plotter

[![GitHub release](https://img.shields.io/github/v/release/robbie-med/Ghrow?label=release)](https://github.com/robbie-med/Ghrow/releases)
[![License](https://img.shields.io/github/license/robbie-med/Ghrow)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-ready-blue)](https://robbie-med.github.io/Ghrow/)

A lightweight static web app for plotting a child's measurements on selectable WHO and CDC growth reference curves. Everything — curve data, catalog metadata, and plotting logic — is plain HTML/CSS/JavaScript so the source can be inspected and the app deployed to GitHub Pages with no backend.

> Clinical caution: this is a review and plotting tool, not a diagnostic device. Verify the source data and clinical interpretation before use in patient care.

## What it does

- **Fast entry** — set sex + date of birth once, then add a visit's weight, length/height, and head circumference in a single row. Age is computed automatically.
- **Pick any reference curve** — choose a *measure* (weight, height/length, head circumference, BMI, weight-for-length) and a *source/range* (WHO 2006, CDC 2000, CDC infant). The child's line is overlaid on the shaded percentile bands.
- **Instant readout** — latest measurement, exact percentile, Z-score, and growth **velocity** (change per month) with a percentile-trend indicator.
- **Local only** — measurements live in the browser's `localStorage`. Save / load / export JSON / import JSON. Nothing is uploaded.
- **Corrected age** — enter a gestational age under 37 weeks to enable a corrected-age toggle for age-based curves.

## Quick start

```bash
node scripts/fetch-data.js     # download WHO/CDC source CSVs into data/
node scripts/verify-data.js    # sanity-check the downloaded headers
python3 -m http.server 8000    # serve locally
```

Then open `http://localhost:8000/`.

The reference CSVs are committed to the repo, so the app also works without running the fetch script.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Ensure the `data/` CSV files are committed (run `node scripts/fetch-data.js` if needed).
3. In repository settings, enable Pages from the `main` branch root.
4. Visit the published URL.

## Repo contents

- `index.html` — entry form, chart, and measurement table
- `about.html` — raw CSV browser and catalog metadata viewer
- `css/styles.css` — app styling (single dark theme)
- `js/data.js` — CSV parsing, LMS math, percentile/Z helpers
- `js/app.js` — application state, chart rendering, and form logic
- `js/about.js` — raw data viewer logic
- `js/lib/chart.umd.min.js` — vendored [Chart.js](https://www.chartjs.org/) (no CDN; fully self-contained)
- `data/catalog.json` — registry of curve metadata and file paths
- `scripts/fetch-data.js` — downloads the official source CSVs
- `scripts/verify-data.js` — validates downloaded CSV headers

## Supported curves

**Standard references**

- **WHO 2006** (0–24 months): weight-for-age, length-for-age, head circumference-for-age, weight-for-length
- **CDC 2000 infant** (0–36 months): weight-for-age, length-for-age, head circumference-for-age, weight-for-length
- **CDC 2000** (2–20 years): weight-for-age, stature-for-age, BMI-for-age, weight-for-stature

**Special populations** (pick a measure, then the matching source)

- **Fenton 2003** — preterm, 22–50 weeks postmenstrual age (weight, length, head circumference)
- **INTERGROWTH-21st** — preterm postnatal growth, 27–64 weeks postmenstrual age (weight, length, head circumference)
- **Down syndrome (Zemel 2015)** — birth–20 years (weight, length/height, head circumference, BMI)
- **China NHC 2022 (WS/T 423-2022)** — birth–7 years (weight, height, head circumference, BMI, weight-for-height/length)
- **Korea KNGC2017** — documented; integration pending a machine-readable export from the KDCA portal

Preterm charts plot by postmenstrual age, so a gestational age is required. Generate the special-population CSVs with `python3 scripts/build-special-curves.py`.

## Data sources &amp; citations

Reference tables are derived from these open publications and toolkits (see also the [About page](about.html)). `scripts/build-special-curves.py` documents exactly how each CSV is produced.

- WHO / CDC: official tables fetched by `scripts/fetch-data.js`.
- Fenton 2003 (Fenton TR, *BMC Pediatrics* 2003;3:13) and Down syndrome (Zemel BS et al., *Pediatrics* 2015;136:e1204) — LMS tables via [jhchou/peditools](https://github.com/jhchou/peditools).
- INTERGROWTH-21st Postnatal Growth (Villar J et al., *Lancet Glob Health* 2015) — centile tables via [SASPAC/gigs](https://github.com/SASPAC/gigs).
- China NHC *WS/T 423-2022* — parameter tables via [xiaot945/groowooth](https://github.com/xiaot945/groowooth).
- [childsds](https://cran.r-project.org/web/packages/childsds/refman/childsds.html) ([Leipzig source](https://git.sc.uni-leipzig.de/my221hepi/childsds)) — curated multi-reference LMS collection, consulted for provenance.
- Korea KNGC2017 — official tables at the [KDCA growth-chart portal](https://knhanes.kdca.go.kr/knhanes/grtcht/main.do) (integration pending).

## Adding new curves

Add the source CSV under `data/` and register it in `data/catalog.json` with fields such as `id`, `standard`, `sourceLabel`, `label`, `range`, `family`, `metric`, `path` (or sex-specific `files`), `xColumn`, `xUnit` (`days`, `weeks`, `months`, or `cm`), `xLabel`, `yLabel`, and — for combined-sex files — `sexColumn`, `maleValue`, `femaleValue`. The CSV must include `L`, `M`, `S`, and percentile columns; both numeric (`P3`, `P50`, `P97`) and ordinal (`5th`, `50th`, `98th`) percentile headers are supported.

## How the math works

Each percentile line is read straight from the source CSV. For an entered measurement, the app interpolates the row's `L`, `M`, `S` parameters at the child's age (or length) and computes the LMS Z-score, then converts it to an exact percentile. Growth velocity is the change in the measured value between consecutive visits, per month, alongside the change in Z-score.

## License

Available under the [MIT License](LICENSE).
