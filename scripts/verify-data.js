#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog.json'), 'utf8'));
const required = ['L', 'M', 'S'];
let failures = 0;

function normalizePercentileColumn(column) {
  if (!column) return null;
  const raw = String(column).trim();
  const pMatch = raw.match(/^P\s*(\d{1,3})$/i);
  if (pMatch) return `P${Number(pMatch[1])}`;
  const ordinalMatch = raw.match(/^(\d{1,3}(?:\.\d+)?)\s*(?:st|nd|rd|th)\b/i);
  if (ordinalMatch) return `P${Math.round(Number(ordinalMatch[1]))}`;
  return null;
}

function filesFromCatalog() {
  const map = new Map();
  for (const curve of catalog.curves || []) {
    if (curve.disabled) continue;
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

  const header = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/, 1)[0].split(',').map((x) => x.trim().replace(/^﻿/, ''));
  const hasLms = required.every((column) => header.includes(column));
  const percentileCount = header.filter((column) => normalizePercentileColumn(column)).length;

  // A usable curve file has either LMS parameters or explicit percentile columns.
  if ((!hasLms && percentileCount === 0) || percentileCount === 0) {
    console.error(`bad header ${localPath}: needs L,M,S or percentile columns`);
    failures += 1;
  } else {
    console.log(`ok ${localPath}`);
  }
}

process.exit(failures ? 1 : 0);
