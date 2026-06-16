const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

let mainWindow;
const configPath = path.join(app.getPath('userData'), 'aira-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Aira Heat Loss Calculator',
    backgroundColor: '#3B0764'
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-config', (event, config) => {
  saveConfig(config);
  return true;
});

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('fetch-epc', async (event, { postcode, email, apiKey }) => {
  return new Promise((resolve, reject) => {
    const clean = postcode.replace(/\s+/g, '').toUpperCase();
    const auth = Buffer.from(`${email}:${apiKey}`).toString('base64');

    const options = {
      hostname: 'epc.opendatacommunities.org',
      path: `/api/v1/domestic/search?postcode=${encodeURIComponent(clean)}&size=10`,
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid response from EPC API'));
          }
        } else if (res.statusCode === 401) {
          reject(new Error('Invalid API credentials — check your email and API key.'));
        } else if (res.statusCode === 400) {
          reject(new Error('Invalid postcode format.'));
        } else if (res.statusCode === 404) {
          resolve({ rows: [] });
        } else {
          reject(new Error(`EPC API returned status ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Network error: ${err.message}`)));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timed out — check your internet connection.'));
    });
    req.end();
  });
});
