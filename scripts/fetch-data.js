#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { pipeline } = require('stream/promises');

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'catalog.json');
const FORCE = process.argv.includes('--force');

function readCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function listFiles(catalog) {
  const files = new Map();

  for (const curve of catalog.curves || []) {
    if (curve.files) {
      for (const file of Object.values(curve.files)) add(files, file.path, file.sourceUrl);
    } else {
      add(files, curve.path, curve.sourceUrl);
    }
  }

  return Array.from(files.values());
}

function add(map, localPath, sourceUrl) {
  if (!localPath || !sourceUrl) return;
  map.set(localPath, { localPath, sourceUrl });
}

async function download(url, destination, redirects = 0) {
  if (redirects > 5) throw new Error(`Too many redirects: ${url}`);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });

  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'growth-curve-plotter-data-fetch' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const nextUrl = new URL(response.headers.location, url).toString();
        response.resume();
        download(nextUrl, destination, redirects + 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }

      pipeline(response, fs.createWriteStream(destination)).then(resolve).catch(reject);
    });

    request.setTimeout(30000, () => {
      request.destroy(new Error(`Timeout downloading ${url}`));
    });

    request.on('error', reject);
  });
}

function looksLikeCsv(filePath) {
  const first = fs.readFileSync(filePath, 'utf8').split(/\r?\n/, 1)[0];
  return first.includes(',') && /(^|,)L(,|$)/.test(first) && /(^|,)M(,|$)/.test(first) && /(^|,)S(,|$)/.test(first);
}

async function main() {
  const catalog = readCatalog();
  const files = listFiles(catalog);
  const results = [];

  for (const file of files) {
    const destination = path.join(ROOT, file.localPath);
    const exists = fs.existsSync(destination);

    if (exists && !FORCE) {
      console.log(`skip ${file.localPath}`);
      results.push({ ...file, status: 'skipped' });
      continue;
    }

    process.stdout.write(`download ${file.sourceUrl}\n  -> ${file.localPath}\n`);
    await download(file.sourceUrl, destination);

    if (!looksLikeCsv(destination)) {
      throw new Error(`Downloaded file does not look like an LMS CSV: ${file.localPath}`);
    }

    results.push({ ...file, status: 'downloaded', bytes: fs.statSync(destination).size });
  }

  const lockPath = path.join(ROOT, 'data', 'last-fetch.json');
  fs.writeFileSync(lockPath, JSON.stringify({ fetchedAt: new Date().toISOString(), files: results }, null, 2));
  console.log(`done: ${results.length} files checked`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
