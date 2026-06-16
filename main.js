const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// ── Embedded EPC API credentials (prototype) ──────────────────────────────────
const EPC_EMAIL   = 'happydragon.cbd@gmail.com';
const EPC_API_KEY = 'dNqSi3seHCeTsdh2SH84UQ3RB4y8fLfeibK1UjRLVjihXyseykw2B9NYuOcMxZYO';

// ── Session state ─────────────────────────────────────────────────────────────
let currentSession = null;
let loginWindow    = null;
let mainWindow     = null;

// ── User management ───────────────────────────────────────────────────────────
const DEFAULT_USERS = [
  {
    username:   'admin',
    password:   'Aira2025!',
    name:       'Administrator',
    expiryDate: '2026-12-31'
  }
];

function getUsersPath() {
  return path.join(app.getPath('userData'), 'users.json');
}

function getUsers() {
  try {
    const p = getUsersPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return DEFAULT_USERS;
}

function saveUsers(users) {
  fs.writeFileSync(getUsersPath(), JSON.stringify(users, null, 2));
}

// Initialise users file on first run
function initUsers() {
  if (!fs.existsSync(getUsersPath())) saveUsers(DEFAULT_USERS);
}

// ── Config (non-credential settings) ─────────────────────────────────────────
const configPath = path.join(app.getPath('userData'), 'aira-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {}
  return {};
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

// ── Windows ───────────────────────────────────────────────────────────────────
function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 420,
    height: 600,
    resizable: false,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Aira Heat Loss Calculator — Login',
    backgroundColor: '#3B0764',
    autoHideMenuBar: true
  });
  loginWindow.loadFile('login.html');
  loginWindow.on('closed', () => { loginWindow = null; });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Aira Heat Loss Calculator',
    backgroundColor: '#3B0764',
    autoHideMenuBar: true
  });

  // App menu with Settings stub
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Logout', click: () => mainWindow.webContents.send('logout') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Manage Users…',
          click: () => {
            const p = getUsersPath();
            if (!fs.existsSync(p)) saveUsers(getUsers());
            shell.openPath(p);
          }
        },
        { type: 'separator' },
        { label: 'API Keys (coming soon)', enabled: false }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Visit Aira', click: () => shell.openExternal('https://aira.com') }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key === 'I')))
      mainWindow.webContents.toggleDevTools();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  initUsers();
  createLoginWindow();
  app.on('activate', () => {
    if (!loginWindow && !mainWindow) createLoginWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC — Auth ────────────────────────────────────────────────────────────────
ipcMain.handle('login', (event, { username, password }) => {
  const users = getUsers();
  const user  = users.find(
    u => u.username.toLowerCase() === username.toLowerCase().trim() &&
         u.password === password
  );

  if (!user) return { success: false, error: 'Invalid username or password.' };

  const expiry  = new Date(user.expiryDate + 'T23:59:59');
  const now     = new Date();

  if (now > expiry) {
    const over = Math.ceil((now - expiry) / 86400000);
    return {
      success: false,
      error: `Licence expired ${over} day${over !== 1 ? 's' : ''} ago. Please contact Aira to renew.`
    };
  }

  const daysLeft = Math.ceil((expiry - now) / 86400000);
  currentSession = { username: user.username, name: user.name || user.username, expiryDate: user.expiryDate, daysLeft };

  // Open main window after short delay so success animation can play
  setTimeout(() => {
    createMainWindow();
    if (loginWindow) loginWindow.close();
  }, 600);

  return { success: true, ...currentSession };
});

ipcMain.handle('get-session', () => currentSession);

ipcMain.handle('logout', () => {
  currentSession = null;
  createLoginWindow();
  if (mainWindow) mainWindow.close();
});

// ── IPC — Config ──────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => {
  const saved = loadConfig();
  return {
    // Embedded credentials — no user input required
    email:  EPC_EMAIL,
    apiKey: EPC_API_KEY,
    ...saved
  };
});

ipcMain.handle('save-config', (event, cfg) => { saveConfig(cfg); return true; });

ipcMain.handle('open-external', (event, url) => shell.openExternal(url));

