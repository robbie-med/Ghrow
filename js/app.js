(function () {
  'use strict';

  const state = {
    catalog: [],
    selectedCurve: null,
    rows: [],
    observations: [],
    chart: null
  };

  const COLORS = {
    P3: '#9aa6b2',
    P5: '#7f8c99',
    P10: '#708090',
    P25: '#4f6173',
    P50: '#2458a6',
    P75: '#4f6173',
    P90: '#708090',
    P95: '#7f8c99',
    P97: '#9aa6b2',
    Patient: '#b42326'
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    setMeasureDateDefault();

    try {
      state.catalog = await GrowthData.loadCatalog();
      populateCurveSelect();
      loadSaved(false);
      await render();
    } catch (error) {
      showStatus('Catalog load failed');
      showMissingData(`Could not load catalog. ${error.message}`);
    }
  }

  function bindEvents() {
    byId('chartSelect').addEventListener('change', render);
    document.querySelectorAll('input[name="sex"]').forEach((input) => input.addEventListener('change', render));
    byId('useCorrectedAge').addEventListener('change', renderChartOnly);
    byId('gestAge').addEventListener('input', renderChartOnly);
    byId('dob').addEventListener('change', fillAgeFromDates);
    byId('measureDate').addEventListener('change', fillAgeFromDates);
    byId('measurementForm').addEventListener('submit', addMeasurement);
    byId('clearForm').addEventListener('click', clearMeasurementForm);
    byId('saveAll').addEventListener('click', saveAll);
    byId('loadSaved').addEventListener('click', () => loadSaved(true));
    byId('exportJson').addEventListener('click', exportJson);
    byId('importJson').addEventListener('change', importJson);
    byId('clearAll').addEventListener('click', clearAll);
  }

  function populateCurveSelect() {
    const select = byId('chartSelect');
    select.innerHTML = '';

    const groups = new Map();
    state.catalog.forEach((curve) => {
      const group = curve.standard || 'Other';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(curve);
    });

    groups.forEach((curves, label) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = label;
      curves.forEach((curve) => {
        const option = document.createElement('option');
        option.value = curve.id;
        option.textContent = curve.label;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });
  }

  async function render() {
    const curveId = byId('chartSelect').value || (state.catalog[0] && state.catalog[0].id);
    state.selectedCurve = state.catalog.find((curve) => curve.id === curveId) || state.catalog[0];
    if (!state.selectedCurve) return;

    byId('chartSubtitle').textContent = `${state.selectedCurve.standard}: ${state.selectedCurve.label}`;
    hideMissingData();
    showStatus('Loading data...');

    try {
      const loaded = await GrowthData.loadCurveRows(state.selectedCurve, currentSex());
      state.rows = loaded.rows;
      showStatus(`${state.rows.length.toLocaleString()} source rows`);
      renderChartOnly();
    } catch (error) {
      state.rows = [];
      renderChartOnly();
      showStatus('Data file missing');
      showMissingData(missingDataMessage(state.selectedCurve, currentSex(), error));
    }
  }

  function renderChartOnly() {
    drawChart();
    drawTable();
  }

  function drawChart() {
    const canvas = byId('growthChart');
    const ctx = canvas.getContext('2d');
    const curve = state.selectedCurve;
    if (!curve) return;

    const percentileColumns = GrowthData.percentileColumns(state.rows);
    const datasets = [];

    percentileColumns.forEach((column) => {
      const points = state.rows
        .filter((row) => Number.isFinite(Number(row[column])))
        .map((row) => ({ x: row.chartX, y: Number(row[column]) }));

      datasets.push({
        label: column.replace('P', '') + 'th',
        data: points,
        parsing: false,
        borderColor: COLORS[column] || '#7f8c99',
        backgroundColor: COLORS[column] || '#7f8c99',
        borderWidth: column === 'P50' ? 2.5 : 1.25,
        borderDash: column === 'P50' ? [] : [3, 3],
        pointRadius: 0,
        tension: 0.18
      });
    });

    const patientPoints = patientPlotPoints(curve);
    datasets.push({
      label: 'Patient',
      data: patientPoints,
      parsing: false,
      borderColor: COLORS.Patient,
      backgroundColor: COLORS.Patient,
      borderWidth: 2.5,
      pointRadius: 4.5,
      pointHoverRadius: 6,
      spanGaps: true,
      tension: 0.08
    });

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label(context) {
              const x = GrowthData.formatNumber(context.parsed.x, 2);
              const y = GrowthData.formatNumber(context.parsed.y, 2);
              return `${context.dataset.label}: ${y} at ${x}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: curve.xLabel || 'X' },
          grid: { color: 'rgba(100, 114, 130, 0.18)' }
        },
        y: {
          title: { display: true, text: curve.yLabel || 'Y' },
          grid: { color: 'rgba(100, 114, 130, 0.18)' }
        }
      }
    };

    if (Number.isFinite(curve.xMin)) options.scales.x.min = curve.xMin;
    if (Number.isFinite(curve.xMax)) options.scales.x.max = curve.xMax;
    if (Number.isFinite(curve.yMin)) options.scales.y.min = curve.yMin;
    if (Number.isFinite(curve.yMax)) options.scales.y.max = curve.yMax;

    if (state.chart) state.chart.destroy();
    state.chart = new Chart(ctx, { type: 'line', data: { datasets }, options });
  }

  function patientPlotPoints(curve) {
    const opts = currentOptions();
    return state.observations
      .map((obs) => {
        const x = GrowthData.xForObservation(obs, curve, opts);
        const y = GrowthData.valueForObservation(obs, curve.metric);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y, obs };
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
  }

  function drawTable() {
    const tbody = byId('measurementsTable').querySelector('tbody');
    tbody.innerHTML = '';
    const curve = state.selectedCurve;
    if (!curve) return;

    patientPlotPoints(curve).forEach((point) => {
      const lms = GrowthData.interpolateLms(state.rows, point.x);
      const z = GrowthData.zScoreFromLms(point.y, lms);
      const pct = Number.isFinite(z) ? GrowthData.normalCdf(z) * 100 : null;
      const obs = point.obs;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(obs.measureDate || '')}</td>
        <td>${GrowthData.formatNumber(obs.ageMonths, 2)} mo</td>
        <td>${GrowthData.formatNumber(point.x, 2)}</td>
        <td>${GrowthData.formatNumber(point.y, 2)}</td>
        <td>${Number.isFinite(z) ? GrowthData.formatNumber(z, 2) : ''}</td>
        <td>${Number.isFinite(pct) ? GrowthData.formatNumber(pct, 1) + '%' : ''}</td>
        <td>${escapeHtml(obs.note || '')}</td>
        <td><button type="button" data-delete="${obs.id}">Delete</button></td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        state.observations = state.observations.filter((obs) => obs.id !== button.dataset.delete);
        renderChartOnly();
      });
    });
  }

  function addMeasurement(event) {
    event.preventDefault();
    fillAgeFromDates();

    const ageMonths = numericValue('ageMonths');
    const observation = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      measureDate: byId('measureDate').value,
      ageMonths,
      weightKg: numericValue('weightKg'),
      lengthCm: numericValue('lengthCm'),
      headCm: numericValue('headCm'),
      note: byId('note').value.trim()
    };

    const curve = state.selectedCurve;
    const x = GrowthData.xForObservation(observation, curve, currentOptions());
    const y = GrowthData.valueForObservation(observation, curve.metric);

    if (!Number.isFinite(x)) {
      showMissingData('Enter either DOB + date of measure or age in months.');
      return;
    }
    if (!Number.isFinite(y)) {
      showMissingData(`This curve requires ${curve.requiredMeasurement || 'the matching measurement value'}.`);
      return;
    }

    hideMissingData();
    state.observations.push(observation);
    clearMeasurementForm(true);
    renderChartOnly();
  }

  function fillAgeFromDates() {
    const dob = byId('dob').value;
    const measureDate = byId('measureDate').value;
    const age = GrowthData.calculateAgeMonths(dob, measureDate);
    if (Number.isFinite(age)) byId('ageMonths').value = GrowthData.formatNumber(age, 3);
  }

  function clearMeasurementForm(keepDate) {
    ['ageMonths', 'weightKg', 'lengthCm', 'headCm', 'note'].forEach((id) => { byId(id).value = ''; });
    if (!keepDate) byId('measureDate').value = '';
  }

  function saveAll() {
    const payload = collectPayload();
    localStorage.setItem(GrowthData.storageKey(), JSON.stringify(payload));
    showStatus('Saved locally');
  }

  function loadSaved(showMessage) {
    const raw = localStorage.getItem(GrowthData.storageKey());
    if (!raw) {
      if (showMessage) showStatus('No saved local data');
      return;
    }

    try {
      const payload = JSON.parse(raw);
      applyPayload(payload);
      renderChartOnly();
      if (showMessage) showStatus('Loaded saved data');
    } catch (error) {
      showStatus('Saved data unreadable');
    }
  }

  function collectPayload() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      curveId: byId('chartSelect').value,
      sex: currentSex(),
      patientLabel: byId('patientLabel').value.trim(),
      dob: byId('dob').value,
      gestAge: byId('gestAge').value.trim(),
      useCorrectedAge: byId('useCorrectedAge').checked,
      observations: state.observations
    };
  }

  function applyPayload(payload) {
    if (payload.curveId && state.catalog.some((curve) => curve.id === payload.curveId)) byId('chartSelect').value = payload.curveId;
    if (payload.sex) {
      const radio = document.querySelector(`input[name="sex"][value="${payload.sex}"]`);
      if (radio) radio.checked = true;
    }
    byId('patientLabel').value = payload.patientLabel || '';
    byId('dob').value = payload.dob || '';
    byId('gestAge').value = payload.gestAge || '';
    byId('useCorrectedAge').checked = Boolean(payload.useCorrectedAge);
    state.observations = Array.isArray(payload.observations) ? payload.observations : [];
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(collectPayload(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `growth-curve-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      applyPayload(payload);
      await render();
      showStatus('Imported JSON');
    } catch (error) {
      showMissingData(`Could not import JSON. ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }

  function clearAll() {
    if (!confirm('Clear all measurements and local saved data in this browser?')) return;
    state.observations = [];
    localStorage.removeItem(GrowthData.storageKey());
    renderChartOnly();
    showStatus('Local data cleared');
  }

  function currentSex() {
    return document.querySelector('input[name="sex"]:checked').value;
  }

  function currentOptions() {
    return {
      gestAge: byId('gestAge').value,
      useCorrectedAge: byId('useCorrectedAge').checked
    };
  }

  function numericValue(id) {
    const value = Number(byId(id).value);
    return Number.isFinite(value) ? value : null;
  }

  function setMeasureDateDefault() {
    byId('measureDate').value = new Date().toISOString().slice(0, 10);
  }

  function missingDataMessage(curve, sex, error) {
    const file = GrowthData.fileForSex(curve, sex);
    return `The selected curve file could not be loaded: ${file.path}. Run node scripts/fetch-data.js from the project root, commit the downloaded data directory, and reload the page. Details: ${error.message}`;
  }

  function showMissingData(message) {
    const box = byId('missingDataBox');
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function hideMissingData() {
    byId('missingDataBox').classList.add('hidden');
  }

  function showStatus(message) {
    byId('status').textContent = message;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function byId(id) {
    return document.getElementById(id);
  }
}());
