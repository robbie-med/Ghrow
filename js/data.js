(function () {
  'use strict';

  const MONTH_DAYS = 365.2425 / 12;
  const PERCENTILE_COLUMNS = ['P2', 'P3', 'P5', 'P10', 'P25', 'P50', 'P75', 'P90', 'P95', 'P97', 'P98'];

  async function fetchText(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Could not load ${path} (${response.status})`);
    }
    return response.text();
  }

  async function loadCatalog() {
    const response = await fetch('data/catalog.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Could not load data/catalog.json (${response.status})`);
    }
    const catalog = await response.json();
    return catalog.curves || [];
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(value);
        value = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(value);
        if (row.some((cell) => cell.trim() !== '')) rows.push(row);
        row = [];
        value = '';
      } else {
        value += char;
      }
    }

    row.push(value);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    if (!rows.length) return [];

    const headers = rows[0].map((header) => header.trim());
    return rows.slice(1).map((cells) => {
      const object = {};
      headers.forEach((header, index) => {
        const raw = cells[index] === undefined ? '' : cells[index].trim();
        const numeric = Number(raw);
        object[header] = raw !== '' && Number.isFinite(numeric) ? numeric : raw;
      });
      return object;
    });
  }

  function fileForSex(curve, sex) {
    if (curve.files && curve.files[sex]) return curve.files[sex];
    return { path: curve.path, sourceUrl: curve.sourceUrl };
  }

  async function loadCurveRows(curve, sex) {
    const file = fileForSex(curve, sex);
    const csv = await fetchText(file.path);
    let rows = parseCsv(csv);

    if (curve.sexColumn) {
      const sexValue = sex === 'male' ? curve.maleValue : curve.femaleValue;
      rows = rows.filter((row) => String(row[curve.sexColumn]) === String(sexValue));
    }

    rows = rows
      .map((row) => normalizeRow(row, curve))
      .filter((row) => Number.isFinite(row.chartX) && Number.isFinite(row.L) && Number.isFinite(row.M) && Number.isFinite(row.S))
      .sort((a, b) => a.chartX - b.chartX);

    return { rows, csv, file };
  }

  function normalizeRow(row, curve) {
    const xColumn = resolveColumn(row, curve.xColumn, curve.xColumnAliases);
    const sourceX = Number(row[xColumn]);
    let chartX = sourceX;

    if (curve.xUnit === 'days') chartX = sourceX / MONTH_DAYS;
    if (curve.xUnit === 'weeks') chartX = sourceX / 4.348125;
    if (curve.xUnit === 'months') chartX = sourceX;
    if (curve.xUnit === 'cm') chartX = sourceX;

    return {
      ...row,
      sourceX,
      chartX,
      L: Number(row.L),
      M: Number(row.M),
      S: Number(row.S)
    };
  }

  function normalizePercentileColumn(column) {
    if (!column) return null;
    const raw = String(column).trim();
    const pMatch = raw.match(/^P\s*(\d{1,3})$/i);
    if (pMatch) return `P${Number(pMatch[1])}`;
    const ordinalMatch = raw.match(/^(\d{1,3}(?:\.\d+)?)\s*(?:st|nd|rd|th)\b/i);
    if (ordinalMatch) return `P${Math.round(Number(ordinalMatch[1]))}`;
    return null;
  }

  function percentileLabel(column) {
    const normalized = normalizePercentileColumn(column);
    if (!normalized) return String(column);
    const value = Number(normalized.slice(1));
    const suffix = value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th';
    return `${value}${suffix}`;
  }

  function resolveColumn(row, preferred, aliases) {
    const headers = Object.keys(row || {});
    const candidates = [];
    if (preferred) candidates.push(preferred);
    (aliases || []).forEach((a) => { if (a) candidates.push(a); });

    // 1) exact case-insensitive match against headers
    for (const h of headers) {
      for (const c of candidates) {
        if (c && h.toLowerCase() === c.toLowerCase()) return h;
      }
    }

    // 2) permissive contains/substring match (e.g. 'Month' vs 'Age', 'Agemos')
    for (const h of headers) {
      for (const c of candidates) {
        if (!c) continue;
        const hl = h.toLowerCase();
        const cl = c.toLowerCase();
        if (hl.includes(cl) || cl.includes(hl)) return h;
      }
    }

    // 3) fallback to a header that looks like an age/month/day column
    for (const h of headers) {
      const hl = h.toLowerCase();
      if (hl.includes('age') || hl.includes('month') || hl.includes('mo') || hl.includes('day')) return h;
    }

    // 4) last resort: return preferred if present, otherwise first header or preferred
    if (preferred && Object.prototype.hasOwnProperty.call(row, preferred)) return preferred;
    return headers[0] || preferred;
  }

  function percentileColumns(rows) {
    const columns = new Map();
    rows.forEach((row) => {
      Object.keys(row).forEach((key) => {
        const normalized = normalizePercentileColumn(key);
        if (normalized) columns.set(key, normalized);
      });
    });

    return Array.from(columns.entries())
      .sort((a, b) => Number(a[1].slice(1)) - Number(b[1].slice(1)))
      .map(([key]) => key);
  }

  function valueForObservation(observation, metric) {
    if (metric === 'weight-age') return numberOrNull(observation.weightKg);
    if (metric === 'length-age') return numberOrNull(observation.lengthCm);
    if (metric === 'stature-age') return numberOrNull(observation.lengthCm);
    if (metric === 'head-age') return numberOrNull(observation.headCm);
    if (metric === 'weight-length') return numberOrNull(observation.weightKg);
    if (metric === 'weight-stature') return numberOrNull(observation.weightKg);
    if (metric === 'bmi-age') {
      const weight = numberOrNull(observation.weightKg);
      const length = numberOrNull(observation.lengthCm);
      if (!weight || !length) return null;
      return weight / Math.pow(length / 100, 2);
    }
    return null;
  }

  function xForObservation(observation, curve, options) {
    if (curve.xUnit === 'cm') return numberOrNull(observation.lengthCm);
    const chronological = numberOrNull(observation.ageMonths);
    if (!Number.isFinite(chronological)) return null;

    if (!options || !options.useCorrectedAge) return chronological;
    const gaWeeks = parseGestationalAgeWeeks(options.gestAge);
    if (!Number.isFinite(gaWeeks) || gaWeeks >= 37) return chronological;
    const correctionMonths = Math.max(0, (40 - gaWeeks) / 4.348125);
    return Math.max(0, chronological - correctionMonths);
  }

  function parseGestationalAgeWeeks(value) {
    if (!value) return null;
    const text = String(value).trim();
    const mixed = text.match(/^(\d{1,2})\s+(\d)\s*\/\s*7$/);
    if (mixed) return Number(mixed[1]) + Number(mixed[2]) / 7;
    const decimal = Number(text);
    return Number.isFinite(decimal) ? decimal : null;
  }

  function calculateAgeMonths(dob, measureDate) {
    if (!dob || !measureDate) return null;
    const start = new Date(`${dob}T00:00:00`);
    const end = new Date(`${measureDate}T00:00:00`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return null;
    return (end - start) / (1000 * 60 * 60 * 24) / MONTH_DAYS;
  }

  function interpolateLms(rows, x) {
    if (!rows.length || !Number.isFinite(x)) return null;
    if (x <= rows[0].chartX) return rows[0];
    if (x >= rows[rows.length - 1].chartX) return rows[rows.length - 1];

    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].chartX >= x) {
        const left = rows[i - 1];
        const right = rows[i];
        const span = right.chartX - left.chartX || 1;
        const fraction = (x - left.chartX) / span;
        return {
          L: lerp(left.L, right.L, fraction),
          M: lerp(left.M, right.M, fraction),
          S: lerp(left.S, right.S, fraction)
        };
      }
    }
    return null;
  }

  function zScoreFromLms(value, lms) {
    if (!lms || !Number.isFinite(value) || value <= 0 || !Number.isFinite(lms.M) || !Number.isFinite(lms.S)) return null;
    if (Math.abs(lms.L) < 1e-7) return Math.log(value / lms.M) / lms.S;
    return (Math.pow(value / lms.M, lms.L) - 1) / (lms.L * lms.S);
  }

  function normalCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  function erf(x) {
    const sign = x >= 0 ? 1 : -1;
    const abs = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * abs);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs);
    return sign * y;
  }

  function lerp(a, b, fraction) {
    return a + (b - a) * fraction;
  }

  function numberOrNull(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) return '';
    return Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  function storageKey() {
    return 'growthCurvePlotter:v1';
  }

  const FAMILY_LABELS = {
    'weight-age': 'Weight for age',
    'height-age': 'Height / length for age',
    'head-age': 'Head circumference for age',
    'bmi-age': 'BMI for age',
    'weight-height': 'Weight for length / height'
  };

  function familyLabel(family) {
    return FAMILY_LABELS[family] || family || 'Other';
  }

  // What measurement does this curve need from the patient, in plain terms.
  function curveInput(curve) {
    if (!curve) return null;
    if (curve.metric === 'weight-length' || curve.metric === 'weight-stature') return 'weight-length';
    if (curve.metric === 'bmi-age') return 'bmi';
    if (curve.metric === 'weight-age') return 'weight';
    if (curve.metric === 'length-age' || curve.metric === 'stature-age') return 'length';
    if (curve.metric === 'head-age') return 'head';
    return null;
  }

  function ordinal(value) {
    const n = Math.round(value);
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    const suffix = n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
    return `${n}${suffix}`;
  }

  // Percentile as a clinician-friendly string. Clamps extremes so we never print "0th"/"100th".
  function percentileText(pct) {
    if (!Number.isFinite(pct)) return '';
    if (pct < 0.1) return '<1st';
    if (pct > 99.9) return '>99th';
    if (pct < 1) return `${pct.toFixed(1)}th`;
    return ordinal(pct);
  }

  window.GrowthData = {
    MONTH_DAYS,
    PERCENTILE_COLUMNS,
    fetchText,
    loadCatalog,
    parseCsv,
    fileForSex,
    loadCurveRows,
    normalizePercentileColumn,
    percentileLabel,
    percentileColumns,
    valueForObservation,
    xForObservation,
    calculateAgeMonths,
    parseGestationalAgeWeeks,
    interpolateLms,
    zScoreFromLms,
    normalCdf,
    formatNumber,
    storageKey,
    familyLabel,
    curveInput,
    ordinal,
    percentileText
  };
}());
