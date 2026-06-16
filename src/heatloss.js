// Heat loss calculation engine based on simplified EN 12831 methodology.
// U-values are derived from EPC description strings.

const HeatLoss = (() => {
  function parseWallUValue(desc) {
    if (!desc) return 1.5;
    const d = desc.toLowerCase();
    if (d.includes('solid') || d.includes('stone') || d.includes('granite') || d.includes('sandstone')) {
      if (d.includes('internal insulation') || d.includes('external insulation') || d.includes('with insulation')) return 0.30;
      return 2.10;
    }
    if (d.includes('cavity')) {
      if (d.includes('filled') || (d.includes('insulated') && !d.includes('no insulation'))) return 0.45;
      if (d.includes('no insulation') || d.includes('as built')) return 1.50;
      if (d.includes('insulation')) return 0.45;
      return 1.50;
    }
    if (d.includes('timber frame')) {
      return d.includes('insulated') ? 0.35 : 0.90;
    }
    if (d.includes('system built') || d.includes('concrete')) return 0.90;
    return 1.50;
  }

  function parseWindowUValue(desc) {
    if (!desc) return 2.80;
    const d = desc.toLowerCase();
    if (d.includes('triple')) return 1.20;
    if (d.includes('double') && (d.includes('low-e') || d.includes('low e'))) return 1.60;
    if (d.includes('full double glazing') || (d.includes('double') && !d.includes('partial') && !d.includes('some'))) return 2.80;
    if (d.includes('partial double') || d.includes('some double')) return 3.50;
    if (d.includes('single')) return 4.80;
    return 2.80;
  }

  function parseRoofUValue(desc) {
    if (!desc) return 0.40;
    const d = desc.toLowerCase();
    if (d.includes('flat')) {
      return d.includes('insulated') ? 0.25 : 3.00;
    }
    const mmMatch = d.match(/(\d+)\s*mm/);
    if (mmMatch) {
      const mm = parseInt(mmMatch[1]);
      if (mm === 0) return 2.30;
      if (mm <= 25) return 1.20;
      if (mm <= 50) return 0.70;
      if (mm <= 100) return 0.40;
      if (mm <= 150) return 0.26;
      if (mm <= 200) return 0.18;
      return 0.13;
    }
    if (d.includes('no insulation')) return 2.30;
    if (d.includes('insulated') || d.includes('with insulation')) return 0.20;
    return 0.40;
  }

  function parseFloorUValue(desc) {
    if (!desc) return 0.70;
    const d = desc.toLowerCase();
    if (d.includes('insulated') || d.includes('with insulation')) return 0.25;
    return 0.70;
  }

  function estimateGeometry(epcData) {
    const totalFloorArea = parseFloat(epcData['total-floor-area']) || 100;
    const propertyType = (epcData['property-type'] || '').toLowerCase();
    const builtForm = (epcData['built-form'] || '').toLowerCase();
    const glazedArea = (epcData['glazed-area'] || 'normal').toLowerCase();

    let floors = 2;
    if (propertyType.includes('bungalow') || propertyType.includes('flat') || propertyType.includes('maisonette')) {
      floors = 1;
    } else if (totalFloorArea > 180) {
      floors = 3;
    }

    const footprint = totalFloorArea / floors;
    const wallHeight = 2.50;
    const side = Math.sqrt(footprint);
    const fullPerimeter = 4 * side;

    let windowFraction = 0.18;
    if (glazedArea.includes('more than usual') || glazedArea.includes('much more')) windowFraction = 0.25;
    if (glazedArea.includes('less than usual') || glazedArea.includes('much less')) windowFraction = 0.12;

    const windowArea = totalFloorArea * windowFraction;

    let exposedFraction = 1.0;
    if (builtForm.includes('semi-detached') || builtForm.includes('semi detached')) exposedFraction = 0.75;
    if (builtForm.includes('end-terrace') || builtForm.includes('end terrace') || builtForm.includes('enclosed end')) exposedFraction = 0.75;
    if (builtForm.includes('mid-terrace') || builtForm.includes('mid terrace') || builtForm.includes('enclosed mid')) exposedFraction = 0.50;
    if (propertyType.includes('flat')) exposedFraction = 0.50;

    const grossWallArea = fullPerimeter * exposedFraction * wallHeight * floors;
    const netWallArea = Math.max(grossWallArea - windowArea, 10);

    return {
      totalFloorArea,
      footprint,
      floors,
      wallHeight,
      netWallArea,
      windowArea,
      roofArea: footprint,
      groundFloorArea: footprint,
      volume: totalFloorArea * wallHeight,
      exposedFraction
    };
  }

  function calculate(epcData, options = {}) {
    const outdoorTemp = options.outdoorTemp !== undefined ? options.outdoorTemp : -3;
    const indoorTemp = options.indoorTemp !== undefined ? options.indoorTemp : 21;
    const ach = options.ach !== undefined ? options.ach : 0.5;
    const deltaT = indoorTemp - outdoorTemp;

    const geo = estimateGeometry(epcData);

    const uWall = parseWallUValue(epcData['walls-description']);
    const uWindow = parseWindowUValue(epcData['windows-description']);
    const uRoof = parseRoofUValue(epcData['roof-description']);
    const uFloor = parseFloorUValue(epcData['floor-description']);

    const hWall = uWall * geo.netWallArea;
    const hWindow = uWindow * geo.windowArea;
    const hRoof = uRoof * geo.roofArea;
    const hFloor = uFloor * geo.groundFloorArea;

    const hFabric = hWall + hWindow + hRoof + hFloor;
    const hBridging = hFabric * 0.10;
    const hVent = 0.33 * ach * geo.volume;
    const hTotal = hFabric + hBridging + hVent;

    const heatLossKW = (hTotal * deltaT) / 1000;

    // Round up to nearest 0.5 kW with a 20% contingency for heat pump sizing
    const rawHP = heatLossKW * 1.20;
    const hpSizeKW = Math.ceil(rawHP * 2) / 2;

    return {
      geometry: geo,
      uValues: { wall: uWall, window: uWindow, roof: uRoof, floor: uFloor },
      coefficients: {
        wall: hWall,
        window: hWindow,
        roof: hRoof,
        floor: hFloor,
        bridging: hBridging,
        ventilation: hVent,
        total: hTotal
      },
      deltaT,
      outdoorTemp,
      indoorTemp,
      ach,
      heatLossKW: Math.round(heatLossKW * 100) / 100,
      hpSizeKW
    };
  }

  return { calculate, parseWallUValue, parseWindowUValue, parseRoofUValue, parseFloorUValue };
})();
