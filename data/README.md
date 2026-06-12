# Data directory

This directory is where source growth-chart CSV files live.

Run from the project root:

```bash
node scripts/fetch-data.js
node scripts/verify-data.js
```

The web app reads `data/catalog.json`, then fetches the CSV files listed there. The About page reads the same files and displays the raw CSV contents and a parsed table preview.

The CSV files are not meant to be edited by hand. To verify them, compare the local files against the source URLs in `data/catalog.json` or rerun `node scripts/fetch-data.js --force`.
