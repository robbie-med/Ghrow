#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog.json'), 'utf8'));
const required = ['L', 'M', 'S'];
let failures = 0;

function filesFromCatalog() {
  const map = new Map();
  for (const curve of catalog.curves || []) {
    if (curve.files) {
      for (const file of Object.values(curve.files)) map.set(file.path, file.path);
    } else {
      map.set(curve.path, curve.path);
    }
  }
  return Array.from(map.values());
}

for (const localPath of filesFromCatalog()) {
  const fullPath = path.join(ROOT, localPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`missing ${localPath}`);
    failures += 1;
    continue;
  }

  const header = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/, 1)[0].split(',').map((x) => x.trim());
  const missing = required.filter((column) => !header.includes(column));
  const percentileCount = header.filter((column) => /^P\d+$/i.test(column)).length;

  if (missing.length || percentileCount === 0) {
    console.error(`bad header ${localPath}: missing ${missing.join(', ') || 'percentile columns'}`);
    failures += 1;
  } else {
    console.log(`ok ${localPath}`);
  }
}

process.exit(failures ? 1 : 0);
