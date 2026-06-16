# Aira Heat Loss Calculator — Project State

## What this is
Electron desktop app (Windows .exe) that fetches EPC data by postcode and calculates heat loss / heat pump sizing. Branded for Aira (purple, `#3B0764`).

## Current branch
`claude/heatloss-calculator-recovery-1648rt`

## Build & run
```bash
npm start          # run in dev
npm run dist       # build Windows .exe installer (via electron-builder)
```
GitHub Actions auto-builds the .exe on every push to this branch (`.github/workflows/build.yml`).

## Login credentials (hardcoded in app)
- Username: `admin` / Password: `Aira2025!`
- Expiry: 2026-12-31
- Users stored in `%APPDATA%\aira-heatloss-calculator\users.json`

## EPC API — CRITICAL KNOWN ISSUE
The old EPC API (`epc.opendatacommunities.org`) was **retired 30 May 2026**.

The new API is `api.get-energy-performance-data.communities.gov.uk` with Bearer token auth.

**EPC API key** (embedded in `main.js`):
```
dNqSi3seHCeTsdh2SH84UQ3RB4y8fLfeibK1UjRLVjihXyseykw2B9NYuOcMxZYO
```

### What works
- Search endpoint: `GET /api/domestic/search?postcode={PC}&page_size=10`
  Returns: `certificateNumber`, `addressLine1`–4, `postTown`, `postcode`, `currentEnergyEfficiencyBand`, `registrationDate`, `uprn`, `council`, `constituency`, `schemaType` — **summary only**

### What does NOT work
- Detail endpoint: `GET /api/domestic/{certificateNumber}` → **returns 404**
- Alternative formats tried and also failing:
  - `/api/domestic/certificate/{certNumber}`
  - `/api/domestic/property?uprn={uprn}`
- The new API appears to have **no working detail endpoint** — only summary search data is available

### Workaround implemented (commit `dc8a5b4`)
Step 4 now has editable **manual input fields** for Floor Area, Property Type, Built Form, Age Band. These:
- Pre-fill from EPC API data if it ever returns detail fields
- Link to `find-energy-certificate.service.gov.uk` so user can look up values
- Are required before calculation runs
- Override EPC data in the heat loss engine

## Architecture
```
main.js          — Electron main process: auth IPC, EPC API fetch, config
preload.js       — Context bridge (electronAPI object)
src/renderer.js  — UI controller
src/heatloss.js  — Heat loss engine (EN 12831 simplified)
src/styles.css   — Purple Aira theme
index.html       — Main app UI (Steps 1–5)
login.html       — Login screen
src/login.js     — Login screen JS
```

## Key IPC handlers (main.js)
| Handler | Purpose |
|---|---|
| `login` | Validates username/password, checks expiry |
| `get-session` | Returns current session info |
| `logout` | Clears session, reopens login |
| `get-config` | Returns embedded EPC credentials + saved config |
| `save-config` | Persists non-credential settings |
| `fetch-epc` | Calls new MHCLG EPC API (search + attempts detail) |
| `open-external` | Opens URL in system browser |

## Heat loss engine (src/heatloss.js)
Uses these EPC field names (kebab-case):
- `total-floor-area`, `property-type`, `built-form`, `construction-age-band`
- `walls-description`, `roof-description`, `floor-description`, `windows-description`
- `number-habitable-rooms`, `flat-storey-count`, `floor-height`
- `mechanical-ventilation`, `number-open-fireplaces`
- `multi-glaze-proportion`, `glazed-type`, `glazed-area`

Public API: `HeatLoss.calculate(epcData, { outdoorTemp, indoorTemp, ach })`

## What still needs doing
1. **Find correct EPC detail endpoint** — if MHCLG publishes a working detail URL, update `main.js` `fetch-epc` handler. Current attempts are at lines ~285–310.
2. **Remove debug code** — once field mapping is confirmed, remove `_debugInfo`, `epc-raw-debug.json` writes, and verbose console.logs from `main.js` and `renderer.js`.
3. **Real Aira logo** — replace SVG placeholder in `index.html` line 17–22 with actual asset.
4. **Settings menu** — "API Keys (coming soon)" stub in the File menu (`main.js` line 119) is disabled.

## File locations on user's Windows machine
- App data: `%APPDATA%\aira-heatloss-calculator\`
- Users file: `%APPDATA%\aira-heatloss-calculator\users.json`
- Config: `%APPDATA%\aira-heatloss-calculator\aira-config.json`
- EPC debug dump: `%APPDATA%\aira-heatloss-calculator\epc-raw-debug.json`
- Renderer console log: `%APPDATA%\aira-heatloss-calculator\renderer-console.log` *(not yet — CC pattern, not implemented here)*
