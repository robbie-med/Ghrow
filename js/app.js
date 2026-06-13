(function () {
  'use strict';

  const FAMILY_ORDER = ['weight-age', 'height-age', 'head-age', 'bmi-age', 'weight-height'];

  const state = {
    catalog: [],
    families: new Map(), // family -> [curves]
    selectedCurve: null,
    rows: [],
    observations: [],
    chart: null
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    byId('measureDate').value = todayIso();

    try {
      state.catalog = await GrowthData.loadCatalog();
      groupFamilies();
      populateFamilySelect();
      populateSourceSelect();
      loadSaved(false);
      syncCorrectedAgeVisibility();
      updateAgeReadout();
      await render();
    } catch (error) {
      showStatus('Catalog load failed');
      showMissingData(`Could not load the curve catalog. ${error.message}`);
    }
  }

  function bindEvents() {
    byId('familySelect').addEventListener('change', () => { populateSourceSelect(); render(); });
    byId('chartSelect').addEventListener('change', render);
    document.querySelectorAll('input[name="sex"]').forEach((el) => el.addEventListener('change', render));
    byId('gestAge').addEventListener('input', () => { syncCorrectedAgeVisibility(); renderChartOnly(); });
    byId('useCorrectedAge').addEventListener('change', renderChartOnly);
    byId('dob').addEventListener('change', () => { recomputeAllAges(); updateAgeReadout(); renderChartOnly(); });
    byId('measureDate').addEventListener('change', updateAgeReadout);
    byId('ageMonths').addEventListener('input', updateAgeReadout);
    byId('measurementForm').addEventListener('submit', addMeasurement);
    byId('clearForm').addEventListener('click', () => clearMeasurementForm(false));
    setupQuickAdd();
    byId('saveAll').addEventListener('click', saveAll);
    byId('loadSaved').addEventListener('click', () => loadSaved(true));
    byId('exportJson').addEventListener('click', exportJson);
    byId('importJson').addEventListener('change', importJson);
    byId('clearAll').addEventListener('click', clearAll);
  }

  /* ---------- Curve catalog / pickers ---------- */

  function groupFamilies() {
    state.families = new Map();
    FAMILY_ORDER.forEach((f) => state.families.set(f, []));
    state.catalog.forEach((curve) => {
      const family = curve.family || 'other';
      if (!state.families.has(family)) state.families.set(family, []);
      state.families.get(family).push(curve);
    });
    // Drop empty families.
    Array.from(state.families.entries()).forEach(([k, v]) => { if (!v.length) state.families.delete(k); });
  }

  function populateFamilySelect() {
    const select = byId('familySelect');
    select.innerHTML = '';
    state.families.forEach((curves, family) => {
      const option = document.createElement('option');
      option.value = family;
      option.textContent = GrowthData.familyLabel(family);
      select.appendChild(option);
    });
  }

  function populateSourceSelect(preferredId) {
    const select = byId('chartSelect');
    const family = byId('familySelect').value;
    const curves = state.families.get(family) || [];
    select.innerHTML = '';
    curves.forEach((curve) => {
      const option = document.createElement('option');
      option.value = curve.id;
      option.textContent = curve.range ? `${curve.sourceLabel} · ${curve.range}` : curve.sourceLabel;
      select.appendChild(option);
    });
    if (preferredId && curves.some((c) => c.id === preferredId)) select.value = preferredId;
  }

  function selectCurveById(id) {
    const curve = state.catalog.find((c) => c.id === id);
    if (!curve) return;
    byId('familySelect').value = curve.family;
    populateSourceSelect(id);
  }

  /* ---------- Rendering ---------- */

  async function render() {
    const curveId = byId('chartSelect').value;
    state.selectedCurve = state.catalog.find((c) => c.id === curveId) || null;
    if (!state.selectedCurve) return;

    const curve = state.selectedCurve;
    byId('chartSubtitle').textContent =
      `${GrowthData.familyLabel(curve.family)} — ${curve.sourceLabel}${curve.range ? ` (${curve.range})` : ''}, ${currentSex()}`;
    byId('valueHeader').textContent = curve.yLabel || 'Value';
    highlightActiveInputs(curve);
    hideMissingData();
    showStatus('Loading curve…');

    try {
      const loaded = await GrowthData.loadCurveRows(curve, currentSex());
      state.rows = loaded.rows;
      showStatus(`${state.rows.length.toLocaleString()} reference rows`);
      renderChartOnly();
    } catch (error) {
      state.rows = [];
      renderChartOnly();
      showStatus('Reference data missing');
      const file = GrowthData.fileForSex(curve, currentSex());
      showMissingData(`Could not load ${file.path}. Run "node scripts/fetch-data.js" and commit the data files. (${error.message})`);
    }
  }

  function renderChartOnly() {
    drawChart();
    const computed = computedRows();
    drawReadout(computed);
    drawTable(computed);
    updatePretermHint();
  }

  // Preterm (postmenstrual-age) charts need a gestational age to place points.
  function updatePretermHint() {
    const curve = state.selectedCurve;
    if (!curve) return;
    const ga = GrowthData.parseGestationalAgeWeeks(byId('gestAge').value);
    if (curve.xUnit === 'weeks' && !Number.isFinite(ga) && state.observations.length) {
      showMissingData('Preterm chart — enter gestational age at birth in the Patient panel to place measurements by postmenstrual age.');
    } else {
      hideMissingData();
    }
  }

  function highlightActiveInputs(curve) {
    document.querySelectorAll('label[data-input]').forEach((l) => l.removeAttribute('data-active'));
    const need = GrowthData.curveInput(curve);
    const map = {
      weight: ['weight'],
      length: ['length'],
      head: ['head'],
      bmi: ['weight', 'length'],
      'weight-length': ['weight', 'length']
    };
    (map[need] || []).forEach((key) => {
      const label = document.querySelector(`label[data-input="${key}"]`);
      if (label) label.setAttribute('data-active', 'true');
    });
  }

  function drawChart() {
    const ctx = byId('growthChart').getContext('2d');
    const curve = state.selectedCurve;
    if (state.chart) state.chart.destroy();
    if (!curve) return;

    const datasets = [];
    const percentileColumns = GrowthData.percentileColumns(state.rows);

    percentileColumns.forEach((column, index) => {
      const pct = Number(GrowthData.normalizePercentileColumn(column).slice(1));
      const isMedian = pct === 50;
      const points = state.rows
        .filter((row) => Number.isFinite(Number(row[column])))
        .map((row) => ({ x: row.chartX, y: Number(row[column]) }));

      datasets.push({
        label: GrowthData.percentileLabel(column),
        pLabel: GrowthData.ordinal(pct),
        labelColor: 'rgba(120, 205, 175, 0.85)',
        data: points,
        parsing: false,
        borderColor: isMedian ? 'rgba(87, 199, 154, 0.95)' : 'rgba(87, 199, 154, 0.32)',
        backgroundColor: 'rgba(87, 199, 154, 0.06)',
        borderWidth: isMedian ? 2.2 : 1,
        borderDash: isMedian ? [] : [4, 4],
        fill: index === 0 ? false : '-1',
        pointRadius: 0,
        tension: 0.25,
        order: 2
      });
    });

    datasets.push({
      label: 'Patient',
      data: patientPlotPoints(),
      parsing: false,
      borderColor: '#f08a5d',
      backgroundColor: '#f08a5d',
      borderWidth: 2.4,
      pointRadius: 4.5,
      pointHoverRadius: 6.5,
      pointBackgroundColor: '#f08a5d',
      pointBorderColor: '#11161d',
      pointBorderWidth: 1.5,
      spanGaps: true,
      tension: 0.1,
      order: 0
    });

    const gridColor = 'rgba(255, 255, 255, 0.06)';
    const tickColor = '#8696a8';
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      layout: { padding: { right: 34, top: 6 } },
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#dde5ef',
            usePointStyle: true,
            filter: (item) => item.text === 'Patient'
          }
        },
        tooltip: {
          callbacks: {
            title: (items) => (items && items.length ? `${curve.xLabel}: ${GrowthData.formatNumber(items[0].parsed.x, 1)}` : ''),
            label: (item) => `${item.dataset.label}: ${GrowthData.formatNumber(item.parsed.y, 2)}`
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: curve.xLabel || 'X', color: tickColor },
          ticks: { color: tickColor },
          grid: { color: gridColor }
        },
        y: {
          title: { display: true, text: curve.yLabel || 'Y', color: tickColor },
          ticks: { color: tickColor },
          grid: { color: gridColor }
        }
      }
    };
    if (Number.isFinite(curve.xMin)) options.scales.x.min = curve.xMin;
    if (Number.isFinite(curve.xMax)) options.scales.x.max = curve.xMax;

    state.chart = new Chart(ctx, { type: 'line', data: { datasets }, options, plugins: [pctLabelPlugin] });
  }

  const pctLabelPlugin = {
    id: 'pctLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((ds, i) => {
        if (!ds.pLabel) return;
        const meta = chart.getDatasetMeta(i);
        if (!meta || meta.hidden || !meta.data || !meta.data.length) return;
        const point = meta.data[meta.data.length - 1];
        if (!point) return;
        ctx.fillStyle = ds.labelColor || ds.borderColor;
        ctx.fillText(ds.pLabel, point.x + 5, point.y);
      });
      ctx.restore();
    }
  };

  function patientPlotPoints() {
    const curve = state.selectedCurve;
    const opts = currentOptions();
    return state.observations
      .map((obs) => {
        const x = GrowthData.xForObservation(obs, curve, opts);
        const y = GrowthData.valueForObservation(obs, curve.metric);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
  }

  /* ---------- Computed rows (table + readout + velocity) ---------- */

  function computedRows() {
    const curve = state.selectedCurve;
    if (!curve) return [];
    const opts = currentOptions();

    const rows = state.observations.map((obs) => {
      const x = GrowthData.xForObservation(obs, curve, opts);
      const y = GrowthData.valueForObservation(obs, curve.metric);
      const lms = Number.isFinite(x) ? GrowthData.interpolateLms(state.rows, x) : null;
      let z = Number.isFinite(y) ? GrowthData.zScoreFromLms(y, lms) : null;
      if (!Number.isFinite(z) && Number.isFinite(x) && Number.isFinite(y)) {
        z = GrowthData.zByPercentileInterp(state.rows, x, y); // percentile-only refs (IG, China)
      }
      const pct = Number.isFinite(z) ? GrowthData.normalCdf(z) * 100 : null;
      return { obs, x, y, z, pct, age: numberOrNull(obs.ageMonths), measureDate: obs.measureDate };
    });

    rows.sort((a, b) => sortKey(a) - sortKey(b));

    // Growth velocity vs the previous valued visit (per month) + z trend.
    let prev = null;
    rows.forEach((r) => {
      r.velocity = null;
      r.dz = null;
      if (Number.isFinite(r.y) && Number.isFinite(r.age) && prev) {
        const dt = r.age - prev.age;
        if (dt > 0.01) {
          r.velocity = (r.y - prev.y) / dt;
          if (Number.isFinite(r.z) && Number.isFinite(prev.z)) r.dz = r.z - prev.z;
        }
      }
      if (Number.isFinite(r.y) && Number.isFinite(r.age)) prev = r;
    });

    return rows;
  }

  function sortKey(r) {
    if (Number.isFinite(r.age)) return r.age;
    if (r.measureDate) return new Date(`${r.measureDate}T00:00:00`).getTime() / 2.6e9;
    return Number.MAX_SAFE_INTEGER;
  }

  function drawReadout(rows) {
    const box = byId('readout');
    const curve = state.selectedCurve;
    const valued = rows.filter((r) => Number.isFinite(r.y) && Number.isFinite(r.pct));
    if (!curve || !valued.length) { box.hidden = true; box.innerHTML = ''; return; }

    const latest = valued[valued.length - 1];
    const unit = unitFromLabel(curve.yLabel);
    const stats = [];

    stats.push(stat('Latest measurement',
      `${GrowthData.formatNumber(latest.y, 2)}<span class="sub"> ${unit}</span>`,
      latest.measureDate ? latest.measureDate : (Number.isFinite(latest.age) ? formatAge(latest.age) : ''), true));

    stats.push(stat('Percentile', GrowthData.percentileText(latest.pct),
      `z = ${signed(latest.z, 2)}`));

    if (Number.isFinite(latest.velocity)) {
      const trend = latest.dz;
      const arrow = !Number.isFinite(trend) ? '' :
        trend > 0.1 ? ' <span class="trend-up">▲ gaining</span>' :
        trend < -0.1 ? ' <span class="trend-down">▼ dropping</span>' : ' steady';
      stats.push(stat('Velocity',
        `${signed(latest.velocity, 2)}<span class="sub"> ${unit}/mo</span>`, `Δz ${signed(trend, 2)}${arrow}`));
    }

    box.innerHTML = stats.join('');
    box.hidden = false;
  }

  function stat(key, value, sub, accent) {
    return `<div class="stat${accent ? ' accent' : ''}"><span class="k">${escapeHtml(key)}</span>` +
      `<span class="v">${value}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  }

  function drawTable(rows) {
    const tbody = byId('measurementsTable').querySelector('tbody');
    const curve = state.selectedCurve;
    tbody.innerHTML = '';
    if (!curve) return;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No measurements yet. Add one above to plot it.</td></tr>';
      return;
    }

    const unit = unitFromLabel(curve.yLabel);
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      let velocityCell = '';
      if (Number.isFinite(r.velocity)) {
        const cls = !Number.isFinite(r.dz) ? '' : r.dz > 0.1 ? 'trend-up' : r.dz < -0.1 ? 'trend-down' : '';
        const arrow = !Number.isFinite(r.dz) ? '' : r.dz > 0.1 ? ' ▲' : r.dz < -0.1 ? ' ▼' : '';
        velocityCell = `<span class="${cls}">${signed(r.velocity, 2)} ${escapeHtml(unit)}/mo${arrow}</span>`;
      }
      tr.innerHTML =
        `<td>${escapeHtml(r.measureDate || '')}</td>` +
        `<td>${Number.isFinite(r.age) ? formatAge(r.age) : ''}</td>` +
        `<td>${Number.isFinite(r.y) ? GrowthData.formatNumber(r.y, 2) : '<span class="muted">—</span>'}</td>` +
        `<td>${Number.isFinite(r.pct) ? GrowthData.percentileText(r.pct) : ''}</td>` +
        `<td>${Number.isFinite(r.z) ? signed(r.z, 2) : ''}</td>` +
        `<td>${velocityCell}</td>` +
        `<td>${escapeHtml(r.obs.note || '')}</td>` +
        `<td><button type="button" class="row-x" data-delete="${r.obs.id}" title="Delete">✕</button></td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.observations = state.observations.filter((o) => o.id !== btn.dataset.delete);
        renderChartOnly();
      });
    });
  }

  /* ---------- Measurement entry ---------- */

  function addMeasurement(event) {
    event.preventDefault();
    const dob = byId('dob').value;
    const measureDate = byId('measureDate').value;
    let ageMonths = numericValue('ageMonths');
    if (!Number.isFinite(ageMonths)) ageMonths = GrowthData.calculateAgeMonths(dob, measureDate);

    const obs = {
      id: uid(),
      measureDate,
      ageMonths: Number.isFinite(ageMonths) ? ageMonths : null,
      weightKg: numericValue('weightKg'),
      lengthCm: numericValue('lengthCm'),
      headCm: numericValue('headCm'),
      note: byId('note').value.trim()
    };

    if (!Number.isFinite(obs.ageMonths)) {
      showMissingData('Enter a date of birth + measurement date, or an age in months.');
      return;
    }
    if (![obs.weightKg, obs.lengthCm, obs.headCm].some(Number.isFinite)) {
      showMissingData('Enter at least one value: weight, length/height, or head circumference.');
      return;
    }

    hideMissingData();
    state.observations.push(obs);
    clearMeasurementForm(true);
    renderChartOnly();
    showStatus('Measurement added');
    byId(firstNeededField()).focus();
  }

  /* ---------- Quick-add grid (under the chart) ---------- */

  const QA_LABELS = { weight: 'Weight', height: 'Height', head: 'Head circ' };
  const QA_FIELD = { weight: 'weightKg', height: 'lengthCm', head: 'headCm' };

  function setupQuickAdd() {
    byId('qaDate').value = todayIso();
    const metric = byId('qaMetric');
    const value = byId('qaValue');
    metric.addEventListener('keydown', onQuickMetricKeydown);
    metric.addEventListener('click', cycleQuickMetric);
    [byId('qaDate'), value].forEach((el) => el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitQuickAdd(); }
    }));
  }

  function onQuickMetricKeydown(event) {
    const map = { h: 'height', w: 'weight', c: 'head' };
    const key = event.key.toLowerCase();
    if (map[key]) { event.preventDefault(); setQuickMetric(map[key]); byId('qaValue').focus(); return; }
    if (event.key === 'Enter') { event.preventDefault(); commitQuickAdd(); return; }
    if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); clearQuickMetric(); }
  }

  function setQuickMetric(metric) {
    const el = byId('qaMetric');
    el.dataset.metric = metric;
    el.value = QA_LABELS[metric];
    el.classList.add('is-set');
  }

  function clearQuickMetric() {
    const el = byId('qaMetric');
    delete el.dataset.metric;
    el.value = '';
    el.classList.remove('is-set');
  }

  function cycleQuickMetric() {
    const order = ['weight', 'height', 'head'];
    const next = order[(order.indexOf(byId('qaMetric').dataset.metric) + 1) % order.length];
    setQuickMetric(next);
  }

  function commitQuickAdd() {
    const metric = byId('qaMetric').dataset.metric;
    const date = byId('qaDate').value;
    const raw = byId('qaValue').value.trim();
    const value = Number(raw);

    if (!metric) { byId('qaMetric').focus(); showStatus('Pick a metric — type h, w, or c'); return; }
    if (!raw || !Number.isFinite(value) || value <= 0) { byId('qaValue').focus(); showStatus('Enter a value'); return; }

    const age = GrowthData.calculateAgeMonths(byId('dob').value, date);
    const obs = { id: uid(), measureDate: date, ageMonths: Number.isFinite(age) ? age : null, weightKg: null, lengthCm: null, headCm: null, note: '' };
    obs[QA_FIELD[metric]] = value;
    state.observations.push(obs);

    renderChartOnly();
    byId('qaValue').value = '';
    clearQuickMetric();
    byId('qaMetric').focus();
    showStatus(`Added ${QA_LABELS[metric].toLowerCase()} ${GrowthData.formatNumber(value, 2)}`);
    if (!Number.isFinite(age) && state.selectedCurve && state.selectedCurve.xUnit !== 'weeks') {
      showMissingData('Tip: set a date of birth in the Patient panel so quick-added points land on the chart.');
    }
  }

  function firstNeededField() {
    const need = GrowthData.curveInput(state.selectedCurve);
    if (need === 'length') return 'lengthCm';
    if (need === 'head') return 'headCm';
    return 'weightKg';
  }

  function clearMeasurementForm(keepDate) {
    ['ageMonths', 'weightKg', 'lengthCm', 'headCm', 'note'].forEach((id) => { byId(id).value = ''; });
    if (!keepDate) byId('measureDate').value = '';
    updateAgeReadout();
  }

  function updateAgeReadout() {
    const out = byId('ageReadout');
    const manual = numericValue('ageMonths');
    if (Number.isFinite(manual)) { out.textContent = `Age: ${formatAge(manual)}`; return; }
    const age = GrowthData.calculateAgeMonths(byId('dob').value, byId('measureDate').value);
    out.textContent = Number.isFinite(age) ? `Age at this date: ${formatAge(age)}` : '';
  }

  function recomputeAllAges() {
    const dob = byId('dob').value;
    if (!dob) return;
    state.observations.forEach((obs) => {
      if (obs.measureDate) {
        const age = GrowthData.calculateAgeMonths(dob, obs.measureDate);
        if (Number.isFinite(age)) obs.ageMonths = age;
      }
    });
  }

  function syncCorrectedAgeVisibility() {
    const ga = GrowthData.parseGestationalAgeWeeks(byId('gestAge').value);
    const show = Number.isFinite(ga) && ga < 37;
    byId('correctedAgeLine').hidden = !show;
    if (!show) byId('useCorrectedAge').checked = false;
  }

  /* ---------- Persistence ---------- */

  function collectPayload() {
    return {
      version: 2,
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
    if (payload.sex) {
      const radio = document.querySelector(`input[name="sex"][value="${payload.sex}"]`);
      if (radio) radio.checked = true;
    }
    byId('patientLabel').value = payload.patientLabel || '';
    byId('dob').value = payload.dob || '';
    byId('gestAge').value = payload.gestAge || '';
    byId('useCorrectedAge').checked = Boolean(payload.useCorrectedAge);
    state.observations = Array.isArray(payload.observations) ? payload.observations : [];
    if (payload.curveId) selectCurveById(payload.curveId);
    syncCorrectedAgeVisibility();
  }

  function saveAll() {
    localStorage.setItem(GrowthData.storageKey(), JSON.stringify(collectPayload()));
    showStatus('Saved to this browser');
  }

  function loadSaved(announce) {
    const raw = localStorage.getItem(GrowthData.storageKey());
    if (!raw) { if (announce) showStatus('No saved data found'); return; }
    try {
      applyPayload(JSON.parse(raw));
      if (announce) { render(); showStatus('Loaded saved data'); }
    } catch (error) {
      showStatus('Saved data unreadable');
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(collectPayload(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `growth-data-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      applyPayload(JSON.parse(await file.text()));
      await render();
      showStatus('Imported JSON');
    } catch (error) {
      showMissingData(`Could not import JSON. ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }

  function clearAll() {
    if (!confirm('Clear all measurements and saved data in this browser?')) return;
    state.observations = [];
    localStorage.removeItem(GrowthData.storageKey());
    renderChartOnly();
    showStatus('Cleared');
  }

  /* ---------- Small helpers ---------- */

  function currentSex() { return document.querySelector('input[name="sex"]:checked').value; }
  function currentOptions() {
    return { gestAge: byId('gestAge').value, useCorrectedAge: byId('useCorrectedAge').checked };
  }

  function numericValue(id) {
    const v = Number(byId(id).value);
    return byId(id).value.trim() !== '' && Number.isFinite(v) ? v : null;
  }
  function numberOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

  function formatAge(months) {
    if (!Number.isFinite(months)) return '';
    if (months < 24) return `${GrowthData.formatNumber(months, 1)} mo`;
    return `${GrowthData.formatNumber(months / 12, 1)} yr`;
  }

  function signed(value, digits) {
    if (!Number.isFinite(value)) return '';
    const s = GrowthData.formatNumber(Math.abs(value), digits);
    return (value >= 0 ? '+' : '−') + s;
  }

  function unitFromLabel(label) {
    const m = String(label || '').match(/\(([^)]+)\)/);
    return m ? m[1] : '';
  }

  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()); }

  function showMissingData(message) {
    const box = byId('missingDataBox');
    box.textContent = message;
    box.classList.remove('hidden');
  }
  function hideMissingData() { byId('missingDataBox').classList.add('hidden'); }
  function showStatus(message) { byId('status').textContent = message; }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function byId(id) { return document.getElementById(id); }
}());
