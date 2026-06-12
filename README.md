# Growth Curve Plotter

Static GitHub Pages web app for plotting entered pediatric measurements against selectable WHO and CDC growth-curve source files.

## What is included

- `index.html`: measurement entry, plotting, save/load/export/import.
- `about.html`: explanation and raw CSV viewer.
- `css/styles.css`: page styling.
- `js/data.js`: CSV loading, LMS math, age calculation, local persistence helpers.
- `js/app.js`: chart and measurement UI.
- `js/about.js`: raw data viewer.
- `data/catalog.json`: auditable registry of each curve and source file.
- `scripts/fetch-data.js`: downloads the official CSV files listed in the catalog.
- `scripts/verify-data.js`: basic source-file validation.

## First setup

From the project root:

```bash
node scripts/fetch-data.js
node scripts/verify-data.js
```

Then commit the downloaded `data/cdc/*.csv` and `data/who/*.csv` files with the rest of the site before enabling GitHub Pages.

The app intentionally does not hide source tables inside JavaScript. The plotter and About page read the same files from `data/catalog.json`.

## Run locally

Because browsers often block `fetch()` from local `file://` pages, run a tiny local server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

## GitHub Pages deployment

1. Create a repository.
2. Copy this folder into the repository root.
3. Run `node scripts/fetch-data.js`.
4. Commit the downloaded data files.
5. In GitHub repository settings, enable Pages from the main branch root.

No backend, account system, or database is required.

## Data persistence

Measurements are saved to browser `localStorage` only when the user presses Save. This means:

- No measurement data is uploaded by the app.
- Saved data is device/browser specific.
- Clearing site data or using another browser removes access to those saved measurements.
- Use Export JSON / Import JSON for transfer or backup.

Avoid entering directly identifiable patient information unless your deployment and device context are appropriate.

## Curve math

The app plots percentile columns directly from the selected CSV. For patient-entered points, it interpolates the local LMS row and calculates the Z-score using:

```text
Z = ((value / M)^L - 1) / (L * S)
```

When `L` is approximately zero, it uses:

```text
Z = ln(value / M) / S
```

The displayed percentile is the standard normal CDF of the Z-score.

## Adding another curve set

Add the CSV file under `data/`, then add a record to `data/catalog.json` with:

- `id`
- `standard`
- `label`
- `metric`
- `path` or sex-specific `files`
- `xColumn`
- `xUnit`: `days`, `months`, `cm`, or other numeric units such as `weeks`
- `xLabel`
- `yLabel`
- optional `sexColumn`, `maleValue`, `femaleValue`

The CSV needs `L`, `M`, `S`, and percentile columns such as `P2`, `P3`, `P5`, `P10`, `P25`, `P50`, `P75`, `P90`, `P95`, `P97`, or `P98`.

## Current catalog

The initial catalog supports:

- WHO 2006 weight-for-age, length-for-age, head circumference-for-age, and weight-for-length from 0 to 24 months.
- CDC 2000 weight-for-age, stature-for-age, and BMI-for-age from 2 to 20 years.
- CDC 2000 legacy infant weight-for-age, length-for-age, head circumference-for-age, and weight-for-length.
- CDC 2000 weight-for-stature.
- Placeholder entries for China 2023 growth curves, Fenton, INTERGROWTH-21st, and Down syndrome curves.

## Known limits

- No server-side database.
- No audit log.
- No EHR integration.
- Corrected age is a plotting convenience, not a replacement for clinical judgment.
- Fenton, INTERGROWTH-21st, Down syndrome, and other special-population curves can be added through the catalog if compatible source tables are placed in `data/`.
