(function () {
  'use strict';

  const state = { catalog: [], files: [] };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      state.catalog = await GrowthData.loadCatalog();
      state.files = flattenFiles(state.catalog);
      populateFileSelect();
      document.getElementById('fileSelect').addEventListener('change', renderFile);
      await renderFile();
    } catch (error) {
      setStatus('Catalog load failed');
      showMissing(`Could not load catalog. ${error.message}`);
    }
  }

  function flattenFiles(catalog) {
    const map = new Map();

    catalog.forEach((curve) => {
      if (curve.disabled) return;
      if (curve.files) {
        Object.entries(curve.files).forEach(([sex, file]) => {
          addFile(map, curve, file, sex);
        });
      } else {
        addFile(map, curve, { path: curve.path, sourceUrl: curve.sourceUrl }, 'combined');
      }
    });

    return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
  }

  function addFile(map, curve, file, sex) {
    const key = file.path;
    if (!map.has(key)) {
      map.set(key, {
        path: file.path,
        sourceUrl: file.sourceUrl,
        label: file.label || `${curve.standard}: ${curve.label}`,
        standard: curve.standard,
        sex,
        curves: []
      });
    }
    map.get(key).curves.push(`${curve.label}${sex !== 'combined' ? ` (${sex})` : ''}`);
  }

  function populateFileSelect() {
    const select = document.getElementById('fileSelect');
    select.innerHTML = '';
    state.files.forEach((file, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = file.path;
      select.appendChild(option);
    });
  }

  async function renderFile() {
    const index = Number(document.getElementById('fileSelect').value || 0);
    const file = state.files[index];
    if (!file) return;

    hideMissing();
    setStatus('Loading file...');
    renderMeta(file);

    try {
      const text = await GrowthData.fetchText(file.path);
      document.getElementById('rawCsv').value = text;
      renderRawTable(text);
      setStatus(`${text.length.toLocaleString()} bytes`);
    } catch (error) {
      document.getElementById('rawCsv').value = '';
      document.getElementById('rawTable').innerHTML = '';
      setStatus('Data file missing');
      showMissing(`Could not load ${file.path}. Run node scripts/fetch-data.js from the project root and commit the downloaded data files. Details: ${error.message}`);
    }
  }

  function renderMeta(file) {
    const meta = document.getElementById('sourceMeta');
    meta.innerHTML = '';
    const rows = [
      ['Local file', file.path],
      ['Source URL', file.sourceUrl || 'Not specified'],
      ['Standard', file.standard || ''],
      ['Used by', file.curves.join('; ')]
    ];

    rows.forEach(([term, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      if (String(value).startsWith('http')) {
        const a = document.createElement('a');
        a.href = value;
        a.textContent = value;
        dd.appendChild(a);
      } else {
        dd.textContent = value;
      }
      meta.append(dt, dd);
    });
  }

  function renderRawTable(text) {
    const table = document.getElementById('rawTable');
    const rows = GrowthData.parseCsv(text);
    if (!rows.length) {
      table.innerHTML = '';
      return;
    }

    const headers = Object.keys(rows[0]);
    const limit = Math.min(rows.length, 250);

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    headers.forEach((header) => {
      const th = document.createElement('th');
      th.textContent = header;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    const tbody = document.createElement('tbody');
    rows.slice(0, limit).forEach((row) => {
      const tr = document.createElement('tr');
      headers.forEach((header) => {
        const td = document.createElement('td');
        td.textContent = row[header];
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.innerHTML = '';
    table.append(thead, tbody);

    if (rows.length > limit) {
      const caption = document.createElement('caption');
      caption.textContent = `Showing first ${limit.toLocaleString()} of ${rows.length.toLocaleString()} rows. Full CSV is shown in the raw text box above.`;
      table.prepend(caption);
    }
  }

  function showMissing(message) {
    const box = document.getElementById('missingDataBox');
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function hideMissing() {
    document.getElementById('missingDataBox').classList.add('hidden');
  }

  function setStatus(message) {
    document.getElementById('status').textContent = message;
  }
}());
