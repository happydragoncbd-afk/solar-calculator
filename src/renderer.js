/* global HeatLoss, electronAPI */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let config = {};
let epcRecords = [];
let selectedRecord = null;

// ── DOM helpers ───────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function setText(id, text) { $(id).textContent = text; }

function setAlert(id, type, message) {
  const el = $(id);
  el.className = `alert alert-${type}`;
  el.textContent = message;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  config = await electronAPI.getConfig();
  updateSettingsStatus();

  // If already configured, collapse settings
  if (config.email && config.apiKey) {
    $('settingsCard').classList.add('collapsed');
  }

  bindEvents();
}

function updateSettingsStatus() {
  const badge = $('settingsStatus');
  if (config.email && config.apiKey) {
    badge.textContent = 'Configured';
    badge.className = 'status-badge configured';
  } else {
    badge.textContent = 'Not configured';
    badge.className = 'status-badge unconfigured';
  }
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents() {
  // Settings toggle
  $('settingsToggle').addEventListener('click', () => {
    const card = $('settingsCard');
    const isCollapsed = card.classList.toggle('collapsed');
    $('settingsToggle').textContent = isCollapsed ? 'Edit' : 'Hide';
  });

  // Pre-fill saved credentials
  if (config.email) $('apiEmail').value = config.email;
  if (config.apiKey) $('apiKey').value = config.apiKey;

  $('saveSettingsBtn').addEventListener('click', saveSettings);
  $('searchBtn').addEventListener('click', doSearch);
  $('propertySelect').addEventListener('change', onPropertyChange);
  $('calcBtn').addEventListener('click', doCalculate);
  $('ctaBtn').addEventListener('click', () => electronAPI.openExternal('https://aira.com'));
  $('epcRegisterLink').addEventListener('click', (e) => {
    e.preventDefault();
    electronAPI.openExternal('https://epc.opendatacommunities.org/');
  });

  $('postcodeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function saveSettings() {
  const email = $('apiEmail').value.trim();
  const apiKey = $('apiKey').value.trim();

  if (!email || !apiKey) {
    alert('Please enter both your email and API key.');
    return;
  }

  config = { ...config, email, apiKey };
  await electronAPI.saveConfig(config);
  updateSettingsStatus();

  show('settingsSaved');
  setTimeout(() => hide('settingsSaved'), 2000);

  $('settingsCard').classList.add('collapsed');
  $('settingsToggle').textContent = 'Edit';
}

// ── EPC Search ────────────────────────────────────────────────────────────────
async function doSearch() {
  const postcode = $('postcodeInput').value.trim();
  if (!postcode) return;

  if (!config.email || !config.apiKey) {
    setAlert('searchAlert', 'error', 'Please configure your EPC API credentials first (Step 1).');
    show('searchAlert');
    $('settingsCard').classList.remove('collapsed');
    $('settingsToggle').textContent = 'Hide';
    return;
  }

  // Loading state
  $('searchBtn').disabled = true;
  setText('searchBtnText', 'Searching…');
  show('searchSpinner');
  hide('searchAlert');
  hide('epcCard');
  hide('calcCard');
  hide('resultsCard');

  try {
    const data = await electronAPI.fetchEPC({
      postcode,
      email: config.email,
      apiKey: config.apiKey
    });

    const rows = data.rows || [];

    if (rows.length === 0) {
      setAlert('searchAlert', 'error', `No EPC records found for postcode "${postcode.toUpperCase()}". The property may not have a current EPC.`);
      show('searchAlert');
      return;
    }

    epcRecords = rows;
    renderPropertySelect(rows);
    show('epcCard');
    $('epcCount').textContent = `${rows.length} record${rows.length > 1 ? 's' : ''} found`;
    onPropertyChange();

  } catch (err) {
    setAlert('searchAlert', 'error', err.message);
    show('searchAlert');
  } finally {
    $('searchBtn').disabled = false;
    setText('searchBtnText', 'Search EPC');
    hide('searchSpinner');
  }
}

// ── Property Selector ─────────────────────────────────────────────────────────
function renderPropertySelect(records) {
  const sel = $('propertySelect');
  sel.innerHTML = '';

  records.forEach((r, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    const addr = [r['address1'], r['address2'], r['address3']].filter(Boolean).join(', ');
    const date = r['inspection-date'] || '';
    opt.textContent = `${addr} (EPC: ${date})`;
    sel.appendChild(opt);
  });

  const wrap = $('propertySelectWrap');
  wrap.style.display = records.length > 1 ? 'flex' : 'none';
}

function onPropertyChange() {
  const idx = parseInt($('propertySelect').value) || 0;
  selectedRecord = epcRecords[idx];
  renderEPCSummary(selectedRecord);
  show('calcCard');
  hide('resultsCard');
}

// ── EPC Summary Cards ─────────────────────────────────────────────────────────
function ratingColor(r) {
  return { A:'rating-a', B:'rating-b', C:'rating-c', D:'rating-d', E:'rating-e', F:'rating-f', G:'rating-g' }[r] || '';
}

function renderEPCSummary(r) {
  const rating = (r['current-energy-rating'] || '?').toUpperCase();
  const grid = $('epcStatGrid');

  grid.innerHTML = `
    <div class="epc-stat">
      <div class="epc-stat-label">EPC Rating</div>
      <div class="epc-rating ${ratingColor(rating)}">${rating}</div>
    </div>
    <div class="epc-stat">
      <div class="epc-stat-label">Floor Area</div>
      <div class="epc-stat-value">${r['total-floor-area'] || '?'} m²</div>
    </div>
    <div class="epc-stat">
      <div class="epc-stat-label">Property Type</div>
      <div class="epc-stat-value">${r['property-type'] || '?'}</div>
    </div>
    <div class="epc-stat">
      <div class="epc-stat-label">Built Form</div>
      <div class="epc-stat-value">${r['built-form'] || '?'}</div>
    </div>
    <div class="epc-stat">
      <div class="epc-stat-label">Age Band</div>
      <div class="epc-stat-value">${formatAgeBand(r['construction-age-band'])}</div>
    </div>
    <div class="epc-stat">
      <div class="epc-stat-label">Habitable Rooms</div>
      <div class="epc-stat-value">${r['number-habitable-rooms'] || '?'}</div>
    </div>
  `;

  const detail = $('epcDetailRow');
  detail.innerHTML = `
    <div class="epc-detail-item"><strong>Walls</strong>${r['walls-description'] || 'Not recorded'}</div>
    <div class="epc-detail-item"><strong>Roof</strong>${r['roof-description'] || 'Not recorded'}</div>
    <div class="epc-detail-item"><strong>Floor</strong>${r['floor-description'] || 'Not recorded'}</div>
    <div class="epc-detail-item"><strong>Windows</strong>${r['windows-description'] || 'Not recorded'}</div>
  `;
}

function formatAgeBand(raw) {
  if (!raw) return '?';
  // EPC age bands come as "England and Wales: 1967-1975, Scotland: N/A"
  const match = raw.match(/(\d{4}(?:-\d{4})?)/);
  if (match) return match[1];
  if (raw.toLowerCase().includes('before 1900') || raw.includes('1900')) return 'Pre-1900';
  return raw.length > 20 ? raw.substring(0, 20) + '…' : raw;
}

// ── Heat Loss Calculation ─────────────────────────────────────────────────────
function doCalculate() {
  if (!selectedRecord) return;

  const outdoorTemp = parseFloat($('outdoorTemp').value) || -3;
  const indoorTemp  = parseFloat($('indoorTemp').value)  || 21;
  const ach         = parseFloat($('achInput').value)    || 0.5;

  const result = HeatLoss.calculate(selectedRecord, { outdoorTemp, indoorTemp, ach });
  renderResults(result);
  show('resultsCard');

  // Smooth scroll to results
  $('resultsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderResults(r) {
  // Hero values
  setText('resHeatLoss', `${r.heatLossKW.toFixed(1)} kW`);
  setText('resHPSize', `${r.hpSizeKW} kW`);
  setText('resDesignCond', `At ${r.outdoorTemp}°C outdoor / ${r.indoorTemp}°C indoor`);

  // Breakdown table
  const tbody = $('breakdownBody');
  const dT = r.deltaT;
  const c  = r.coefficients;
  const g  = r.geometry;
  const u  = r.uValues;

  const rows = [
    { label: 'Walls',            area: g.netWallArea,      uVal: u.wall,   hlc: c.wall },
    { label: 'Windows / Glazing',area: g.windowArea,       uVal: u.window, hlc: c.window },
    { label: 'Roof',             area: g.roofArea,         uVal: u.roof,   hlc: c.roof },
    { label: 'Ground Floor',     area: g.groundFloorArea,  uVal: u.floor,  hlc: c.floor },
    { label: 'Thermal Bridging', area: null,               uVal: null,     hlc: c.bridging },
    { label: 'Ventilation',      area: null,               uVal: null,     hlc: c.ventilation }
  ];

  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.label}</td>
      <td class="num">${row.area !== null ? row.area.toFixed(1) : '—'}</td>
      <td class="num">${row.uVal !== null ? row.uVal.toFixed(2) : '—'}</td>
      <td class="num">${row.hlc.toFixed(0)}</td>
      <td class="num">${(row.hlc * dT).toFixed(0)}</td>
    </tr>
  `).join('') + `
    <tr>
      <td><strong>Total</strong></td>
      <td class="num">—</td>
      <td class="num">—</td>
      <td class="num"><strong>${c.total.toFixed(0)}</strong></td>
      <td class="num"><strong>${(r.heatLossKW * 1000).toFixed(0)}</strong></td>
    </tr>
  `;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
