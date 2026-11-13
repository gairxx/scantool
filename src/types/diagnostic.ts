export type ObdProtocolId =
  | 'AUTO'
  | 'ISO_15765_4_CAN_FD'
  | 'ISO_15765_4_CAN_11B_500K'
  | 'DOIP_ISO_13400'
  | 'ISO_14230_4_KWP2000'
  | 'SAE_J1850_VPW'
  | 'SAE_J1850_PWM'
  | 'ISO_9141_2';

export type HardwareConnectionMode = 'simulated' | 'bluetooth_ble' | 'usb_serial';

export type IgnitionState = 'KOER' | 'KOEO';

export type BusNetworkType = 'FD-CAN' | 'HS-CAN' | 'MS-CAN' | 'LIN / IMMO';

export interface EcuModule {
  id: string;
  shortCode: string;
  name: string;
  bus: BusNetworkType;
  canTxId: string;
  canRxId: string;
  partNumber: string;
  calibrationId: string;
  targetCalibrationId?: string;
  calibrationReleaseNote?: string;
  calibrationSizeKb?: number;
  responseTimeMs: number;
  status: 'Nominal' | 'Fault' | 'Advisory';
}

export interface DtcRecord {
  id: string;
  code: string;
  moduleId: string;
  moduleName: string;
  status: 'Confirmed' | 'Pending' | 'History' | 'Permanent';
  description: string;
  system: string;
  occurrenceCount: number;
  firstMileageKm: number;
  freezeFrame: {
    rpm: number;
    speedKmh: number;
    coolantC: number;
    mapKpa: number;
    stftB1Pct: number;
    ltftB1Pct: number;
    batteryV: number;
    loadPct: number;
  };
  guidedChecks: string[];
}

export interface ReadinessMonitor {
  id: string;
  name: string;
  category: 'Continuous' | 'Non-Continuous';
  supported: boolean;
  status: 'Complete' | 'Incomplete';
}

export interface PidDefinition {
  id: string;
  modePid: string; // e.g., '010C'
  shortLabel: string; // <= 3 words for readouts
  name: string;
  description: string;
  unit: string;
  min: number;
  max: number;
  nominalMin: number;
  nominalMax: number;
  decimals: number;
  traceColorVar: string;
  category: 'Engine' | 'Fuel & Air' | 'Valvetrain & Boost' | 'Electrical & Chassis';
}

export interface BidirectionalTestSpec {
  id: string;
  moduleId: string;
  title: string;
  udsServiceHex: string; // e.g. '2F F4 04 03'
  requiresState: 'ANY' | 'KOEO' | 'KOER';
  controlType: 'cylinder_cutout' | 'duty_slider' | 'toggle_relay' | 'bleed_sequence';
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number;
  safetyNote: string;
  targetPidId: string;
  secondaryPidId: string;
}

export interface ImmobilizerKeySlot {
  slot: number;
  transponderId: string;
  type: 'Factory Master Smart Fob' | 'Factory Spare Smart Fob' | 'Dealer Replacement Fob' | 'Unassigned';
  modulation: string;
  encryption: string;
  status: 'Authorized' | 'Sync Fault' | 'Empty';
  lastRssiDbm: number | null;
  batteryState: 'OK' | 'Low' | 'N/A';
}

export interface CalibrationPackage {
  id: string;
  moduleId: string;
  moduleName: string;
  currentCalId: string;
  newCalId: string;
  tsbNumber: string;
  releaseDate: string;
  sizeKb: number;
  crc32Hex: string;
  summary: string;
  requiresMaintainerVolts: number;
}

export interface VehicleProfile {
  id: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  trimEngine: string;
  odometerKm: number;
  protocol: ObdProtocolId;
  protocolLabel: string;
  immobilizerSystem: string;
  securityPinOutcode: string;
  computedIncode: string;
  cylinders: number;
  idleRpmTarget: number;
  modules: EcuModule[];
  initialDtcs: DtcRecord[];
  readiness: ReadinessMonitor[];
  activeTests: BidirectionalTestSpec[];
  calibrations: CalibrationPackage[];
  keySlots: ImmobilizerKeySlot[];
}

export interface CloudReport {
  id: string;
  reportNumber: string;
  createdAtIso: string;
  scanType: 'Pre-Scan' | 'Post-Scan' | 'Flash & Calibration' | 'Immobilizer Audit';
  vin: string;
  year: number;
  make: string;
  model: string;
  engine: string;
  odometerKm: number;
  protocol: string;
  technicianBay: string;
  batteryVoltage: number;
  modulesScanned: number;
  modulesWithFaults: number;
  dtcs: Array<{
    code: string;
    moduleId: string;
    moduleName: string;
    status: 'Confirmed' | 'Pending' | 'History' | 'Permanent';
    description: string;
    freezeFrameSummary?: string;
  }>;
  calibrationsApplied: string[];
  keysProgrammedCount: number;
  notes: string;
  telemetrySnapshot: Array<{
    pid: string;
    label: string;
    value: number;
    unit: string;
  }>;
}

export interface TsbReference {
  tsbNumber: string;
  publishDate: string;
  appliesTo: string;
  title: string;
  summary: string;
  repairProcedure: string;
  calibrationRef?: string;
  portalUrl: string;
}