// ── IPC — EPC API ─────────────────────────────────────────────────────────────
function epcRequest(options, auth, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('Too many redirects')); return; }

    const req = https.request(options, (res) => {
      // Follow redirects (301/302)
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (!loc) { reject(new Error('Redirect with no location')); return; }
        const url = new URL(loc, `https://${options.hostname}`);
        resolve(epcRequest({
          hostname: url.hostname,
          path:     url.pathname + url.search,
          method:   'GET',
          headers:  { Authorization: `Basic ${auth}`, Accept: 'application/json' }
        }, auth, redirects + 1));
        return;
      }

      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid EPC API response')); }
        } else if (res.statusCode === 401) {
          reject(new Error('Invalid API credentials — check your EPC account.'));
        } else if (res.statusCode === 404) {
          resolve({ rows: [] });
        } else {
          reject(new Error(`EPC API returned status ${res.statusCode}`));
        }
      });
    });

    req.on('error', err => reject(new Error(`Network error: ${err.message}`)));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out.')); });
    req.end();
  });
}

ipcMain.handle('fetch-epc', async (event, { postcode }) => {
  const clean = postcode.replace(/\s+/g, '').toUpperCase();

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.get-energy-performance-data.communities.gov.uk',
      path:     `/api/domestic/search?postcode=${encodeURIComponent(clean)}&page_size=10`,
      method:   'GET',
      headers:  { Authorization: `Bearer ${EPC_API_KEY}`, Accept: 'application/json' }
    }, (res) => {
      if (res.statusCode === 401) { resolve({ rows: [], error: 'Invalid EPC API token.' }); return; }
      if (res.statusCode === 404) { resolve({ rows: [] }); return; }

      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve({ rows: [], error: `EPC API returned status ${res.statusCode}` });
          return;
        }
        try {
          const json = JSON.parse(data);
          // Write raw first record to file so field names can be confirmed
          try {
            const debugPath = path.join(app.getPath('userData'), 'epc-raw-debug.json');
            fs.writeFileSync(debugPath, JSON.stringify(json.data && json.data[0], null, 2));
          } catch (_) {}
          // Map new MHCLG API camelCase fields to kebab-case names the heat loss engine expects
          const rows = (json.data || []).map(r => ({
            'address1':                  r.addressLine1 || '',
            'address2':                  r.addressLine2 || '',
            'address3':                  [r.addressLine3, r.addressLine4].filter(Boolean).join(', '),
            'posttown':                  r.postTown || '',
            'postcode':                  r.postcode || '',
            'inspection-date':           r.inspectionDate || '',
            'current-energy-rating':     r.currentEnergyEfficiencyBand || '',
            'current-energy-efficiency': String(r.currentEnergyEfficiencyRating ?? ''),
            'potential-energy-rating':   r.potentialEnergyEfficiencyBand || '',
            'total-floor-area':          String(r.totalFloorArea ?? ''),
            'property-type':             r.propertyType || '',
            'built-form':                r.builtForm || '',
            'construction-age-band':     r.constructionAgeBand || '',
            'number-habitable-rooms':    String(r.habitableRooms ?? r.numberHabitableRooms ?? ''),
            'flat-storey-count':         String(r.flatStoreyCount ?? ''),
            'floor-height':              String(r.floorHeight ?? ''),
            'mechanical-ventilation':    r.mechanicalVentilation || '',
            'number-open-fireplaces':    String(r.openFireplacesCount ?? r.numberOpenFireplaces ?? ''),
            'multi-glaze-proportion':    String(r.multiGlazedProportion ?? r.glazedProportion ?? ''),
            'glazed-type':               r.glazedType || '',
            'glazed-area':               r.glazedArea || '',
            'walls-description':         r.wallsDescription || r.wallsEnvDescription || '',
            'roof-description':          r.roofDescription || r.roofEnvDescription || '',
            'floor-description':         r.floorDescription || r.floorEnvDescription || '',
            'windows-description':       r.windowsDescription || r.windowsEnvDescription || '',
          }));
          resolve({ rows, _raw: json.data && json.data[0] });
        } catch { resolve({ rows: [], error: 'Invalid EPC API response' }); }
      });
    });

    req.on('error', err => resolve({ rows: [], error: `Network error: ${err.message}` }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ rows: [], error: 'Request timed out.' }); });
    req.end();
  });
});
