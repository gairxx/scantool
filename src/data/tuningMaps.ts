import type {
  TuningPresetSpec,
  TuningScalarSpec,
  TuningTableId,
  TuningTableSpec,
  VehicleTuningProfile,
} from '../types/diagnostic';

const TURBO_RPM = [1000, 1500, 2000, 2500, 3000, 3600, 4200, 4800, 5500, 6200];
const TURBO_LOAD_KPA = [30, 50, 75, 100, 125, 155, 185, 215];

const NA_RPM = [800, 1400, 2000, 2600, 3200, 3800, 4400, 5000, 5600, 6400];
const NA_LOAD_KPA = [25, 38, 52, 65, 78, 88, 96, 102];

const INJ_VOLT_X = [8.0, 9.5, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0];
const INJ_PRESSURE_Y = [3.5, 5.0, 8.0, 11.0, 14.0, 17.0, 20.0];

function roundTo(val: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function buildTurboTables(opts: {
  vePeak: number;
  peakBoostKpa: number;
  baseSparkBoost: number;
  maxVctDeg: number;
  railMaxMpa: number;
}): Record<TuningTableId, TuningTableSpec> {
  const fuelVeValues = TURBO_LOAD_KPA.map((kpa) =>
    TURBO_RPM.map((rpm) => {
      const rpmNorm = Math.exp(-Math.pow((rpm - 3800) / 2400, 2));
      const loadNorm = Math.min(1, kpa / 195);
      const val = 58 + loadNorm * (opts.vePeak - 64) + rpmNorm * 11;
      return roundTo(val, 1);
    })
  );

  const lambdaValues = TURBO_LOAD_KPA.map((kpa) =>
    TURBO_RPM.map((rpm) => {
      if (kpa <= 95) return 1.0;
      if (kpa <= 125) return roundTo(0.95 - (rpm > 4500 ? 0.03 : 0), 3);
      if (kpa <= 160) return roundTo(0.86 - (rpm > 4800 ? 0.03 : 0), 3);
      return roundTo(0.8 - (rpm > 5000 ? 0.02 : 0), 3);
    })
  );

  const sparkValues = TURBO_LOAD_KPA.map((kpa) =>
    TURBO_RPM.map((rpm) => {
      const baseCruise = 16 + (rpm / 6200) * 21;
      const boostRetard = kpa > 100 ? ((kpa - 100) / 115) * (25 - opts.baseSparkBoost) : 0;
      const vacAdvance = kpa < 70 ? 6 : 0;
      return roundTo(Math.max(4.5, Math.min(42, baseCruise + vacAdvance - boostRetard)), 1);
    })
  );

  const vctValues = TURBO_LOAD_KPA.map((kpa) =>
    TURBO_RPM.map((rpm) => {
      if (rpm < 1200 && kpa < 45) return 2.0;
      const midTorque = Math.exp(-Math.pow((rpm - 2900) / 1550, 2)) * opts.maxVctDeg;
      const loadFactor = Math.min(1, Math.max(0.2, kpa / 160));
      return roundTo(Math.max(0, midTorque * loadFactor), 1);
    })
  );

  const boostValues = TURBO_LOAD_KPA.map((kpa, yi) =>
    TURBO_RPM.map((rpm) => {
      const demand = yi / (TURBO_LOAD_KPA.length - 1);
      if (demand < 0.3) return roundTo(95 + demand * 35, 0);
      const spoolCurve = rpm < 2000 ? 0.72 : rpm > 5400 ? 0.88 : 1.0;
      const target = 101 + (opts.peakBoostKpa - 101) * Math.pow(demand, 1.15) * spoolCurve;
      return roundTo(target, 0);
    })
  );

  const injectorValues = INJ_PRESSURE_Y.map((mpa) =>
    INJ_VOLT_X.map((v) => {
      const voltFactor = Math.pow(14.0 / v, 1.45);
      const pressureAdd = (mpa - 3.5) * 0.014;
      const ms = 0.56 * voltFactor + pressureAdd;
      return roundTo(Math.min(2.6, Math.max(0.35, ms)), 3);
    })
  );

  return {
    fuel_ve: {
      id: 'fuel_ve',
      name: 'Base Volumetric Efficiency (VE / Speed-Density)',
      shortName: 'Fuel VE',
      unit: '% VE',
      decimals: 1,
      step: 0.5,
      minAllowed: 30,
      maxAllowed: 145,
      xLabel: 'Engine Speed (RPM)',
      yLabel: 'MAP Load (kPa)',
      xBreakpoints: TURBO_RPM,
      yBreakpoints: TURBO_LOAD_KPA,
      values: fuelVeValues,
      description: 'Primary cylinder airmass estimation table (% VE). Scaling cells directly adjusts injected fuel pulsewidth.',
      higherIsRichOrHigh: 'high',
    },
    target_lambda: {
      id: 'target_lambda',
      name: 'Target Equivalence Ratio (Lambda / AFR)',
      shortName: 'Target Lambda',
      unit: 'λ',
      decimals: 3,
      step: 0.01,
      minAllowed: 0.68,
      maxAllowed: 1.12,
      xLabel: 'Engine Speed (RPM)',
      yLabel: 'MAP Load (kPa)',
      xBreakpoints: TURBO_RPM,
      yBreakpoints: TURBO_LOAD_KPA,
      values: lambdaValues,
      description: 'Closed-loop wideband O2 & power-enrichment target. Lower λ values enrich mixture for knock & EGT control under boost.',
      higherIsRichOrHigh: 'low',
    },
    spark_advance: {
      id: 'spark_advance',
      name: 'Main Ignition Spark Timing Advance',
      shortName: 'Spark Timing',
      unit: '° BTDC',
      decimals: 1,
      step: 0.5,
      minAllowed: -5,
      maxAllowed: 48,
      xLabel: 'Engine Speed (RPM)',
      yLabel: 'MAP Load (kPa)',
      xBreakpoints: TURBO_RPM,
      yBreakpoints: TURBO_LOAD_KPA,
      values: sparkValues,
      description: 'Base MBT / Borderline-knock spark advance before coolant, IAT, and knock-sensor trim.',
      higherIsRichOrHigh: 'high',
    },
    vct_intake: {
      id: 'vct_intake',
      name: 'Intake Camshaft VCT / VANOS Phase Target',
      shortName: 'Cam VCT',
      unit: '° CA',
      decimals: 1,
      step: 1.0,
      minAllowed: -10,
      maxAllowed: 55,
      xLabel: 'Engine Speed (RPM)',
      yLabel: 'MAP Load (kPa)',
      xBreakpoints: TURBO_RPM,
      yBreakpoints: TURBO_LOAD_KPA,
      values: vctValues,
      description: 'Commanded intake cam advance angle for scavenging, low-end torque, and internal EGR.',
      higherIsRichOrHigh: 'high',
    },
    boost_target: {
      id: 'boost_target',
      name: 'Target Boost Manifold Pressure (MAP Ceiling)',
      shortName: 'Boost Target',
      unit: 'kPa',
      decimals: 0,
      step: 5,
      minAllowed: 95,
      maxAllowed: 280,
      xLabel: 'Engine Speed (RPM)',
      yLabel: 'Torque Demand Load Index (kPa)',
      xBreakpoints: TURBO_RPM,
      yBreakpoints: TURBO_LOAD_KPA,
      values: boostValues,
      description: 'Desired absolute manifold pressure target (101 kPa = 0 psi gauge). Controls electronic wastegate duty feed-forward.',
      higherIsRichOrHigh: 'high',
    },
    injector_rail: {
      id: 'injector_rail',
      name: 'Injector Dead-Time Latency (Voltage × Rail Pressure)',
      shortName: 'Injector Latency',
      unit: 'ms',
      decimals: 3,
      step: 0.015,
      minAllowed: 0.2,
      maxAllowed: 3.2,
      xLabel: 'Battery Voltage (V)',
      yLabel: `Fuel Rail Pressure (MPa, max ${opts.railMaxMpa})`,
      xBreakpoints: INJ_VOLT_X,
      yBreakpoints: INJ_PRESSURE_Y,
      values: injectorValues,
      description: 'Solenoid opening delay compensation across Terminal 30 voltage and GDI fuel rail pressure.',
      higherIsRichOrHigh: 'high',
    },
  };
}

function buildNaTables(opts: {
  vePeak: number;
  baseSparkWot: number;
  maxVctDeg: number;
}): Record<TuningTableId, TuningTableSpec> {
  const fuelVeValues = NA_LOAD_KPA.map((kpa) =>
    NA_RPM.map((rpm) => {
      const rpmCurve = Math.exp(-Math.pow((rpm - 4400) / 2300, 2));
      const loadNorm = (kpa - 20) / 82;
      return roundTo(56 + loadNorm * (opts.vePeak - 62) + rpmCurve * 9, 1);
    })
  );

  const lambdaValues = NA_LOAD_KPA.map((kpa) =>
    NA_RPM.map((rpm) => {
      if (kpa < 76) return 1.0;
      if (kpa < 90) return roundTo(0.92 - (rpm > 4800 ? 0.02 : 0), 3);
      return roundTo(0.86 - (rpm > 5200 ? 0.015 : 0), 3);
    })
  );

  const sparkValues = NA_LOAD_KPA.map((kpa) =>
    NA_RPM.map((rpm) => {
      const rpmAdv = 14 + (rpm / 6400) * 19;
      const loadRetard = kpa > 65 ? ((kpa - 65) / 37) * (28 - opts.baseSparkWot) : -5;
      return roundTo(Math.max(8, Math.min(44, rpmAdv - loadRetard)), 1);
    })
  );

  const vctValues = NA_LOAD_KPA.map((kpa) =>
    NA_RPM.map((rpm) => {
      if (rpm < 1100) return 0;
      const curve = Math.exp(-Math.pow((rpm - 3500) / 1800, 2)) * opts.maxVctDeg;
      return roundTo(curve * Math.min(1, kpa / 90), 1);
    })
  );

  const throttleTorqueValues = NA_LOAD_KPA.map((kpa) =>
    NA_RPM.map((rpm) => {
      const pedalLoad = (kpa - 20) / 82;
      const rpmBonus = rpm > 3600 ? 4 : 0;
      return roundTo(Math.min(100, Math.max(8, pedalLoad * 92 + rpmBonus)), 0);
    })
  );

  const injectorValues = INJ_PRESSURE_Y.map((mpa) =>
    INJ_VOLT_X.map((v) => {
      const ms = 0.62 * Math.pow(14.0 / v, 1.4) + (mpa - 3.5) * 0.012;
      return roundTo(Math.min(2.6, Math.max(0.35, ms)), 3);
    })
  );

  return {
    fuel_ve: {
      id: 'fuel_ve',
      name: 'Base Volumetric Efficiency (VE / MAF-SD Blend)',
      shortName: 'Fuel VE',
      unit: '% VE',
      decimals: 1,
      step: 0.5,
      minAllowed: 30,
      maxAllowed: 130,
      xLabel: 'Engine Speed (RPM)',
      yLabel: 'MAP Load (kPa)',
      xBreakpoints: NA_RPM,
      yBreakpoints: NA_LOAD_KPA,
      values: fuelVeValues,
      description: 'Cylinder filling efficiency map used for speed-density fueling and transient throttle enrichment.',
      higherIsRichOrHigh: 'high',
    },
    target_lambda: {
      id: 'target_lambda',
      name: 'Target Equivalence Ratio (Lambda / AFR)',
      shortName: 'Target Lambda',
      unit: 'λ',
      decimals: 3,
      step: 0.01,
      minAllowed: 0.72,
      maxAllowed: 1.1,
      xLabel: 'Engine Speed (RPM)',
      yLabel: 'MAP Load (kPa)',
      xBreakpoints: NA_RPM,
      yBreakpoints: NA_LOAD_KPA,
      values: lambdaValues,
      description: 'Stoichiometric cruise (1.000 λ) transitioning to Power Enrichment (PE) at high load.',
      higherIsRichOrHigh: 'low',
    },
    spark_advance: {
      id: 'spark_advance',
      name: 'Main Ignition Spark Timing Advance',
      shortName: 'Spark Timing',
      unit: '° BTDC',
      decimals: 1,
      step: 0.5,
      minAllowed: 0,
      maxAllowed: 48,
      xLabel: 'Engine Speed (RPM)',
      yLabel: 'MAP Load (kPa)',
      xBreakpoints: NA_RPM,
      yBreakpoints: NA_LOAD_KPA,
      values: sparkValues,
      description: 'Base spark advance table across engine speed and manifold load.',
      higherIsRichOrHigh: 'high',
    },
    vct_intake: {
      id: 'vct_intake',
      name: 'Intake Camshaft VVT-i / Cam Phase Target',
      shortName: 'Cam VCT',
      unit: '° CA',
      decimals: 1,
      step: 1.0,
      minAllowed: -10,
      maxAllowed: 50,
      xLabel: 'Engine Speed (RPM)',
      yLabel: 'MAP Load (kPa)',
      xBreakpoints: NA_RPM,
      yBreakpoints: NA_LOAD_KPA,
      values: vctValues,
      description: 'Variable intake cam phaser target angle for volumetric efficiency optimization.',
      higherIsRichOrHigh: 'high',
    },
    boost_target: {
      id: 'boost_target',
      name: 'Driver Demand / ETC Throttle Authority Map',
      shortName: 'Throttle Torque',
      unit: '% ETC',
      decimals: 0,
      step: 2,
      minAllowed: 5,
      maxAllowed: 100,
      xLabel: 'Engine Speed (RPM)',
      yLabel: 'Torque Request Index (kPa)',
      xBreakpoints: NA_RPM,
      yBreakpoints: NA_LOAD_KPA,
      values: throttleTorqueValues,
      description: 'Drive-by-wire throttle plate opening authority mapped against requested load and RPM.',
      higherIsRichOrHigh: 'high',
    },
    injector_rail: {
      id: 'injector_rail',
      name: 'Injector Dead-Time Latency (Voltage × Rail Pressure)',
      shortName: 'Injector Latency',
      unit: 'ms',
      decimals: 3,
      step: 0.015,
      minAllowed: 0.2,
      maxAllowed: 3.2,
      xLabel: 'Battery Voltage (V)',
      yLabel: 'Fuel Rail Pressure (MPa)',
      xBreakpoints: INJ_VOLT_X,
      yBreakpoints: INJ_PRESSURE_Y,
      values: injectorValues,
      description: 'Injector voltage and pressure dead-time compensation table.',
      higherIsRichOrHigh: 'high',
    },
  };
}

function buildScalars(opts: {
  revLimit: number;
  vmax: number;
  injCc: number;
  idleRpm: number;
  boostCut: number;
}): TuningScalarSpec[] {
  return [
    {
      id: 'rev_limit_rpm',
      label: 'Fuel-Cut Rev Limiter',
      category: 'Limiters',
      unit: 'rpm',
      value: opts.revLimit,
      min: 5200,
      max: 7800,
      step: 100,
      decimals: 0,
      description: 'Hard fuel/spark cut engine speed ceiling.',
    },
    {
      id: 'soft_cut_rpm',
      label: 'Soft-Cut Torque Taper',
      category: 'Limiters',
      unit: 'rpm',
      value: opts.revLimit - 200,
      min: 5000,
      max: 7600,
      step: 50,
      decimals: 0,
      description: 'Begins throttle & timing taper prior to hard rev limit.',
    },
    {
      id: 'vmax_kmh',
      label: 'Vehicle Speed Limiter (Vmax)',
      category: 'Limiters',
      unit: 'km/h',
      value: opts.vmax,
      min: 140,
      max: 300,
      step: 5,
      decimals: 0,
      description: 'Electronic top-speed governor threshold.',
    },
    {
      id: 'injector_flow_cc',
      label: 'Injector Flow Scaling',
      category: 'Fueling',
      unit: 'cc/min',
      value: opts.injCc,
      min: 220,
      max: 1650,
      step: 10,
      decimals: 0,
      description: 'Rated static flow rate at base fuel pressure (adjust when upgrading injectors).',
    },
    {
      id: 'stoich_afr',
      label: 'Stoichiometric AFR Reference',
      category: 'Fueling',
      unit: ':1 AFR',
      value: 14.68,
      min: 9.0,
      max: 15.0,
      step: 0.1,
      decimals: 2,
      description: '14.68 for pure gasoline, 14.13 for E10, 9.76 for E85 flex fuel.',
    },
    {
      id: 'idle_rpm_warm',
      label: 'Target Warm Idle Speed',
      category: 'Fueling',
      unit: 'rpm',
      value: opts.idleRpm,
      min: 550,
      max: 1100,
      step: 25,
      decimals: 0,
      description: 'Closed-loop idle speed target above 75 °C ECT.',
    },
    {
      id: 'fan_on_temp_c',
      label: 'Cooling Fan Activation Temp',
      category: 'Thermal & Boost',
      unit: '°C',
      value: 98,
      min: 82,
      max: 108,
      step: 1,
      decimals: 0,
      description: 'ECT threshold for primary PWM radiator fan ramp.',
    },
    {
      id: 'boost_cut_kpa',
      label: 'Overboost / Load Cut Ceiling',
      category: 'Thermal & Boost',
      unit: 'kPa',
      value: opts.boostCut,
      min: 105,
      max: 295,
      step: 5,
      decimals: 0,
      description: 'Triggers throttle closure & fuel cut if manifold pressure exceeds threshold.',
    },
    {
      id: 'knock_retard_max_deg',
      label: 'Knock Sensor Max Retard',
      category: 'Thermal & Boost',
      unit: '° CA',
      value: 8.0,
      min: 2.0,
      max: 14.0,
      step: 0.5,
      decimals: 1,
      description: 'Maximum global ignition retard authority upon knock feedback.',
    },
  ];
}

const TURBO_PRESETS: TuningPresetSpec[] = [
  {
    id: 'stock',
    label: 'OEM Factory Stock',
    fuelOctane: '87–91 AKI',
    summary: 'Exact factory OEM calibration baseline.',
    veMultiplierPct: 0,
    lambdaBoostOffset: 0,
    sparkOffsetHighLoad: 0,
    boostKpaDelta: 0,
    revLimitDelta: 0,
    stoichAfr: 14.68,
  },
  {
    id: 'stage1_93',
    label: 'Stage 1 (93 Octane / +Boost)',
    fuelOctane: '93 AKI / 98 RON',
    summary: '+22 kPa boost target, +2.0° high-load spark timing, +200 rpm ceiling, slightly richer peak-load lambda.',
    veMultiplierPct: 2.5,
    lambdaBoostOffset: -0.025,
    sparkOffsetHighLoad: 2.0,
    boostKpaDelta: 22,
    revLimitDelta: 200,
    stoichAfr: 14.68,
  },
  {
    id: 'e85_blend',
    label: 'E50–E85 Flex Performance',
    fuelOctane: '100+ AKI (Ethanol)',
    summary: 'Stoich recalibrated to 11.20:1, +18% VE fueling headroom, +4.0° boost timing, +30 kPa boost.',
    veMultiplierPct: 16.0,
    lambdaBoostOffset: -0.02,
    sparkOffsetHighLoad: 4.0,
    boostKpaDelta: 30,
    revLimitDelta: 300,
    stoichAfr: 11.2,
  },
  {
    id: 'tow_economy',
    label: 'Heavy Tow / EGT Safe',
    fuelOctane: '89–91 AKI',
    summary: 'Conservative high-load timing (-1.0°), enriched top-end cooling lambda, stock rev limit.',
    veMultiplierPct: 1.0,
    lambdaBoostOffset: -0.03,
    sparkOffsetHighLoad: -1.0,
    boostKpaDelta: 6,
    revLimitDelta: 0,
    stoichAfr: 14.68,
  },
];

const NA_PRESETS: TuningPresetSpec[] = [
  {
    id: 'stock',
    label: 'OEM Factory Stock',
    fuelOctane: '87 AKI',
    summary: 'Exact factory OEM calibration baseline.',
    veMultiplierPct: 0,
    lambdaBoostOffset: 0,
    sparkOffsetHighLoad: 0,
    boostKpaDelta: 0,
    revLimitDelta: 0,
    stoichAfr: 14.68,
  },
  {
    id: 'stage1_93',
    label: '93 Octane Bolt-On Tune',
    fuelOctane: '93 AKI / 98 RON',
    summary: '+2.5° WOT spark advance, 0.850 λ peak PE target, crisper ETC throttle ramp, +250 rpm ceiling.',
    veMultiplierPct: 2.0,
    lambdaBoostOffset: -0.02,
    sparkOffsetHighLoad: 2.5,
    boostKpaDelta: 6,
    revLimitDelta: 250,
    stoichAfr: 14.68,
  },
  {
    id: 'e85_blend',
    label: 'E85 Ethanol Performance',
    fuelOctane: '100+ AKI (E85)',
    summary: 'Stoich 9.76:1, +26% VE mass compensation, +4.5° high-load spark advance.',
    veMultiplierPct: 26.0,
    lambdaBoostOffset: -0.015,
    sparkOffsetHighLoad: 4.5,
    boostKpaDelta: 8,
    revLimitDelta: 300,
    stoichAfr: 9.76,
  },
  {
    id: 'tow_economy',
    label: '87 Octane Tow & Midrange',
    fuelOctane: '87 AKI',
    summary: 'Lowers fan engagement to 93 °C and smooths mid-load torque delivery.',
    veMultiplierPct: 0.5,
    lambdaBoostOffset: -0.015,
    sparkOffsetHighLoad: 0.5,
    boostKpaDelta: 3,
    revLimitDelta: 0,
    stoichAfr: 14.68,
  },
];

export const VEHICLE_TUNING_PROFILES: Record<string, VehicleTuningProfile> = {
  'ford-f150-2023': {
    vehicleId: 'ford-f150-2023',
    ecuStrategy: 'MG1CS036 Dual-Injection EcoBoost PowerBoost',
    aspiration: 'Twin-Turbo GDI',
    basePeakHp: 430,
    basePeakTqNm: 773,
    peakHpRpm: 6000,
    peakTqRpm: 3000,
    displacementL: 3.5,
    tables: buildTurboTables({
      vePeak: 102,
      peakBoostKpa: 205,
      baseSparkBoost: 11.5,
      maxVctDeg: 38,
      railMaxMpa: 20,
    }),
    scalars: buildScalars({
      revLimit: 6200,
      vmax: 172,
      injCc: 640,
      idleRpm: 680,
      boostCut: 235,
    }),
    presets: TURBO_PRESETS,
  },
  'bmw-330i-2021': {
    vehicleId: 'bmw-330i-2021',
    ecuStrategy: 'Bosch MG1CS201 DME (B46D TwinPower)',
    aspiration: 'Turbocharged GDI',
    basePeakHp: 255,
    basePeakTqNm: 400,
    peakHpRpm: 5000,
    peakTqRpm: 1550,
    displacementL: 2.0,
    tables: buildTurboTables({
      vePeak: 106,
      peakBoostKpa: 215,
      baseSparkBoost: 12.0,
      maxVctDeg: 42,
      railMaxMpa: 20,
    }),
    scalars: buildScalars({
      revLimit: 6600,
      vmax: 250,
      injCc: 560,
      idleRpm: 700,
      boostCut: 245,
    }),
    presets: TURBO_PRESETS,
  },
  'toyota-tacoma-2020': {
    vehicleId: 'toyota-tacoma-2020',
    ecuStrategy: 'Denso 89661-04F10 D-4S Dual Injection (2GR-FKS)',
    aspiration: 'Naturally Aspirated D4S',
    basePeakHp: 278,
    basePeakTqNm: 359,
    peakHpRpm: 6000,
    peakTqRpm: 4600,
    displacementL: 3.5,
    tables: buildNaTables({
      vePeak: 94,
      baseSparkWot: 22.0,
      maxVctDeg: 36,
    }),
    scalars: buildScalars({
      revLimit: 6400,
      vmax: 185,
      injCc: 420,
      idleRpm: 650,
      boostCut: 115,
    }),
    presets: NA_PRESETS,
  },
  'vw-jetta-2019': {
    vehicleId: 'vw-jetta-2019',
    ecuStrategy: 'Bosch Simos 18.10 (EA888 Gen3 TSI)',
    aspiration: 'Turbocharged GDI',
    basePeakHp: 228,
    basePeakTqNm: 350,
    peakHpRpm: 5000,
    peakTqRpm: 1700,
    displacementL: 2.0,
    tables: buildTurboTables({
      vePeak: 104,
      peakBoostKpa: 210,
      baseSparkBoost: 12.5,
      maxVctDeg: 40,
      railMaxMpa: 20,
    }),
    scalars: buildScalars({
      revLimit: 6800,
      vmax: 210,
      injCc: 530,
      idleRpm: 720,
      boostCut: 240,
    }),
    presets: TURBO_PRESETS,
  },
  'chevy-silverado-2016': {
    vehicleId: 'chevy-silverado-2016',
    ecuStrategy: 'ACDelco E92 Gen-V LT V8 (5.3L L83)',
    aspiration: 'Naturally Aspirated GDI',
    basePeakHp: 355,
    basePeakTqNm: 519,
    peakHpRpm: 5600,
    peakTqRpm: 4100,
    displacementL: 5.3,
    tables: buildNaTables({
      vePeak: 92,
      baseSparkWot: 23.0,
      maxVctDeg: 32,
    }),
    scalars: buildScalars({
      revLimit: 5800,
      vmax: 160,
      injCc: 460,
      idleRpm: 600,
      boostCut: 112,
    }),
    presets: NA_PRESETS,
  },
};

export function cloneVehicleTuningProfile(vehicleId: string): VehicleTuningProfile {
  const src = VEHICLE_TUNING_PROFILES[vehicleId] || VEHICLE_TUNING_PROFILES['ford-f150-2023'];
  return structuredClone(src);
}

export interface DynoPoint {
  rpm: number;
  stockTqNm: number;
  stockHp: number;
  tunedTqNm: number;
  tunedHp: number;
  stockAfr: number;
  tunedAfr: number;
}

export function computeDynoCurve(
  stock: VehicleTuningProfile,
  current: VehicleTuningProfile
): {
  points: DynoPoint[];
  peakStockHp: number;
  peakTunedHp: number;
  peakStockTq: number;
  peakTunedTq: number;
} {
  const revScalar = current.scalars.find((s) => s.id === 'rev_limit_rpm')?.value ?? 6200;
  const stoichScalar = current.scalars.find((s) => s.id === 'stoich_afr')?.value ?? 14.68;

  // Compute average deltas across upper 3 load rows
  const topRows = [5, 6, 7];
  const avgDiff = (tableId: TuningTableId) => {
    const sVals = stock.tables[tableId].values;
    const cVals = current.tables[tableId].values;
    let sum = 0;
    let count = 0;
    for (const r of topRows) {
      for (let c = 0; c < sVals[r].length; c++) {
        sum += cVals[r][c] - sVals[r][c];
        count += 1;
      }
    }
    return count > 0 ? sum / count : 0;
  };

  const sparkDelta = avgDiff('spark_advance');
  const boostDelta = avgDiff('boost_target');
  const lambdaDelta = avgDiff('target_lambda');
  const isTurbo = stock.aspiration.includes('Turbo');

  const boostGainFactor = isTurbo ? 1 + (boostDelta / 100) * 0.62 : 1 + (boostDelta / 100) * 0.14;
  const sparkGainFactor = 1 + Math.max(-0.08, Math.min(0.1, sparkDelta * 0.015));
  const lambdaFactor = lambdaDelta > 0.06 ? 0.96 : 1 + Math.max(-0.03, Math.min(0.03, -lambdaDelta * 0.15));
  const totalTqMult = Math.max(0.75, Math.min(1.42, boostGainFactor * sparkGainFactor * lambdaFactor));

  const rpms = [1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, Math.min(7000, revScalar)];
  const points: DynoPoint[] = rpms.map((rpm, idx) => {
    const normRpm = rpm / stock.peakHpRpm;
    const tqShape =
      isTurbo
        ? Math.min(1, 0.72 + Math.sin(Math.min(1, rpm / 3200) * (Math.PI / 2)) * 0.28) *
          (rpm > 4800 ? Math.max(0.76, 1 - (rpm - 4800) / 5600) : 1)
        : 0.72 + Math.sin(Math.min(1.15, normRpm) * Math.PI * 0.62) * 0.28;

    const stockTqNm = roundTo(stock.basePeakTqNm * tqShape, 0);
    const stockHp = roundTo((stockTqNm * rpm) / 7127, 0);

    // Mid-to-high RPM sees main calibration gain
    const rpmGainWeight = idx < 2 ? 0.5 : 1.0;
    const tunedTqNm = roundTo(stockTqNm * (1 + (totalTqMult - 1) * rpmGainWeight), 0);
    const tunedHp = roundTo((tunedTqNm * rpm) / 7127, 0);

    const colIdx = Math.min(
      stock.tables.target_lambda.values[6].length - 1,
      Math.round((idx / (rpms.length - 1)) * (stock.tables.target_lambda.values[6].length - 1))
    );
    const stockLam = stock.tables.target_lambda.values[6][colIdx];
    const tunedLam = current.tables.target_lambda.values[6][colIdx];

    return {
      rpm,
      stockTqNm,
      stockHp,
      tunedTqNm,
      tunedHp,
      stockAfr: roundTo(stockLam * 14.68, 2),
      tunedAfr: roundTo(tunedLam * stoichScalar, 2),
    };
  });

  return {
    points,
    peakStockHp: Math.max(...points.map((p) => p.stockHp)),
    peakTunedHp: Math.max(...points.map((p) => p.tunedHp)),
    peakStockTq: Math.max(...points.map((p) => p.stockTqNm)),
    peakTunedTq: Math.max(...points.map((p) => p.tunedTqNm)),
  };
}

export interface CalibrationSafetyAlert {
  severity: 'fault' | 'advisory' | 'nominal';
  title: string;
  detail: string;
}

export function validateCalibrationSafety(
  stock: VehicleTuningProfile,
  current: VehicleTuningProfile
): CalibrationSafetyAlert[] {
  const alerts: CalibrationSafetyAlert[] = [];
  const isTurbo = stock.aspiration.includes('Turbo');

  // Check lean high-load lambda
  const lambdaTable = current.tables.target_lambda;
  let leanViolations = 0;
  for (let r = 5; r < lambdaTable.values.length; r++) {
    for (let c = 0; c < lambdaTable.values[r].length; c++) {
      const val = lambdaTable.values[r][c];
      if ((isTurbo && val > 0.89) || (!isTurbo && val > 0.93)) {
        leanViolations += 1;
      }
    }
  }
  if (leanViolations > 0) {
    alerts.push({
      severity: 'fault',
      title: `Lean high-load lambda detected (${leanViolations} cells)`,
      detail: isTurbo
        ? 'Target Lambda exceeds 0.890 λ in upper boost rows. Enrich below 0.840 λ to prevent pre-ignition and high EGT.'
        : 'Target Lambda exceeds 0.930 λ at WOT load. Enrich below 0.880 λ for knock protection.',
    });
  }

  // Check excessive spark advance in high load
  const sparkTable = current.tables.spark_advance;
  const stockSpark = stock.tables.spark_advance;
  let maxSparkDelta = 0;
  for (let r = 5; r < sparkTable.values.length; r++) {
    for (let c = 0; c < sparkTable.values[r].length; c++) {
      maxSparkDelta = Math.max(maxSparkDelta, sparkTable.values[r][c] - stockSpark.values[r][c]);
    }
  }
  if (maxSparkDelta > 5.5) {
    alerts.push({
      severity: 'fault',
      title: `Excessive high-load spark advance (+${maxSparkDelta.toFixed(1)}° over OEM)`,
      detail: 'High-load timing exceeds +5.5° safety margin over stock without E85/race fuel octane verification.',
    });
  } else if (maxSparkDelta > 2.5) {
    alerts.push({
      severity: 'advisory',
      title: `Performance ignition timing (+${maxSparkDelta.toFixed(1)}° over OEM)`,
      detail: 'Requires minimum 93 AKI / 98 RON fuel or ethanol blend. Monitor knock retard PID during dyno pull.',
    });
  }

  // Check boost cut headroom
  const boostCut = current.scalars.find((s) => s.id === 'boost_cut_kpa')?.value ?? 240;
  const maxBoostTarget = Math.max(...current.tables.boost_target.values.flat());
  if (isTurbo && maxBoostTarget >= boostCut - 5) {
    alerts.push({
      severity: 'fault',
      title: 'Overboost cut conflict',
      detail: `Boost target (${maxBoostTarget} kPa) meets or exceeds Overboost Fuel Cut (${boostCut} kPa). Raise boost cut ceiling by at least 15 kPa.`,
    });
  }

  const revLim = current.scalars.find((s) => s.id === 'rev_limit_rpm')?.value ?? 6200;
  const stockRev = stock.scalars.find((s) => s.id === 'rev_limit_rpm')?.value ?? 6200;
  if (revLim - stockRev > 500) {
    alerts.push({
      severity: 'advisory',
      title: `Elevated rev limit (+${revLim - stockRev} rpm)`,
      detail: 'Verify valve spring float margin and connecting rod bolt rating above factory rev ceiling.',
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      severity: 'nominal',
      title: 'Calibration safety checks passed',
      detail: 'Air-fuel ratio enrichment, knock retard headroom, boost cut margin, and rev limits are within safe tuning bounds.',
    });
  }

  return alerts;
}