export interface DtcPotentialCause {
  likelihood: 'Primary' | 'Secondary' | 'Verify';
  cause: string;
  detail: string;
  targetSpec?: string;
}

export interface DtcDiagnosticStep {
  step: number;
  title: string;
  procedure: string;
  expectedSpec: string;
  recommendedTool?: 'live' | 'active' | 'library' | 'programming';
}

export interface DtcAnalysisResult {
  code: string;
  title: string;
  vehicleMatch: string;
  matchScope: 'Vehicle-Specific OEM' | 'Generic SAE J2012';
  severity: 'High' | 'Moderate' | 'Advisory';
  settingCriteria: string;
  drivabilityImpact: string;
  potentialCauses: DtcPotentialCause[];
  diagnosticSteps: DtcDiagnosticStep[];
  relatedTsbs: TsbReference[];
  relatedModuleId?: string;
}

export interface WiringCircuit {
  pin: string;
  wireColorCode: string;
  wireColorHex: string;
  signalName: string;
  circuitType: 'Power' | 'Ground' | 'CAN Bus' | 'Sensor Input' | 'Actuator Output';
  connectedComponent: string;
  testSpec: string;
}

export interface ModuleCalibrationFile {
  fileName: string;
  format: string;
  version: string;
  releaseDate: string;
  sizeKb: number;
  crc32Hex: string;
  sha256Short: string;
  tsbRef?: string;
  notes: string;
  isLatest: boolean;
}

export interface ModuleLocationGuide {
  zone: string;
  xPct: number;
  yPct: number;
  accessSummary: string;
  mountingFasteners: string;
  removalSteps: string[];
}

export interface ModuleLibraryRecord {
  id: string;
  vehicleId: string;
  make: string;
  model: string;
  year: number;
  engine: string;
  moduleId: string;
  shortCode: string;
  moduleName: string;
  bus: BusNetworkType;
  canTxId: string;
  canRxId: string;
  oemPartNumber: string;
  connectorCode: string;
  pinCount: number;
  fuseFeed: string;
  groundPoint: string;
  location: ModuleLocationGuide;
  wiringCircuits: WiringCircuit[];
  calibrationFiles: ModuleCalibrationFile[];
}

export interface ModuleLibraryLookupResponse {
  queryMode: 'vin' | 'manual';
  decodedVinInfo?: {
    vin: string;
    wmiRegion: string;
    modelYear: number | null;
    platformMatchNote: string;
  };
  vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    engine: string;
    vinSample: string;
    protocolLabel: string;
  };
  modules: ModuleLibraryRecord[];
}

export interface LemonManualSection {
  id: 'home' | 'repair' | 'dtc_index' | 'tsbs' | 'wiring' | 'locations';
  label: string;
  url: string;
}

export interface LemonResolveResult {
  source: 'live-lemon-mirror' | 'cached-fallback';
  baseUrl: string;
  vehicleLabel: string;
  vehicleUrl: string;
  repairUrl: string;
  sections: LemonManualSection[];
  allQuickLinks: Array<{ label: string; url: string }>;
}

export type TuningTableId =
  | 'fuel_ve'
  | 'target_lambda'
  | 'spark_advance'
  | 'vct_intake'
  | 'boost_target'
  | 'injector_rail';

export interface TuningTableSpec {
  id: TuningTableId;
  name: string;
  shortName: string;
  unit: string;
  decimals: number;
  step: number;
  minAllowed: number;
  maxAllowed: number;
  xLabel: string;
  yLabel: string;
  xBreakpoints: number[];
  yBreakpoints: number[];
  values: number[][]; // [yIndex][xIndex]
  description: string;
  higherIsRichOrHigh: 'high' | 'low';
}

export interface TuningScalarSpec {
  id:
    | 'rev_limit_rpm'
    | 'soft_cut_rpm'
    | 'vmax_kmh'
    | 'injector_flow_cc'
    | 'stoich_afr'
    | 'idle_rpm_warm'
    | 'fan_on_temp_c'
    | 'boost_cut_kpa'
    | 'knock_retard_max_deg';
  label: string;
  category: 'Limiters' | 'Fueling' | 'Thermal & Boost';
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  description: string;
}

export interface TuningPresetSpec {
  id: 'stock' | 'stage1_93' | 'e85_blend' | 'tow_economy';
  label: string;
  fuelOctane: string;
  summary: string;
  veMultiplierPct: number;
  lambdaBoostOffset: number;
  sparkOffsetHighLoad: number;
  boostKpaDelta: number;
  revLimitDelta: number;
  stoichAfr?: number;
}

export interface VehicleTuningProfile {
  vehicleId: string;
  ecuStrategy: string;
  aspiration: 'Twin-Turbo GDI' | 'Turbocharged GDI' | 'Naturally Aspirated D4S' | 'Naturally Aspirated GDI';
  basePeakHp: number;
  basePeakTqNm: number;
  peakHpRpm: number;
  peakTqRpm: number;
  displacementL: number;
  tables: Record<TuningTableId, TuningTableSpec>;
  scalars: TuningScalarSpec[];
  presets: TuningPresetSpec[];
}


