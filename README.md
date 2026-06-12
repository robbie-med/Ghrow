# Growth Curve Plotter

Static GitHub Pages web app for plotting entered pediatric measurements against selectable WHO and CDC growth-curve source files.

## What is included

- `index.html`: measurement entry, plotting, save/load/export/import.
# Growth Curve Plotter

[![GitHub release](https://img.shields.io/github/v/release/robbie-med/Ghrow?label=release)](https://github.com/robbie-med/Ghrow/releases)
[![License](https://img.shields.io/github/license/robbie-med/Ghrow)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-ready-blue)](https://robbie-med.github.io/Ghrow/)
[![Repo size](https://img.shields.io/github/repo-size/robbie-med/Ghrow)](https://github.com/robbie-med/Ghrow)

A lightweight static growth-curve plotter for pediatric measurements, built to be fully auditable, extensible, and deployable as GitHub Pages.

## Why this repo exists

This project puts all growth-curve source files, catalog metadata, and plotting logic in plain HTML/CSS/JavaScript so clinicians and reviewers can inspect the raw data, extend the catalog, and run the app without a backend.

It is designed for:

- fast patient data entry in a browser
- plotting entered measurements against WHO, CDC, and special-curve backgrounds
- saving and importing/exporting patient data locally
- keeping source CSV files visible and auditable

> Clinical caution: this app is a review and plotting tool, not a diagnostic system.

## Badges

- `Static web app` using HTML, CSS, and vanilla JavaScript
- `Data-driven` through `data/catalog.json` and CSV curve tables
- `Offline-first` patient persistence via browser localStorage
- `Extensible` with new growth curves added via catalog entries

## Features

- curve selector with WHO / CDC / placeholder special populations
- patient entry form plus row-based quick entry table
- dynamic chart rendering with percentiles and patient markers
- full raw CSV viewer on `about.html`
- browser JSON export/import and local save/load
- source-file validation scripts for safe publishing

## Repo contents

- `index.html` — app interface, data entry, plot, table, and utilities
- `about.html` — raw CSV browser and catalog metadata viewer
- `css/styles.css` — dark-mode-friendly app styling
- `js/data.js` — CSV parsing, LMS math, and growth-curve helpers
- `js/app.js` — application state, chart rendering, and form logic
- `js/about.js` — raw data viewer logic
- `data/catalog.json` — registry of curve metadata and paths
- `scripts/fetch-data.js` — fetches official CSV files from source URLs
- `scripts/verify-data.js` — validates downloaded CSV header structure
- `LICENSE` — MIT license for open use and contribution

## Quick start

```bash
node scripts/fetch-data.js
node scripts/verify-data.js
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Run `node scripts/fetch-data.js` and commit the downloaded data files.
3. In repository settings, enable Pages from the `main` branch root.
4. Visit the published URL for the static app.

## Adding new curves

Add the source CSV to `data/` and register it in `data/catalog.json` with fields such as:

- `id`
- `standard`
- `label`
- `metric`
- `path` or sex-specific `files`
- `xColumn`
- `xUnit` (`days`, `weeks`, `months`, `cm`)
- `xLabel`
- `yLabel`
- optional `sexColumn`, `maleValue`, `femaleValue`

The CSV must include `L`, `M`, `S`, and percentile columns. This repo supports both numeric and ordinal percentile headers such as `P3`, `5th`, `50th`, and `98th`.

## Supported curves

Out of the box, this repo includes:

- WHO 2006 weight-for-age, length-for-age, head circumference-for-age, weight-for-length
- CDC 2000 weight-for-age, stature-for-age, BMI-for-age
- CDC 2000 legacy infant weight-for-age, length-for-age, head circumference-for-age, weight-for-length
- CDC 2000 weight-for-stature
- placeholder entries for Fenton, INTERGROWTH-21st, China 2023, and Down syndrome curves

## Clinical data handling

- Measurements are saved only to browser `localStorage` when the user clicks Save.
- Export JSON / Import JSON enables transfer between devices.
- No patient data is uploaded to any server.
- Use the app in contexts where local patient data handling is appropriate.

## Contribution

Pull requests are welcome. For improvements, consider:

- adding additional curve sources
- improving raw-data validation
- refining chart UI and accessibility
- adding automated tests or CI workflows

## License

This project is available under the [MIT License](LICENSE).

## Repository tags

Pediatric growth curves · WHO · CDC · Fenton · INTERGROWTH-21st · Down syndrome · clinical plotting · static web app · audit-friendly
