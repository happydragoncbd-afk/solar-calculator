// Heat loss calculation — simplified EN 12831 using all available EPC fields.

const HeatLoss = (() => {

  // ── Age band helpers ───────────────────────────────────────────────────────

  function ageBandMidYear(raw) {
    if (!raw) return 1975;
    const s = raw.toLowerCase();
    if (s.includes('before 1900') || s.includes('pre 1900')) return 1890;
    const range = s.match(/(\d{4})[-–to ]+(\d{4})/);
    if (range) return (parseInt(range[1]) + parseInt(range[2])) / 2;
    const single = s.match(/(\d{4})/);
    return single ? parseInt(single[1]) : 1975;
  }

  // ── U-values ───────────────────────────────────────────────────────────────

  function wallUFromAge(year) {
    // Default uninsulated wall U-value by construction era
    if (year < 1920) return 2.10; // solid brick/stone
    if (year < 1945) return 1.90; // solid or early cavity
    if (year < 1967) return 1.60; // uninsulated cavity
    if (year < 1983) return 1.50; // uninsulated cavity
    if (year < 1996) return 0.60; // cavity fill became common
    if (year < 2003) return 0.45;
    if (year < 2012) return 0.35;
    return 0.18;
  }

  function parseWallUValue(desc, ageBand) {
    const year = ageBandMidYear(ageBand);
    if (!desc) return wallUFromAge(year);
    const d = desc.toLowerCase();

    if (d.includes('solid') || d.includes('stone') || d.includes('granite') || d.includes('sandstone')) {
      if (d.includes('internal insulation') || d.includes('external insulation') || d.includes('with insulation')) return 0.28;
      return year < 1900 ? 2.30 : 2.10;
    }
    if (d.includes('cavity')) {
      if (d.includes('filled') || (d.includes('insulated') && !d.includes('no insulation') && !d.includes('as built'))) return 0.45;
      if (d.includes('no insulation') || d.includes('as built')) return year < 1945 ? 1.80 : 1.50;
      // Ambiguous — use age to resolve
      return year >= 1996 ? 0.45 : 1.50;
    }
    if (d.includes('timber frame')) return d.includes('insulated') ? 0.35 : 0.90;
    if (d.includes('system built') || d.includes('concrete')) return 0.90;

    return wallUFromAge(year);
  }

  function parseWindowUValue(desc, multiGlazeProp, glazedType) {
    const prop = parseFloat(multiGlazeProp);
    if (!isNaN(prop) && prop >= 0 && prop <= 100) {
      // Weighted average using actual % double glazed from EPC
      let doubleU = 2.80;
      if (glazedType) {
        const g = glazedType.toLowerCase();
        if (g.includes('triple')) doubleU = 1.20;
        else if (g.includes('low-e') || g.includes('low e')) doubleU = 1.80;
      }
      return Math.round(((prop / 100) * doubleU + (1 - prop / 100) * 4.80) * 100) / 100;
    }
    // Fall back to description
    if (!desc) return 2.80;
    const d = desc.toLowerCase();
    if (d.includes('triple')) return 1.20;
    if (d.includes('double') && (d.includes('low-e') || d.includes('low e'))) return 1.80;
    if (d.includes('full double') || (d.includes('double') && !d.includes('partial') && !d.includes('some'))) return 2.80;
    if (d.includes('partial double') || d.includes('some double')) return 3.50;
    if (d.includes('single')) return 4.80;
    return 2.80;
  }

  function parseRoofUValue(desc) {
    if (!desc) return 0.40;
    const d = desc.toLowerCase();
    if (d.includes('flat')) return d.includes('insulated') ? 0.25 : 3.00;
    if (d.includes('no insulation') || d.includes('no loft')) return 2.30;
    const mm = d.match(/(\d+)\s*mm/);
    if (mm) {
      const t = parseInt(mm[1]);
      if (t === 0)    return 2.30;
      if (t <= 25)    return 1.20;
      if (t <= 50)    return 0.70;
      if (t <= 100)   return 0.40;
      if (t <= 150)   return 0.26;
      if (t <= 200)   return 0.18;
      return 0.13;
    }
    if (d.includes('insulated') || d.includes('with insulation')) return 0.20;
    return 0.40;
  }

  function parseFloorUValue(desc) {
    if (!desc) return 0.70;
    const d = desc.toLowerCase();
    if (d.includes('insulated') || d.includes('with insulation')) return 0.25;
    return 0.70;
  }

  // ── Ventilation ────────────────────────────────────────────────────────────

  function calcBaselineACH(ageBand, mechanicalVent, openFireplaces) {
    const year = ageBandMidYear(ageBand);
    let ach;
    if (year < 1920)      ach = 1.20;
    else if (year < 1945) ach = 1.00;
    else if (year < 1967) ach = 0.80;
    else if (year < 1983) ach = 0.70;
    else if (year < 1996) ach = 0.55;
    else if (year < 2006) ach = 0.45;
    else                  ach = 0.35;

    if (mechanicalVent) {
      const mv = mechanicalVent.toLowerCase();
      if (mv.includes('mvhr') || mv.includes('heat recovery') || mv.includes('balanced')) {
        ach *= 0.25; // MVHR recovers ~75% of ventilation heat
      } else if (mv.includes('exhaust') || mv.includes('extract')) {
        ach *= 0.65;
      }
    }

    // Each open fireplace adds infiltration
    const fires = parseInt(openFireplaces) || 0;
    ach += fires * 0.15;

    return Math.round(Math.min(Math.max(ach, 0.10), 3.00) * 100) / 100;
  }

  // ── Geometry ───────────────────────────────────────────────────────────────

  function estimateFloors(totalFloorArea, propertyType, habRooms, storeyCount) {
    const pt = (propertyType || '').toLowerCase();
    if (pt.includes('bungalow')) return 1;

    const sc = parseInt(storeyCount);
    if (!isNaN(sc) && sc >= 1 && sc <= 5) return sc;

    if (pt.includes('flat') || pt.includes('maisonette')) return 1;

    const rooms = parseInt(habRooms);
    if (!isNaN(rooms) && rooms > 0) {
      if (rooms <= 3) return 1;
      if (rooms <= 6) return 2;
      return 3;
    }
    if (totalFloorArea <= 70)  return 1;
    if (totalFloorArea <= 160) return 2;
    return 3;
  }

  function estimateGeometry(epcData) {
    const totalFloorArea = parseFloat(epcData['total-floor-area']) || 100;
    const propertyType   = (epcData['property-type'] || '').toLowerCase();
    const builtForm      = (epcData['built-form']    || '').toLowerCase();
    const glazedArea     = (epcData['glazed-area']   || 'normal').toLowerCase();

    const floors = estimateFloors(
      totalFloorArea, propertyType,
      epcData['number-habitable-rooms'],
      epcData['flat-storey-count']
    );

    const fh = parseFloat(epcData['floor-height']);
    const wallHeight = (!isNaN(fh) && fh > 1.8 && fh < 5.0) ? fh : 2.50;

    const footprint      = totalFloorArea / floors;
    const side           = Math.sqrt(footprint);
    const fullPerimeter  = 4 * side;

    let windowFraction = 0.18;
    if (glazedArea.includes('more than usual') || glazedArea.includes('much more')) windowFraction = 0.25;
    if (glazedArea.includes('less than usual') || glazedArea.includes('much less'))  windowFraction = 0.12;
    const windowArea = totalFloorArea * windowFraction;

    let exposedFraction = 1.00;
    if (builtForm.includes('semi-detached') || builtForm.includes('semi detached'))    exposedFraction = 0.75;
    if (builtForm.includes('end-terrace') || builtForm.includes('end terrace') ||
        builtForm.includes('enclosed end'))                                             exposedFraction = 0.75;
    if (builtForm.includes('mid-terrace') || builtForm.includes('mid terrace') ||
        builtForm.includes('enclosed mid'))                                             exposedFraction = 0.50;
    if (propertyType.includes('flat'))                                                 exposedFraction = 0.50;

    const grossWallArea = fullPerimeter * exposedFraction * wallHeight * floors;
    const netWallArea   = Math.max(grossWallArea - windowArea, 10);

    return {
      totalFloorArea, footprint, floors, wallHeight,
      netWallArea, windowArea,
      roofArea: footprint, groundFloorArea: footprint,
      volume: totalFloorArea * wallHeight,
      exposedFraction
    };
  }

  // Thermal bridging worsens in older, less carefully built stock
  function thermalBridgingFactor(ageBand) {
    const year = ageBandMidYear(ageBand);
    if (year < 1945) return 0.15;
    if (year < 2003) return 0.12;
    if (year < 2012) return 0.08;
    return 0.05;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function calculate(epcData, options = {}) {
    const outdoorTemp = options.outdoorTemp !== undefined ? options.outdoorTemp : -3;
    const indoorTemp  = options.indoorTemp  !== undefined ? options.indoorTemp  : 21;
    const deltaT      = indoorTemp - outdoorTemp;

    const ageBand = epcData['construction-age-band'] || '';
    const autoACH = calcBaselineACH(
      ageBand,
      epcData['mechanical-ventilation'],
      epcData['number-open-fireplaces']
    );
    const ach = options.ach !== undefined ? parseFloat(options.ach) : autoACH;

    const geo = estimateGeometry(epcData);

    const uWall   = parseWallUValue(epcData['walls-description'], ageBand);
    const uWindow = parseWindowUValue(
      epcData['windows-description'],
      epcData['multi-glaze-proportion'],
      epcData['glazed-type']
    );
    const uRoof  = parseRoofUValue(epcData['roof-description']);
    const uFloor = parseFloorUValue(epcData['floor-description']);
    const bFactor = thermalBridgingFactor(ageBand);

    const hWall   = uWall   * geo.netWallArea;
    const hWindow = uWindow * geo.windowArea;
    const hRoof   = uRoof   * geo.roofArea;
    const hFloor  = uFloor  * geo.groundFloorArea;
    const hFabric = hWall + hWindow + hRoof + hFloor;
    const hBridge = hFabric * bFactor;
    const hVent   = 0.33 * ach * geo.volume;
    const hTotal  = hFabric + hBridge + hVent;

    const heatLossKW = Math.round((hTotal * deltaT) / 10) / 100;
    const hpSizeKW   = Math.ceil(heatLossKW * 1.20 * 2) / 2;

    // Track which EPC fields improved accuracy beyond estimates
    const dataQuality = {
      multiGlazeProportion: epcData['multi-glaze-proportion'] != null,
      floorHeight:          !isNaN(parseFloat(epcData['floor-height'])),
      mechanicalVent:       !!epcData['mechanical-ventilation'],
      openFireplaces:       parseInt(epcData['number-open-fireplaces']) > 0,
      habRooms:             !isNaN(parseInt(epcData['number-habitable-rooms'])),
      storeyCount:          !isNaN(parseInt(epcData['flat-storey-count'])),
      achSource:            options.ach !== undefined ? 'manual' : 'age-band',
      autoACH
    };

    return {
      geometry: geo,
      uValues:  { wall: uWall, window: uWindow, roof: uRoof, floor: uFloor },
      coefficients: {
        wall: hWall, window: hWindow, roof: hRoof, floor: hFloor,
        bridging: hBridge, ventilation: hVent, total: hTotal
      },
      deltaT, outdoorTemp, indoorTemp, ach, bFactor,
      heatLossKW, hpSizeKW, dataQuality
    };
  }

  return { calculate, calcBaselineACH };
})();
