/* global HeatLoss, electronAPI */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
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
  // Show session info in header
  const session = await electronAPI.getSession();
  if (session) {
    $('userName').textContent = session.name;
    const exp = new Date(session.expiryDate);
    $('userExpiry').textContent = session.daysLeft <= 30
      ? `⚠ Expires in ${session.daysLeft}d`
      : `Licence valid to ${exp.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}`;
  }

  config = await electronAPI.getConfig();
  // API key is embedded — always configured
  $('settingsCard').classList.add('collapsed');
  $('settingsToggle').textContent = 'Edit';
  updateSettingsStatus();
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
  $('settingsToggle').addEventListener('click', () => {
    const collapsed = $('settingsCard').classList.toggle('collapsed');
    $('settingsToggle').textContent = collapsed ? 'Edit' : 'Hide';
  });

  if (config.email) $('apiEmail').value = config.email;
  if (config.apiKey) $('apiKey').value  = config.apiKey;

  $('saveSettingsBtn').addEventListener('click', saveSettings);
  $('logoutBtn').addEventListener('click', () => electronAPI.logout());
  electronAPI.onLogout(() => electronAPI.logout());
  $('searchBtn').addEventListener('click', doSearch);
  $('propertySelect').addEventListener('change', onPropertyChange);
  $('calcBtn').addEventListener('click', doCalculate);
  $('ctaBtn').addEventListener('click', () => electronAPI.openExternal('https://aira.com'));
  $('epcRegisterLink').addEventListener('click', (e) => {
    e.preventDefault();
    electronAPI.openExternal('https://epc.opendatacommunities.org/');
  });
  $('postcodeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function saveSettings() {
  const email  = $('apiEmail').value.trim();
  const apiKey = $('apiKey').value.trim();
  if (!email || !apiKey) { alert('Please enter both your email and API key.'); return; }

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

  $('searchBtn').disabled = true;
  setText('searchBtnText', 'Searching…');
  show('searchSpinner');
  hide('searchAlert');
  hide('epcCard');
  hide('calcCard');
  hide('resultsCard');

  try {
    const data = await electronAPI.fetchEPC({ postcode, email: config.email, apiKey: config.apiKey });
    console.log('EPC raw first record:', JSON.stringify(data._raw, null, 2));
    const rows = data.rows || [];

    if (rows.length === 0) {
      setAlert('searchAlert', 'error', `No EPC records found for "${postcode.toUpperCase()}". The property may not have a current EPC.`);
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
    opt.textContent = `${addr} (EPC: ${r['inspection-date'] || '?'})`;
    sel.appendChild(opt);
  });
  $('propertySelectWrap').style.display = records.length > 1 ? 'flex' : 'none';
}

function onPropertyChange() {
  const idx = parseInt($('propertySelect').value) || 0;
  selectedRecord = epcRecords[idx];
  renderEPCSummary(selectedRecord);

  // Auto-calculate ACH from age band and populate the field
  const autoACH = HeatLoss.calcBaselineACH(
    selectedRecord['construction-age-band'],
    selectedRecord['mechanical-ventilation'],
    selectedRecord['number-open-fireplaces']
  );
  $('achInput').value = autoACH.toFixed(2);
  $('achHint').textContent = `Auto-estimated from ${formatAgeBand(selectedRecord['construction-age-band'])} age band — adjust if known`;

  show('calcCard');
  hide('resultsCard');
}

// ── EPC Summary ───────────────────────────────────────────────────────────────
const RATING_CLASS = { A:'rating-a', B:'rating-b', C:'rating-c', D:'rating-d', E:'rating-e', F:'rating-f', G:'rating-g' };

function renderEPCSummary(r) {
  const rating = (r['current-energy-rating'] || '?').toUpperCase();

  $('epcStatGrid').innerHTML = `
    <div class="epc-stat">
      <div class="epc-stat-label">EPC Rating</div>
      <div class="epc-rating ${RATING_CLASS[rating] || ''}">${rating}</div>
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

  $('epcDetailRow').innerHTML = `
    <div class="epc-detail-item"><strong>Walls</strong>${r['walls-description'] || 'Not recorded'}</div>
    <div class="epc-detail-item"><strong>Roof</strong>${r['roof-description'] || 'Not recorded'}</div>
    <div class="epc-detail-item"><strong>Floor</strong>${r['floor-description'] || 'Not recorded'}</div>
    <div class="epc-detail-item"><strong>Windows</strong>${r['windows-description'] || '?'}${r['multi-glaze-proportion'] ? ` — ${r['multi-glaze-proportion']}% double glazed` : ''}</div>
  `;
}

function formatAgeBand(raw) {
  if (!raw) return '?';
  const m = raw.match(/(\d{4}(?:[-–]\d{4})?)/);
  if (m) return m[1];
  if (raw.toLowerCase().includes('before 1900')) return 'Pre-1900';
  return raw.length > 20 ? raw.substring(0, 20) + '…' : raw;
}

// ── Calculation ───────────────────────────────────────────────────────────────
function doCalculate() {
  if (!selectedRecord) return;

  const result = HeatLoss.calculate(selectedRecord, {
    outdoorTemp: parseFloat($('outdoorTemp').value) || -3,
    indoorTemp:  parseFloat($('indoorTemp').value)  || 21,
    ach:         parseFloat($('achInput').value)    || 0.5
  });

  renderResults(result);
  show('resultsCard');
  $('resultsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderResults(r) {
  setText('resHeatLoss', `${r.heatLossKW.toFixed(1)} kW`);
  setText('resHPSize',   `${r.hpSizeKW} kW`);
  setText('resDesignCond', `At ${r.outdoorTemp}°C outdoor / ${r.indoorTemp}°C indoor`);

  // Data quality chips
  const dq = r.dataQuality;
  const chips = [
    dq.multiGlazeProportion ? 'Glazing %' : null,
    dq.floorHeight          ? 'Floor height' : null,
    dq.mechanicalVent       ? 'Mech. vent' : null,
    dq.habRooms             ? 'Room count' : null,
    dq.openFireplaces       ? 'Fireplaces' : null
  ].filter(Boolean);

  const dqEl = $('dataQuality');
  if (chips.length > 0) {
    dqEl.innerHTML = `<span class="dq-label">Extra EPC data used:</span> ` +
      chips.map(c => `<span class="dq-chip">${c}</span>`).join('');
    show('dataQuality');
  } else {
    hide('dataQuality');
  }

  const dT = r.deltaT;
  const c  = r.coefficients;
  const g  = r.geometry;
  const u  = r.uValues;

  const rows = [
    { label: 'Walls',             area: g.netWallArea,     uVal: u.wall,   hlc: c.wall },
    { label: 'Windows / Glazing', area: g.windowArea,      uVal: u.window, hlc: c.window },
    { label: 'Roof',              area: g.roofArea,        uVal: u.roof,   hlc: c.roof },
    { label: 'Ground Floor',      area: g.groundFloorArea, uVal: u.floor,  hlc: c.floor },
    { label: 'Thermal Bridging',  area: null,              uVal: null,     hlc: c.bridging },
    { label: `Ventilation (${r.ach} ACH)`, area: null,     uVal: null,     hlc: c.ventilation }
  ];

  $('breakdownBody').innerHTML = rows.map(row => `
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
      <td class="num">—</td><td class="num">—</td>
      <td class="num"><strong>${c.total.toFixed(0)}</strong></td>
      <td class="num"><strong>${(r.heatLossKW * 1000).toFixed(0)}</strong></td>
    </tr>
  `;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
