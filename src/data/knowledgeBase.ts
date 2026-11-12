import type {
  DtcAnalysisResult,
  ModuleLibraryLookupResponse,
  ModuleLibraryRecord,
} from '../types/diagnostic';
import { VEHICLE_PROFILES } from './vehicles';
import { buildFallbackLemonResolve } from '../lib/lemonManual';

interface DtcKbEntry {
  code: string;
  make?: string; // undefined = generic SAE J2012 fallback
  modelPattern?: string;
  yearMin?: number;
  yearMax?: number;
  relatedModuleId?: string;
  title: string;
  severity: 'High' | 'Moderate' | 'Advisory';
  settingCriteria: string;
  drivabilityImpact: string;
  potentialCauses: DtcAnalysisResult['potentialCauses'];
  diagnosticSteps: DtcAnalysisResult['diagnosticSteps'];
  relatedTsbs: DtcAnalysisResult['relatedTsbs'];
}

const buildLemonTsbUrl = (year: number, make: string, model: string): string => {
  const resolved = buildFallbackLemonResolve(make, model, year);
  const tsbSection = resolved.sections.find((s) => s.id === 'tsbs');
  return tsbSection?.url || resolved.repairUrl;
};

const DTC_KNOWLEDGE_BASE: DtcKbEntry[] = [
  {
    code: 'P0304',
    make: 'Ford',
    modelPattern: 'F-150',
    yearMin: 2021,
    yearMax: 2025,
    relatedModuleId: 'PCM',
    title: 'Cylinder 4 Misfire Detected — 3.5L EcoBoost Hybrid Dual-Injection',
    severity: 'High',
    settingCriteria:
      'Crankshaft Position (CKP) sensor tooth-to-tooth rotational deceleration exceeds 2.0 % misfire threshold across 200-rev (catalyst damaging) or 1,000-rev (emissions) window.',
    drivabilityImpact:
      'Rough idle, hesitation during hybrid ICE-engage load transition, flashing MIL under sustained boost, elevated catalyst temperature.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: 'Cylinder #4 Ignition Coil-on-Plug (COP) dielectric boot tracking or secondary open',
        detail:
          'Moisture condensation or dielectric breakdown along the #4 ceramic insulator shunts spark energy to cylinder head ground under boost (>120 kPa MAP).',
        targetSpec: 'Primary coil resistance: 0.6–0.9 Ω @ 20 °C · Spark plug gap: 0.70–0.80 mm',
      },
      {
        likelihood: 'Primary',
        cause: 'Direct-Injection (GDI) or Port Injector #4 flow imbalance',
        detail:
          '3.5L EcoBoost PowerBoost transitions between port and high-pressure GDI injectors around 1,800–2,600 rpm; carbon fouling on the #4 GDI tip causes lean cylinder misfire.',
        targetSpec: 'GDI injector coil: 1.4–1.9 Ω · Port injector: 11.5–13.0 Ω',
      },
      {
        likelihood: 'Secondary',
        cause: 'Outdated PCM dual-injection crossover & VCT damping calibration',
        detail:
          'Early ML3A-14C204-EJB calibrations can misclassify hybrid electric-to-ICE torque handoff torsional oscillation as Cylinder #4 misfire.',
        targetSpec: 'Target PCM calibration: ML3A-14C204-EKD or later',
      },
      {
        likelihood: 'Verify',
        cause: 'Mechanical compression or intake valve carbon accumulation',
        detail:
          'Verify cranking compression and relative compression waveform if coil/spark swap does not migrate misfire.',
        targetSpec: 'Cyl #4 compression >= 1,035 kPa (150 psi), <= 10 % variance across bank',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Run Cylinder #4 Power Balance Injector Cutout',
        procedure:
          'Open Active Tests in KOER warm idle and disable injectors #1 through #6 individually while watching Engine Speed drop.',
        expectedSpec: 'Healthy cylinder drops 85–105 rpm; compromised #4 drops < 45 rpm.',
        recommendedTool: 'active',
      },
      {
        step: 2,
        title: 'Monitor Mode $06 Cyl #4 Misfires under Load',
        procedure:
          'Pin Engine Speed, Manifold Pressure (kPa), and Cyl 4 Misfires in Live Data while applying load.',
        expectedSpec: '0 misfire events per 1,000-rev window after repair.',
        recommendedTool: 'live',
      },
      {
        step: 3,
        title: 'Check PCM Pinout C175E-44 (COP #4 Trigger) & Swap Coil',
        procedure:
          'Inspect PCM wiring diagram pin C175E-44 for clean 5 V ignition driver pulse and swap Cylinder #4 coil with Cylinder #1.',
        expectedSpec: 'If misfire moves to P0301, replace COP assembly and spark plug.',
        recommendedTool: 'library',
      },
      {
        step: 4,
        title: 'Flash PCM Calibration ML3A-14C204-EKD',
        procedure:
          'After confirming hardware integrity, connect 12.6+ V maintainer in KOEO and reprogram PCM per TSB 24-2108.',
        expectedSpec: 'Calibration ID reads ML3A-14C204-EKD with CRC-32 0x8FA4C219.',
        recommendedTool: 'programming',
      },
    ],
    relatedTsbs: [
      {
        tsbNumber: 'TSB 24-2108',
        publishDate: '2026-09-14',
        appliesTo: '2021–2024 Ford F-150 3.5L PowerBoost / EcoBoost',
        title: 'Illuminated MIL with P0304 / P0012 During Hybrid ICE Restart & Moderate Load',
        summary:
          'Addresses false misfire sensitivity during electric-to-combustion clutch engagement and updates Bank 1 VCT phaser cleaning pulse.',
        repairProcedure:
          '1) Inspect Cyl #4 spark plug gap (0.75 mm) and COP boot. 2) Reprogram PCM to ML3A-14C204-EKD via J2534. 3) Reset Misfire Monitor Neutral Profile Correction.',
        calibrationRef: 'ML3A-14C204-EKD',
        portalUrl: buildLemonTsbUrl(2023, 'Ford', 'F-150'),
      },
    ],
  },
  {
    code: 'P0012',
    make: 'Ford',
    modelPattern: 'F-150',
    yearMin: 2021,
    yearMax: 2025,
    relatedModuleId: 'PCM',
    title: 'Intake Camshaft Position Timing — Over-Retarded (Bank 1)',
    severity: 'Moderate',
    settingCriteria:
      'PCM detects Bank 1 intake camshaft actual phase lags commanded target angle by > 5.0 °CA for more than 4.5 seconds while oil temp > 60 °C.',
    drivabilityImpact:
      'Reduced low-end torque, sluggish throttle response, occasional rough idle after highway deceleration.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: 'Bank 1 Intake VCT Oil Control Solenoid (OCV) spool sticking or screen debris',
        detail:
          'Varnish or fine metallic debris restricts oil flow to the intake phaser advance chamber, holding the cam retarded.',
        targetSpec: 'VCT solenoid coil resistance: 7.2–11.4 Ω @ 20 °C · Actuation 0–75 % smooth',
      },
      {
        likelihood: 'Secondary',
        cause: 'Low engine oil pressure or incorrect oil viscosity (5W-30 required)',
        detail:
          'Insufficient gallery pressure at hot idle prevents full phaser vane travel back to lock pin.',
        targetSpec: 'Hot idle oil pressure >= 175 kPa (25.4 psi) @ 90 °C',
      },
      {
        likelihood: 'Verify',
        cause: 'PCM calibration phaser cleaning duty schedule',
        detail:
          'TSB 24-2108 adds periodic high-frequency dither pulses to keep the VCT spool free.',
        targetSpec: 'PCM calibration ML3A-14C204-EKD',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Command Intake VCT Solenoid Duty Override',
        procedure:
          'Use Active Tests to sweep Bank 1 Intake VCT duty from 0 % to 75 % while watching Intake Cam Angle (°CA).',
        expectedSpec: 'Cam angle tracks duty smoothly from 0 °CA to > 38 °CA and returns < 2.0 °CA within 0.6 s.',
        recommendedTool: 'active',
      },
      {
        step: 2,
        title: 'Verify VCT Solenoid Power & Ground Circuits',
        procedure:
          'Consult PCM C175B connector pinout in Module Library for VCT11 PWM driver and VPWR feed.',
        expectedSpec: '12.4+ V KOEO on supply pin; < 0.2 V drop to PCM driver.',
        recommendedTool: 'library',
      },
    ],
    relatedTsbs: [
      {
        tsbNumber: 'TSB 24-2108',
        publishDate: '2026-09-14',
        appliesTo: '2021–2024 Ford F-150 3.5L EcoBoost / PowerBoost',
        title: 'Bank 1/2 VCT Phaser Cleaning Sweep & Over-Retarded Timing Calibration',
        summary:
          'Introduces VCT solenoid spool dither routine and refines cold-oil phaser control gains.',
        repairProcedure:
          'Verify oil level/condition, test VCT actuation sweep, and flash PCM to ML3A-14C204-EKD.',
        calibrationRef: 'ML3A-14C204-EKD',
        portalUrl: buildLemonTsbUrl(2023, 'Ford', 'F-150'),
      },
    ],
  },
  {
    code: 'U0155',
    make: 'Ford',
    modelPattern: 'F-150',
    relatedModuleId: 'GWM',
    title: 'Lost Communication With Instrument Panel Cluster (IPC) Control Module',
    severity: 'Advisory',
    settingCriteria:
      'Gateway Module A (GWM) did not receive cyclic MS-CAN heartbeat frames from IPC (0x720/0x728) within 2,500 ms after wake-up.',
    drivabilityImpact:
      'Usually historical; no drivability symptom unless active bus short causes blank cluster gauges.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: 'Transient low battery voltage during accessory cranking (< 11.8 V)',
        detail:
          'Freeze frame confirms terminal 30 dipped to 11.74 V KOEO, causing asynchronous module wake-up.',
        targetSpec: 'Resting battery >= 12.4 V · Cranking >= 10.2 V',
      },
      {
        likelihood: 'Secondary',
        cause: 'MS-CAN twisted pair terminal tension at GWM or DLC pins 3 & 11',
        detail:
          'High contact resistance on MS-CAN+ / MS-CAN- triggers intermittent bus-off frames.',
        targetSpec: 'Bus termination resistance: 58–62 Ω (battery disconnected)',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Check GWM & IPC Connector Pinout in Module Library',
        procedure:
          'Inspect MS-CAN+ (Pin 3) and MS-CAN- (Pin 11) termination and voltage bias.',
        expectedSpec: 'MS-CAN+ ~2.7 V, MS-CAN- ~2.3 V key on; 60 Ω key off.',
        recommendedTool: 'library',
      },
    ],
    relatedTsbs: [
      {
        tsbNumber: 'SSM 51842',
        publishDate: '2026-02-18',
        appliesTo: '2021–2024 Ford F-150',
        title: 'False U0155 History Code Logged During Deep-Sleep Wake-Up',
        summary:
          'Gateway and PCM software timing update prevents nuisance U0155 logging when battery state-of-charge is marginal.',
        repairProcedure: 'Load-test 12 V AGM battery, update PCM/GWM calibrations, and clear history codes.',
        calibrationRef: 'ML3A-14C204-EKD',
        portalUrl: buildLemonTsbUrl(2023, 'Ford', 'F-150'),
      },
    ],
  },
  {
    code: 'B10D7:94',
    make: 'Ford',
    modelPattern: 'F-150',
    relatedModuleId: 'BCM',
    title: 'PATS Transponder Key Slot #3 Unexpected Component Operation',
    severity: 'Advisory',
    settingCriteria:
      'BCM PATS LF transceiver interrogated smart fob Slot #3 and received corrupted AES-128 challenge response or weak RSSI (< -75 dBm).',
    drivabilityImpact:
      'Spare key fob intermittently fails push-button start until placed in center console backup slot.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: 'Weak smart fob CR2450 coin battery or rolling counter desynchronization',
        detail:
          'Fob #3 reports Low battery state and -79 dBm RSSI.',
        targetSpec: 'Fob CR2450 >= 2.95 V · RSSI > -60 dBm',
      },
      {
        likelihood: 'Secondary',
        cause: 'BCM LF backup coil interrogation window timing',
        detail:
          'SSM 52194 extends LF challenge timeout in BCM calibration NL3T-14C184-BKE.',
        targetSpec: 'BCM calibration NL3T-14C184-BKE',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Verify Fob RF RSSI & Re-Sync Key Slot #3',
        procedure:
          'Open ECU & Keys -> Immobilizer & key fob relearn, unlock Security Access 0x27, and re-synchronize Slot #3.',
        expectedSpec: 'Slot #3 shows Authorized with RSSI > -55 dBm.',
        recommendedTool: 'programming',
      },
    ],
    relatedTsbs: [
      {
        tsbNumber: 'SSM 52194',
        publishDate: '2026-08-03',
        appliesTo: '2021–2024 Ford F-150 / Bronco',
        title: 'No Key Detected Message With Spare Smart Access Fob',
        summary:
          'Extends PATS backup coil interrogation window and stabilizes rolling counter synchronization.',
        repairProcedure: 'Replace CR2450 battery, flash BCM to NL3T-14C184-BKE, and re-sync fob.',
        calibrationRef: 'NL3T-14C184-BKE',
        portalUrl: buildLemonTsbUrl(2023, 'Ford', 'F-150'),
      },
    ],
  },
  {
    code: 'P12A9',
    make: 'BMW',
    modelPattern: '330i',
    relatedModuleId: 'DME',
    title: 'Boost Pressure Wastegate Actuator Linkage End-Stop Drift',
    severity: 'Moderate',
    settingCriteria:
      'DME MG1CS201 measures electric wastegate closed-stop Hall position drifted > 1.5 mm beyond stored cold-start adaptation.',
    drivabilityImpact:
      'Reduced turbo spool below 2,200 rpm and wastegate rattle during cold-start catalyst heating.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: 'Electric wastegate actuator rod wear / end-stop adaptation drift',
        detail:
          'Thermal expansion and rod clevis clearance shift zero-point position over 50,000+ km.',
        targetSpec: 'Closed stop voltage 0.45–0.65 V · Full open 4.10–4.35 V',
      },
      {
        likelihood: 'Secondary',
        cause: 'DME I-Step S18A-24-11 wastegate tolerance threshold',
        detail:
          'SI B12 04 25 updates cold-start zero-point learning window and boost target ramp.',
        targetSpec: 'I-Step S18A-26-07-530',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Flash DME to I-Step S18A-26-07-530',
        procedure:
          'Connect >= 13.0 V maintainer in KOEO and execute DoIP/J2534 DME flash, then run wastegate end-stop teach-in.',
        expectedSpec: 'End-stop adaptation completes within 0.0–0.4 mm tolerance.',
        recommendedTool: 'programming',
      },
      {
        step: 2,
        title: 'Inspect DME Harness Connector X60004 Pinout',
        procedure:
          'Check wastegate actuator 5 V reference and Hall sensor return on DME connector X60004.',
        expectedSpec: '5.00 ± 0.15 V supply; clean ground < 0.08 V.',
        recommendedTool: 'library',
      },
    ],
    relatedTsbs: [
      {
        tsbNumber: 'SI B12 04 25',
        publishDate: '2026-07-22',
        appliesTo: '2019–2023 BMW 330i (G20) B46D / B48',
        title: 'Cold-Start Wastegate Rattle & Boost Actuator End-Stop Fault P12A9',
        summary:
          'Software update widens cold-start actuator zero-point learning band and refines catalyst heating wastegate duty.',
        repairProcedure: 'Inspect wastegate clevis play (< 1.0 mm), update DME to S18A-26-07-530, and perform actuator teach-in.',
        calibrationRef: 'S18A-26-07-530',
        portalUrl: buildLemonTsbUrl(2021, 'BMW', '330i'),
      },
    ],
  },
  {
    code: 'P0171',
    make: 'Toyota',
    modelPattern: 'Tacoma',
    relatedModuleId: 'ECM',
    title: 'System Too Lean (Bank 1) — D-4S Combined Fuel Trim > +22 %',
    severity: 'Moderate',
    settingCriteria:
      'Combined Bank 1 Short-Term + Long-Term Fuel Trim exceeds +22.0 % for two consecutive warm closed-loop driving cycles.',
    drivabilityImpact:
      'High idle fuel trims, slight hesitation on tip-in, check engine light illuminated.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: 'Unmetered intake air leak downstream of MAF sensor (PCV hose or brake booster vacuum line)',
        detail:
          'Idle STFT+LTFT climbs above +24 % at 650 rpm and drops toward +5 % at 2,500 rpm.',
        targetSpec: 'Combined STFT + LTFT within -8 % to +10 % at idle and 2,500 rpm',
      },
      {
        likelihood: 'Primary',
        cause: 'Contaminated hot-wire Mass Air Flow (MAF) sensor element',
        detail:
          'Oil vapor or dust film insulates the MAF hot wire, under-reporting airflow by 15–20 %.',
        targetSpec: 'Warm idle MAF: 3.2–4.1 g/s @ 650 rpm',
      },
      {
        likelihood: 'Secondary',
        cause: '2GR-FKS D-4S port/direct injector low-load cleaning map',
        detail:
          'T-SB-0043-25 refines low-load port/direct split and cleans injector deposits.',
        targetSpec: 'ECM Calibration 89663-04B73-A0',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Load-Sweep Fuel Trim & MAF Differentiation Test',
        procedure:
          'Open Live Data, pin Short/Long Fuel Trim B1 and Mass Air Flow (g/s), then increase throttle demand to 30 % (~2,500 rpm).',
        expectedSpec: 'If trim drops sharply at 2,500 rpm -> vacuum leak. If trim worsens at 2,500 rpm -> MAF or fuel delivery.',
        recommendedTool: 'live',
      },
      {
        step: 2,
        title: 'Command +/- 12 % A/F Injection Volume Test',
        procedure:
          'Use Active Tests to force +10 % fuel enrichment and confirm wideband A/F sensor responds rich immediately.',
        expectedSpec: 'STFT responds opposite to commanded enrichment within 1.5 s.',
        recommendedTool: 'active',
      },
    ],
    relatedTsbs: [
      {
        tsbNumber: 'T-SB-0043-25',
        publishDate: '2026-05-19',
        appliesTo: '2016–2023 Toyota Tacoma 3.5L 2GR-FKS',
        title: '2GR-FKS D-4S Low-Load Fuel Metering & 6AT Shift Logic Calibration',
        summary:
          'Updates D-4S port/direct injection ratio during idle and light cruise to prevent lean tip-in hesitation.',
        repairProcedure: 'Smoke-test intake ducting, clean MAF sensor, and flash ECM to 89663-04B73-A0.',
        calibrationRef: '89663-04B73-A0',
        portalUrl: buildLemonTsbUrl(2020, 'Toyota', 'Tacoma'),
      },
    ],
  },
  {
    code: 'P175E',
    make: 'Volkswagen',
    modelPattern: 'Jetta',
    relatedModuleId: 'J743',
    title: 'DQ381 7-Speed DSG Clutch 1 Closes Unintentionally — Adaptation Required',
    severity: 'Moderate',
    settingCriteria:
      'Mechatronic J743 detects K1 clutch pressure feedback deviates from commanded valve N435 current during neutral idle.',
    drivabilityImpact:
      'Harsh 1–2 upshift or slight creep shudder at traffic stops.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: 'DQ381 Clutch K1 kiss-point drift after ATF service or mileage accumulation',
        detail:
          'Wet clutch pack wear requires updated touch-point pressure curve in J743 EEPROM.',
        targetSpec: 'K1 touch-point pressure: 2.1–2.8 bar @ 45–70 °C ATF',
      },
      {
        likelihood: 'Secondary',
        cause: 'DSG fluid level low or degraded Pentosin FFL-2/G 055 529',
        detail:
          'Verify ATF level at 35–45 °C overflow plug.',
        targetSpec: 'Line pressure 18–22 bar nominal',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Inspect J743 Mechatronic Wiring & ATF Temp Spec',
        procedure:
          'Check 14-pin J743 round connector wiring diagram in Module Library for Terminal 30/15 and CAN drive lines.',
        expectedSpec: '12.4+ V on pin 11 & 13; clean CAN termination.',
        recommendedTool: 'library',
      },
    ],
    relatedTsbs: [
      {
        tsbNumber: 'TT 37-25-02',
        publishDate: '2026-03-14',
        appliesTo: '2019–2023 VW Jetta GLI / GTI (DQ381 0GC)',
        title: 'DQ381 Mechatronic Clutch K1 Basic Setting & Engagement Shudder',
        summary:
          'Outlines mandatory warm-ATF kiss-point basic setting adaptation and mechatronic pressure sensor check.',
        repairProcedure: 'Verify ATF level at 40 °C, run J743 Basic Setting, and confirm smooth creep engagement.',
        portalUrl: buildLemonTsbUrl(2019, 'Volkswagen', 'Jetta'),
      },
    ],
  },
  {
    code: 'P050D',
    make: 'Chevrolet',
    modelPattern: 'Silverado',
    relatedModuleId: 'E92',
    title: 'Cold Start Rough Idle — L83 5.3L GDI Injector #7 Flow Balance',
    severity: 'Moderate',
    settingCriteria:
      'E92 ECM detects uneven cylinder rotational contribution within first 45 seconds of cold start (ECT < 30 °C).',
    drivabilityImpact:
      'Cold-start stumble and misfire feel for 20–40 seconds that smooths out once warm.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: 'GDI Injector #7 tip carbon restriction during cold multi-pulse stratification',
        detail:
          'Cold high-pressure split-pulse injection exposes even a 7 % flow restriction on a single cylinder.',
        targetSpec: 'Rail pressure decay during injector balance test <= 1.2 MPa delta between cylinders',
      },
      {
        likelihood: 'Secondary',
        cause: 'Outdated E92 cold-start stratification & VLOM purge map',
        detail:
          'PIP5612D recommends updating E92 ECM to 12694408-AE.',
        targetSpec: 'E92 calibration 12694408-AE',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Run V8 Cylinder Injector Balance Cutout',
        procedure:
          'Use Active Tests to individually cut injectors #1–#8 while monitoring Rail Pressure (MPa) and RPM drop.',
        expectedSpec: 'Cyl #7 shows reduced RPM drop compared to cylinders 1–6 & 8.',
        recommendedTool: 'active',
      },
      {
        step: 2,
        title: 'Update E92 Calibration to 12694408-AE',
        procedure:
          'Flash E92 ECM via J2534 Pass-Thru in ECU & Keys tab.',
        expectedSpec: 'Calibration ID reads 12694408-AE.',
        recommendedTool: 'programming',
      },
    ],
    relatedTsbs: [
      {
        tsbNumber: 'PIP5612D',
        publishDate: '2026-03-08',
        appliesTo: '2014–2018 Chevrolet Silverado / Sierra 5.3L L83',
        title: 'Cold Start Rough Idle DTC P050D & GDI Injector Flow Balance Inspection',
        summary:
          'Provides injector rail pressure drop test thresholds and latest E92 cold-start calibration update.',
        repairProcedure: 'Run GDI injector balance test, replace any injector outside 10 % tolerance, and flash 12694408-AE.',
        calibrationRef: '12694408-AE',
        portalUrl: buildLemonTsbUrl(2016, 'Chevrolet', 'Silverado'),
      },
    ],
  },
  // Generic SAE J2012 fallback entries for manual technician queries (P0300, P0420, U0100, P0128, P0456)
  {
    code: 'P0300',
    title: 'Random / Multiple Cylinder Misfire Detected (SAE J2012)',
    severity: 'High',
    settingCriteria:
      'Crankshaft acceleration variance exceeds emission or catalyst-damage limits across more than one cylinder.',
    drivabilityImpact: 'Rough idle, loss of power, flashing MIL under load.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: 'Global fuel mixture error (lean vacuum leak or low fuel rail pressure)',
        detail: 'Affects all cylinders simultaneously; check STFT + LTFT and high/low fuel pressure.',
        targetSpec: 'Combined fuel trim within ±10 %',
      },
      {
        likelihood: 'Secondary',
        cause: 'Worn spark plugs or secondary ignition supply voltage drop',
        detail: 'Inspect common ignition coil power relay and ground strap.',
        targetSpec: 'Coil B+ >= 13.2 V running',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Compare Fuel Trims & Rail Pressure in Live Data',
        procedure: 'Monitor STFT1, LTFT1, MAP, and Fuel Rail Pressure from idle to 2,500 rpm.',
        expectedSpec: 'Rail pressure meets target; trims stay within ±10 %.',
        recommendedTool: 'live',
      },
    ],
    relatedTsbs: [],
  },
  {
    code: 'P0420',
    title: 'Catalyst System Efficiency Below Threshold (Bank 1)',
    severity: 'Moderate',
    settingCriteria:
      'Downstream HO2S2 voltage switching amplitude mirrors upstream A/F sensor > 65 % of monitored oxygen-storage test cycle.',
    drivabilityImpact: 'No immediate drivability symptom; fails emissions readiness inspection.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: 'Degraded three-way catalytic converter washcoat oxygen storage',
        detail: 'Common after prolonged misfire (P030x) or oil consumption.',
        targetSpec: 'Downstream O2 steady 0.60–0.75 V at hot cruise',
      },
      {
        likelihood: 'Secondary',
        cause: 'Exhaust manifold or flex-pipe leak upstream of rear O2 sensor',
        detail: 'Fresh air aspiration causes false lean swings on rear sensor.',
        targetSpec: '0 exhaust leaks under cold smoke test',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Run Active Fuel Enrichment & Observe O2 Response',
        procedure: 'Verify upstream and downstream sensor responsiveness before condemning catalyst.',
        expectedSpec: 'Downstream sensor lags upstream by > 1.0 s during normal catalyst storage.',
        recommendedTool: 'active',
      },
    ],
    relatedTsbs: [],
  },
];

export function analyzeDtcForVehicle(
  rawCode: string,
  make: string,
  model: string,
  year: number
): DtcAnalysisResult {
  const code = rawCode.trim().toUpperCase();
  const normMake = make.trim().toLowerCase();
  const normModel = model.trim().toLowerCase();

  // 1. Exact vehicle-specific match
  const specific = DTC_KNOWLEDGE_BASE.find((e) => {
    if (e.code.toUpperCase() !== code) return false;
    if (!e.make) return false;
    if (e.make.toLowerCase() !== normMake) return false;
    if (e.modelPattern && !normModel.includes(e.modelPattern.toLowerCase())) return false;
    if (e.yearMin && year < e.yearMin) return false;
    if (e.yearMax && year > e.yearMax) return false;
    return true;
  });

  if (specific) {
    return {
      code,
      title: specific.title,
      vehicleMatch: `${year} ${make} ${model}`,
      matchScope: 'Vehicle-Specific OEM',
      severity: specific.severity,
      settingCriteria: specific.settingCriteria,
      drivabilityImpact: specific.drivabilityImpact,
      potentialCauses: specific.potentialCauses,
      diagnosticSteps: specific.diagnosticSteps,
      relatedTsbs: specific.relatedTsbs,
      relatedModuleId: specific.relatedModuleId,
    };
  }

  // 2. Generic SAE J2012 match
  const generic = DTC_KNOWLEDGE_BASE.find(
    (e) => e.code.toUpperCase() === code && !e.make
  );
  if (generic) {
    return {
      code,
      title: generic.title,
      vehicleMatch: `${year} ${make} ${model}`,
      matchScope: 'Generic SAE J2012',
      severity: generic.severity,
      settingCriteria: generic.settingCriteria,
      drivabilityImpact: generic.drivabilityImpact,
      potentialCauses: generic.potentialCauses,
      diagnosticSteps: generic.diagnosticSteps,
      relatedTsbs: [
        {
          tsbNumber: `${make.toUpperCase()} NHTSA Search`,
          publishDate: '2026-10-01',
          appliesTo: `${year} ${make} ${model}`,
          title: `Search OEM Manufacturer Communications & TSBs for ${code}`,
          summary: `Direct lookup for ${year} ${make} ${model} technical bulletins referencing ${code}.`,
          repairProcedure: 'Verify freeze-frame data and inspect related module pinouts in Module Library.',
          portalUrl: buildLemonTsbUrl(year, make, model),
        },
      ],
    };
  }

  // 3. Dynamic SAE J2012 prefix decoder for any arbitrary DTC code queried by technician
  const prefix = code.charAt(0);
  const systemDomain =
    prefix === 'P'
      ? 'Powertrain (Engine / Transmission)'
      : prefix === 'C'
        ? 'Chassis (ABS / Steering / Suspension)'
        : prefix === 'B'
          ? 'Body & Immobilizer (BCM / SRS / PATS)'
          : prefix === 'U'
            ? 'Network & CAN / LIN Bus Communication'
            : 'OEM Subsystem';

  return {
    code,
    title: `${systemDomain} Fault Code ${code}`,
    vehicleMatch: `${year} ${make} ${model}`,
    matchScope: 'Generic SAE J2012',
    severity: prefix === 'U' ? 'Advisory' : 'Moderate',
    settingCriteria: `Control module logged ${code} after exceeding OEM rationality or circuit continuity threshold.`,
    drivabilityImpact:
      prefix === 'P'
        ? 'May limit powertrain torque or illuminate MIL depending on drive-cycle confirmation.'
        : 'May disable affected subsystem assist or log gateway communication warning.',
    potentialCauses: [
      {
        likelihood: 'Primary',
        cause: `${systemDomain} sensor, actuator, or terminal contact resistance`,
        detail: `Inspect primary connector pinout and ground return for ${code} on ${year} ${make} ${model}.`,
        targetSpec: 'Circuit voltage drop < 0.2 V · Ground resistance < 0.5 Ω',
      },
      {
        likelihood: 'Secondary',
        cause: 'Supply voltage transient or harness chafing',
        detail: 'Verify Terminal 30 / 15 fuse feed stability under load.',
        targetSpec: 'Supply >= 12.4 V KOEO / 13.8–14.5 V KOER',
      },
    ],
    diagnosticSteps: [
      {
        step: 1,
        title: 'Inspect Module Pinouts & Wiring Schematic',
        procedure: `Open Vehicle Module Library for ${year} ${make} ${model} to verify power, ground, and signal pins.`,
        expectedSpec: 'All power and ground circuits within 0.2 V of battery potential.',
        recommendedTool: 'library',
      },
      {
        step: 2,
        title: 'Capture Live PID Data & Run Active Test',
        procedure: 'Compare live sensor signal against expected nominal range while commanding actuator.',
        expectedSpec: 'Signal tracks commanded change without dropouts.',
        recommendedTool: 'live',
      },
    ],
    relatedTsbs: [
      {
        tsbNumber: `OEM-COMM-${code}`,
        publishDate: '2026-10-15',
        appliesTo: `${year} ${make} ${model}`,
        title: `Manufacturer Service Communications Index for ${code}`,
        summary: `Query NHTSA & OEM service communication bulletins for ${year} ${make} ${model}.`,
        repairProcedure: 'Check latest J2534 module calibration updates in ECU & Keys tab before replacing hardware.',
        portalUrl: buildLemonTsbUrl(year, make, model),
      },
    ],
  };
}

// ============================================================================
// VEHICLE-SPECIFIC MODULE LIBRARY (Wiring Diagrams, Location Guides, Cal Files)
// ============================================================================

const MODULE_LIBRARY_RECORDS: ModuleLibraryRecord[] = [
  // --- 2023 Ford F-150 PowerBoost ---
  {
    id: 'lib-ford-pcm',
    vehicleId: 'ford-f150-2023',
    make: 'Ford',
    model: 'F-150 Lariat PowerBoost',
    year: 2023,
    engine: '3.5L EcoBoost Hybrid V6',
    moduleId: 'PCM',
    shortCode: 'PCM',
    moduleName: 'Powertrain Control Module (MG1CS036)',
    bus: 'FD-CAN',
    canTxId: '7E0',
    canRxId: '7E8',
    oemPartNumber: 'ML3A-12A650-GVA',
    connectorCode: 'C175B (Body 96-pin) & C175E (Engine 96-pin)',
    pinCount: 192,
    fuseFeed: 'BJB F21 (15A) & F34 (20A PCM Relay)',
    groundPoint: 'G104 (RH Firewall Stud M8)',
    location: {
      zone: 'Engine Bay · RH Cowl / Firewall',
      xPct: 68,
      yPct: 24,
      accessSummary:
        'Mounted vertically in a weather-sealed aluminum cradle on the passenger-side (RH) cowl bulkhead behind the coolant degas bottle.',
      mountingFasteners: '3x M6x1.0 captive nuts (Torque: 9 Nm / 80 lb-in)',
      removalSteps: [
        'Disconnect 12 V AGM negative terminal and verify Hybrid High-Voltage Service Disconnect is seated.',
        'Release cam-lock levers on C175B (upper) and C175E (lower) 96-pin Bosch connectors straight outward.',
        'Remove three 10 mm retaining nuts and lift PCM vertically out of cowl bracket.',
      ],
    },
    wiringCircuits: [
      {
        pin: 'C175B-01',
        wireColorCode: 'VT-OG',
        wireColorHex: '#9c4215',
        signalName: 'VPWR Switched Ignition Supply',
        circuitType: 'Power',
        connectedComponent: 'BJB PCM Power Relay (Fuse F34 20A)',
        testSpec: '12.4–14.5 V KOEO/KOER (< 0.15 V drop to B+)',
      },
      {
        pin: 'C175B-04',
        wireColorCode: 'BK-GY',
        wireColorHex: '#374151',
        signalName: 'PWRGND Chassis Ground',
        circuitType: 'Ground',
        connectedComponent: 'Ground Stud G104 (RH Firewall)',
        testSpec: '< 0.10 V drop to battery negative · < 0.5 Ω',
      },
      {
        pin: 'C175B-62',
        wireColorCode: 'WH-BU',
        wireColorHex: '#0f5e9c',
        signalName: 'FD-CAN1 High (+)',
        circuitType: 'CAN Bus',
        connectedComponent: 'Gateway Module A (GWM) & SOBDMC',
        testSpec: '2.55–3.45 V active · 60 Ω pair termination (key off)',
      },
      {
        pin: 'C175B-63',
        wireColorCode: 'WH',
        wireColorHex: '#4b5563',
        signalName: 'FD-CAN1 Low (-)',
        circuitType: 'CAN Bus',
        connectedComponent: 'Gateway Module A (GWM) & SOBDMC',
        testSpec: '1.55–2.45 V active · Mirror inverse of FD-CAN1+',
      },
      {
        pin: 'C175E-44',
        wireColorCode: 'BN-GN',
        wireColorHex: '#116b52',
        signalName: 'COP #4 Ignition Coil Trigger',
        circuitType: 'Actuator Output',
        connectedComponent: 'Cylinder #4 Coil-on-Plug (LH Bank Rear)',
        testSpec: '5.0 V square dwell pulse (1.8–2.6 ms @ idle)',
      },
      {
        pin: 'C175E-19',
        wireColorCode: 'YE-VT',
        wireColorHex: '#8c5a08',
        signalName: 'VCT11 Bank 1 Intake Solenoid PWM',
        circuitType: 'Actuator Output',
        connectedComponent: 'Bank 1 Intake VCT Oil Control Valve',
        testSpec: '12 V high-side / low-side 300 Hz PWM · Coil 7.2–11.4 Ω',
      },
      {
        pin: 'C175E-71',
        wireColorCode: 'BU-OG',
        wireColorHex: '#0d6775',
        signalName: 'CMP11 Intake Cam Hall Signal',
        circuitType: 'Sensor Input',
        connectedComponent: 'Bank 1 Intake Camshaft Position Sensor',
        testSpec: '0–5.0 V clean square wave (5 V ref on Pin 3)',
      },
    ],
    calibrationFiles: [
      {
        fileName: 'ML3A-14C204-EKD.vbf',
        format: 'Ford VBF (J2534-2)',
        version: 'ML3A-14C204-EKD',
        releaseDate: '2026-09-14',
        sizeKb: 4096,
        crc32Hex: '0x8FA4C219',
        sha256Short: '7a9f2d...84c1',
        tsbRef: 'TSB 24-2108',
        notes: 'Production calibration fixing P0304 hybrid transition misfire & Bank 1 VCT cleaning dither.',
        isLatest: true,
      },
      {
        fileName: 'ML3A-14C204-EJB.vbf',
        format: 'Ford VBF (J2534-2)',
        version: 'ML3A-14C204-EJB',
        releaseDate: '2024-11-02',
        sizeKb: 4064,
        crc32Hex: '0x31E09B12',
        sha256Short: '2b4e11...09aa',
        notes: 'Factory baseline software; superseded by -EKD.',
        isLatest: false,
      },
    ],
  },
  {
    id: 'lib-ford-bcm',
    vehicleId: 'ford-f150-2023',
    make: 'Ford',
    model: 'F-150 Lariat PowerBoost',
    year: 2023,
    engine: '3.5L EcoBoost Hybrid V6',
    moduleId: 'BCM',
    shortCode: 'BCM',
    moduleName: 'Body Control Module & PATS Immobilizer',
    bus: 'LIN / IMMO',
    canTxId: '726',
    canRxId: '72E',
    oemPartNumber: 'NL3T-15604-BJA',
    connectorCode: 'C2280A–C2280G (7-Connector Fuse Junction)',
    pinCount: 164,
    fuseFeed: 'BJB Mega-Fuse 60A Feed',
    groundPoint: 'G203 (RH Kick Panel A-Pillar)',
    location: {
      zone: 'Cabin · RH Passenger Kick Panel',
      xPct: 68,
      yPct: 54,
      accessSummary:
        'Integrated with the Interior Fuse Panel behind the passenger-side lower footwell trim cover.',
      mountingFasteners: '2x M6 flange bolts + upper snap bracket (Torque: 7 Nm)',
      removalSteps: [
        'Pull passenger sill scuff plate upward and remove RH kick panel fuse door.',
        'Record As-Built configuration before disconnecting C2280A–C2280G.',
        'Release upper plastic latch and unbolt two lower 10 mm grounds.',
      ],
    },
    wiringCircuits: [
      {
        pin: 'C2280C-01',
        wireColorCode: 'RD',
        wireColorHex: '#b93815',
        signalName: 'Battery B+ Bus Feed',
        circuitType: 'Power',
        connectedComponent: 'BJB High-Current Busbar (60A)',
        testSpec: '12.4 V constant',
      },
      {
        pin: 'C2280B-18',
        wireColorCode: 'GN-OG',
        wireColorHex: '#116b52',
        signalName: 'PATS LF Backup Transceiver Coil +',
        circuitType: 'Actuator Output',
        connectedComponent: 'Center Console Backup Fob Pocket Antenna',
        testSpec: '125 kHz LF burst during start button press',
      },
      {
        pin: 'C2280F-11',
        wireColorCode: 'GY-OG',
        wireColorHex: '#0f5e9c',
        signalName: 'MS-CAN High (+)',
        circuitType: 'CAN Bus',
        connectedComponent: 'Gateway Module A (GWM)',
        testSpec: '2.6–3.4 V active · 60 Ω off',
      },
      {
        pin: 'C2280G-03',
        wireColorCode: 'BK-YE',
        wireColorHex: '#374151',
        signalName: 'Logic Ground Return',
        circuitType: 'Ground',
        connectedComponent: 'G203 RH A-Pillar Stud',
        testSpec: '< 0.1 V drop to chassis',
      },
    ],
    calibrationFiles: [
      {
        fileName: 'NL3T-14C184-BKE.vbf',
        format: 'Ford VBF (J2534-2)',
        version: 'NL3T-14C184-BKE',
        releaseDate: '2026-08-03',
        sizeKb: 1536,
        crc32Hex: '0x41D90E7B',
        sha256Short: '9c12ab...f201',
        tsbRef: 'SSM 52194',
        notes: 'Extends PATS LF interrogation window for low-voltage smart fobs.',
        isLatest: true,
      },
    ],
  },
  {
    id: 'lib-ford-gwm',
    vehicleId: 'ford-f150-2023',
    make: 'Ford',
    model: 'F-150 Lariat PowerBoost',
    year: 2023,
    engine: '3.5L EcoBoost Hybrid V6',
    moduleId: 'GWM',
    shortCode: 'GWM',
    moduleName: 'Gateway Module A (DLC Network Router)',
    bus: 'HS-CAN',
    canTxId: '716',
    canRxId: '71E',
    oemPartNumber: 'ML3T-14F642-CF',
    connectorCode: 'C2431 (24-pin) & Direct DLC J1962',
    pinCount: 24,
    fuseFeed: 'BCM F15 (10A Constant)',
    groundPoint: 'G201 (LH Dash Brace)',
    location: {
      zone: 'Cabin · LH Driver Lower Knee Bolster',
      xPct: 33,
      yPct: 48,
      accessSummary:
        'Directly mounted above the OBD-II J1962 diagnostic port under the driver steering column knee bolster.',
      mountingFasteners: '2x M5 Torx T20 screws (Torque: 3.5 Nm)',
      removalSteps: [
        'Unclip lower driver steering column trim panel.',
        'Depress locking tab on 24-pin C2431 harness and unbolt GWM from OBD port bracket.',
      ],
    },
    wiringCircuits: [
      {
        pin: 'C2431-06',
        wireColorCode: 'BU-RD',
        wireColorHex: '#0f5e9c',
        signalName: 'DLC Pin 6 HS-CAN1 (+)',
        circuitType: 'CAN Bus',
        connectedComponent: 'OBD-II J1962 Pin 6',
        testSpec: '60 Ω differential across Pins 6 & 14',
      },
      {
        pin: 'C2431-14',
        wireColorCode: 'GN-WH',
        wireColorHex: '#116b52',
        signalName: 'DLC Pin 14 HS-CAN1 (-)',
        circuitType: 'CAN Bus',
        connectedComponent: 'OBD-II J1962 Pin 14',
        testSpec: '2.5 V nominal recessive',
      },
      {
        pin: 'C2431-01',
        wireColorCode: 'YE-RD',
        wireColorHex: '#b93815',
        signalName: 'B+ Constant Supply',
        circuitType: 'Power',
        connectedComponent: 'BCM Fuse F15 (10A)',
        testSpec: '12.4 V constant',
      },
    ],
    calibrationFiles: [
      {
        fileName: 'ML3T-14H021-CG.vbf',
        format: 'Ford VBF (J2534-2)',
        version: 'ML3T-14H021-CG',
        releaseDate: '2025-06-11',
        sizeKb: 1024,
        crc32Hex: '0x5A11D084',
        sha256Short: '44df90...19c3',
        notes: 'Current gateway routing firmware.',
        isLatest: true,
      },
    ],
  },

  // --- 2021 BMW 330i xDrive (G20) ---
  {
    id: 'lib-bmw-dme',
    vehicleId: 'bmw-330i-2021',
    make: 'BMW',
    model: '330i xDrive (G20)',
    year: 2021,
    engine: '2.0L TwinPower Turbo B46D',
    moduleId: 'DME',
    shortCode: 'DME',
    moduleName: 'Digital Motor Electronics (Bosch MG1CS201)',
    bus: 'FD-CAN',
    canTxId: '612',
    canRxId: '6F1',
    oemPartNumber: '8694512-03',
    connectorCode: 'X60001–X60006 (6-Bank Modular Harness)',
    pinCount: 230,
    fuseFeed: 'Engine Bay Power Distribution Box F02 (30A) & F04 (20A)',
    groundPoint: 'Z10*4B (LH Strut Tower Ground)',
    location: {
      zone: 'Engine Bay · LH Intake Manifold Cradle',
      xPct: 34,
      yPct: 26,
      accessSummary:
        'Mounted beneath the acoustic engine cover on the driver-side (LH) intake plenum support bracket.',
      mountingFasteners: 'Slide-lock vibration isolators + 2x E10 Torx bolts (8 Nm)',
      removalSteps: [
        'Pull engine acoustic cover upward off four ball studs.',
        'Disconnect negative battery cable in trunk battery well.',
        'Flip locking bails on X60001–X60006 sequentially and lift DME out of cradle.',
      ],
    },
    wiringCircuits: [
      {
        pin: 'X60004-12',
        wireColorCode: 'RT-WS',
        wireColorHex: '#b93815',
        signalName: 'Terminal 87 DME Main Relay Supply',
        circuitType: 'Power',
        connectedComponent: 'Integrated Supply Module F02',
        testSpec: '12.5–14.5 V KOEO/KOER',
      },
      {
        pin: 'X60004-03',
        wireColorCode: 'BR',
        wireColorHex: '#374151',
        signalName: 'Terminal 31 Main Ground',
        circuitType: 'Ground',
        connectedComponent: 'Chassis Ground Z10*4B',
        testSpec: '< 0.08 V drop',
      },
      {
        pin: 'X60002-19',
        wireColorCode: 'GE-SW',
        wireColorHex: '#8c5a08',
        signalName: 'Electric Wastegate Actuator Hall Pos',
        circuitType: 'Sensor Input',
        connectedComponent: 'Turbocharger Electronic Wastegate Unit',
        testSpec: '0.45 V closed stop · 4.25 V full open',
      },
      {
        pin: 'X60001-44',
        wireColorCode: 'BL-RT',
        wireColorHex: '#0f5e9c',
        signalName: 'PT-CAN2 High (+)',
        circuitType: 'CAN Bus',
        connectedComponent: 'BDC3 Gateway & EGS 8HP51',
        testSpec: '500 kbps · 60 Ω termination',
      },
    ],
    calibrationFiles: [
      {
        fileName: 'S18A-26-07-530_DME.bin',
        format: 'BMW ISTA/P DoIP Flash',
        version: 'S18A-26-07-530',
        releaseDate: '2026-07-22',
        sizeKb: 6144,
        crc32Hex: '0xB7204E1C',
        sha256Short: '8e22c0...31a8',
        tsbRef: 'SI B12 04 25',
        notes: 'Resolves P12A9 cold-start wastegate actuator end-stop drift.',
        isLatest: true,
      },
    ],
  },
  {
    id: 'lib-bmw-bdc',
    vehicleId: 'bmw-330i-2021',
    make: 'BMW',
    model: '330i xDrive (G20)',
    year: 2021,
    engine: '2.0L TwinPower Turbo B46D',
    moduleId: 'BDC',
    shortCode: 'BDC',
    moduleName: 'Body Domain Controller (BDC3) & Immobilizer',
    bus: 'HS-CAN',
    canTxId: '640',
    canRxId: '6F1',
    oemPartNumber: '9498112-07',
    connectorCode: 'A258*1B – A258*9B',
    pinCount: 188,
    fuseFeed: 'Front Power Distribution Box F31 (40A)',
    groundPoint: 'Z10*1B (RH A-Pillar Footwell)',
    location: {
      zone: 'Cabin · RH Passenger Footwell A-Pillar',
      xPct: 68,
      yPct: 52,
      accessSummary:
        'Located behind the passenger-side lower A-pillar trim panel ahead of the front door hinges.',
      mountingFasteners: '2x 10 mm plastic nuts + upper hook tab',
      removalSteps: [
        'Remove passenger door sill trim and lower under-dash cover.',
        'Disconnect A258*1B–9B connectors and slide BDC3 downward.',
      ],
    },
    wiringCircuits: [
      {
        pin: 'A258*8B-01',
        wireColorCode: 'RT',
        wireColorHex: '#b93815',
        signalName: 'Terminal 30 Constant Feed',
        circuitType: 'Power',
        connectedComponent: 'Front PDB F31',
        testSpec: '12.4+ V constant',
      },
      {
        pin: 'A258*4B-12',
        wireColorCode: 'OR-GN',
        wireColorHex: '#0f5e9c',
        signalName: 'DoIP Ethernet TX+ (Pin 3/12 DLC)',
        circuitType: 'CAN Bus',
        connectedComponent: 'OBD-II J1962 Ethernet Activation',
        testSpec: '100BASE-TX 100 Mbps flash link',
      },
    ],
    calibrationFiles: [
      {
        fileName: 'S18A-24-11-520_BDC3.bin',
        format: 'BMW ISTA/P DoIP Flash',
        version: 'S18A-24-11-520',
        releaseDate: '2024-11-18',
        sizeKb: 3072,
        crc32Hex: '0x1C88E402',
        sha256Short: '3f10a9...77b2',
        notes: 'Current factory gateway & ISN immobilizer image.',
        isLatest: true,
      },
    ],
  },

  // --- 2020 Toyota Tacoma TRD Off-Road ---
  {
    id: 'lib-toyota-ecm',
    vehicleId: 'toyota-tacoma-2020',
    make: 'Toyota',
    model: 'Tacoma TRD Off-Road',
    year: 2020,
    engine: '3.5L V6 D-4S (2GR-FKS)',
    moduleId: 'ECM',
    shortCode: 'ECM',
    moduleName: 'Engine & ECT Control Module (Denso)',
    bus: 'HS-CAN',
    canTxId: '7E0',
    canRxId: '7E8',
    oemPartNumber: '89661-04N10',
    connectorCode: 'E15 (Engine 64-pin) & A19 (Body 64-pin)',
    pinCount: 128,
    fuseFeed: 'EFI MAIN No.1 (20A) & IGN (10A)',
    groundPoint: 'E1 (Intake Plenum Ground)',
    location: {
      zone: 'Cabin · Behind RH Glove Box',
      xPct: 65,
      yPct: 45,
      accessSummary:
        'Mounted vertically inside the passenger cabin on a steel bracket directly behind the glove compartment.',
      mountingFasteners: '3x M6 bolts (Torque: 8.5 Nm)',
      removalSteps: [
        'Squeeze glove box stops inward to drop glove box door completely.',
        'Unplug E15 and A19 64-pin Denso connectors and remove three 10 mm bracket bolts.',
      ],
    },
    wiringCircuits: [
      {
        pin: 'A19-01',
        wireColorCode: 'B-R',
        wireColorHex: '#b93815',
        signalName: '+B EFI Main Relay Supply',
        circuitType: 'Power',
        connectedComponent: 'EFI MAIN Relay (Engine Bay Fuse Box)',
        testSpec: '12.4–14.2 V KOEO/KOER',
      },
      {
        pin: 'E15-28',
        wireColorCode: 'L-W',
        wireColorHex: '#0f5e9c',
        signalName: 'VG Mass Air Flow Signal',
        circuitType: 'Sensor Input',
        connectedComponent: 'MAF Meter Pin 3 (Air Cleaner Housing)',
        testSpec: '1.15–1.45 V @ warm idle (3.2–4.1 g/s)',
      },
      {
        pin: 'A19-41',
        wireColorCode: 'W',
        wireColorHex: '#116b52',
        signalName: 'CANH (500 kbps)',
        circuitType: 'CAN Bus',
        connectedComponent: 'Junction Connector A29 / DLC3 Pin 6',
        testSpec: '2.6–3.4 V active · 60 Ω off',
      },
      {
        pin: 'E15-03',
        wireColorCode: 'W-B',
        wireColorHex: '#374151',
        signalName: 'E1 Power Ground',
        circuitType: 'Ground',
        connectedComponent: 'RH Cylinder Head Ground Stud',
        testSpec: '< 0.1 V drop',
      },
    ],
    calibrationFiles: [
      {
        fileName: '89663-04B73-A0.cuw',
        format: 'Toyota Calibration Update Wizard (.cuw)',
        version: '89663-04B73-A0',
        releaseDate: '2026-05-19',
        sizeKb: 2560,
        crc32Hex: '0x6E319A04',
        sha256Short: 'c840b1...52d9',
        tsbRef: 'T-SB-0043-25',
        notes: 'Updates 2GR-FKS D-4S fuel split and 6AT torque converter lockup curve.',
        isLatest: true,
      },
    ],
  },

  // --- 2019 Volkswagen Jetta GLI ---
  {
    id: 'lib-vw-j623',
    vehicleId: 'vw-gli-2019',
    make: 'Volkswagen',
    model: 'Jetta GLI Autobahn',
    year: 2019,
    engine: '2.0T TSI EA888 Gen3B (DKFA)',
    moduleId: 'J623',
    shortCode: '01-ECM',
    moduleName: 'Simos 18.10 Engine Control Unit (J623)',
    bus: 'HS-CAN',
    canTxId: '7E0',
    canRxId: '7E8',
    oemPartNumber: '5G0-906-259-Q',
    connectorCode: 'T105 (Engine 105-pin) & T91 (Chassis 91-pin)',
    pinCount: 196,
    fuseFeed: 'E-Box SB10 (30A) & J271 Motronic Relay',
    groundPoint: '607 (LH Plenum Chamber Ground)',
    location: {
      zone: 'Engine Bay · LH Side Next to Battery',
      xPct: 31,
      yPct: 28,
      accessSummary:
        'Slotted into a vertical composite cradle between the 12 V battery tray and LH fender apron.',
      mountingFasteners: 'Anti-theft shear cage + spring retaining clip',
      removalSteps: [
        'Release battery box cover and slide retaining tab on J623 cradle.',
        'Slide T105 and T91 locking levers toward fender to eject connectors.',
      ],
    },
    wiringCircuits: [
      {
        pin: 'T91-03',
        wireColorCode: 'RD-YE',
        wireColorHex: '#b93815',
        signalName: 'Terminal 87 J271 Supply',
        circuitType: 'Power',
        connectedComponent: 'E-Box Relay J271',
        testSpec: '12.4+ V KOEO',
      },
      {
        pin: 'T91-67',
        wireColorCode: 'OR-BK',
        wireColorHex: '#0f5e9c',
        signalName: 'Powertrain CAN High (+)',
        circuitType: 'CAN Bus',
        connectedComponent: 'J533 Data Bus Gateway',
        testSpec: '500 kbps · 60 Ω',
      },
      {
        pin: 'T105-22',
        wireColorCode: 'BU-GN',
        wireColorHex: '#116b52',
        signalName: 'J338 EPC Throttle Motor Drive',
        circuitType: 'Actuator Output',
        connectedComponent: 'Throttle Valve Control Module J338',
        testSpec: 'H-Bridge PWM 12 V',
      },
    ],
    calibrationFiles: [
      {
        fileName: 'FL_5G0906259Q__SC800Q65.frf',
        format: 'VW ODIS Flash Container (.frf)',
        version: 'SC800Q6500000',
        releaseDate: '2026-04-11',
        sizeKb: 4608,
        crc32Hex: '0x2C9A803E',
        sha256Short: '55ab10...e891',
        tsbRef: 'TT 01-25-03',
        notes: 'Cold idle misfire threshold & MPI/DI pressure damping.',
        isLatest: true,
      },
    ],
  },
  {
    id: 'lib-vw-j743',
    vehicleId: 'vw-gli-2019',
    make: 'Volkswagen',
    model: 'Jetta GLI Autobahn',
    year: 2019,
    engine: '2.0T TSI EA888 Gen3B (DKFA)',
    moduleId: 'J743',
    shortCode: '02-DSG',
    moduleName: 'DQ381 7-Speed DSG Mechatronic (J743)',
    bus: 'HS-CAN',
    canTxId: '7E1',
    canRxId: '7E9',
    oemPartNumber: '0GC-300-042-H',
    connectorCode: 'T14q (14-pin Bayonet Twist-Lock)',
    pinCount: 14,
    fuseFeed: 'SB14 (30A Transmission)',
    groundPoint: '655 (LH Transmission Case Lug)',
    location: {
      zone: 'Engine Bay / Lower · Front of DSG Transmission',
      xPct: 45,
      yPct: 33,
      accessSummary:
        'Bolted internally behind the black stamped front valve-body cover on the 0GC transmission housing.',
      mountingFasteners: '10x M6 T30 bolts (Torque: 10 Nm + 90°)',
      removalSteps: [
        'Drain 6.0 L DSG fluid and remove battery tray for upper T14q connector access.',
        'Twist T14q bayonet collar counter-clockwise before unbolting valve body cover.',
      ],
    },
    wiringCircuits: [
      {
        pin: 'T14q-11',
        wireColorCode: 'RD-BU',
        wireColorHex: '#b93815',
        signalName: 'Terminal 30 Mechatronic Pump Power',
        circuitType: 'Power',
        connectedComponent: 'Fuse SB14 (30A)',
        testSpec: '12.4+ V constant',
      },
      {
        pin: 'T14q-09',
        wireColorCode: 'OR-BK',
        wireColorHex: '#0f5e9c',
        signalName: 'Drivetrain CAN High (+)',
        circuitType: 'CAN Bus',
        connectedComponent: 'J533 Gateway',
        testSpec: '2.5–3.5 V active',
      },
      {
        pin: 'T14q-14',
        wireColorCode: 'BR',
        wireColorHex: '#374151',
        signalName: 'Terminal 31 Ground',
        circuitType: 'Ground',
        connectedComponent: 'Transmission Case Stud 655',
        testSpec: '< 0.1 V drop',
      },
    ],
    calibrationFiles: [
      {
        fileName: 'FL_0GC300042H_2408.frf',
        format: 'VW ODIS Flash Container (.frf)',
        version: '2408',
        releaseDate: '2025-01-20',
        sizeKb: 2048,
        crc32Hex: '0x7102BC49',
        sha256Short: '19ef04...8c21',
        tsbRef: 'TT 37-25-02',
        notes: 'DQ381 clutch K1/K2 hydraulic pressure map.',
        isLatest: true,
      },
    ],
  },

  // --- 2016 Chevrolet Silverado 1500 ---
  {
    id: 'lib-gm-e92',
    vehicleId: 'chevy-silverado-2016',
    make: 'Chevrolet',
    model: 'Silverado 1500 LTZ Z71',
    year: 2016,
    engine: '5.3L EcoTec3 V8 (L83)',
    moduleId: 'E92',
    shortCode: 'E92-ECM',
    moduleName: 'E92 Direct Injection Engine Control Module',
    bus: 'HS-CAN',
    canTxId: '7E0',
    canRxId: '7E8',
    oemPartNumber: '12672537',
    connectorCode: 'X1 (Black 73-pin), X2 (Blue 73-pin), X3 (Gray 73-pin)',
    pinCount: 219,
    fuseFeed: 'UBEC F43 (20A) & F52 (15A)',
    groundPoint: 'G103 (LH Cylinder Block Front)',
    location: {
      zone: 'Engine Bay · LH Inner Fender Under Coolant Tank',
      xPct: 29,
      yPct: 24,
      accessSummary:
        'Secured inside a vertical aluminum bracket on the driver-side inner wheelhouse below the airbox / surge tank.',
      mountingFasteners: '2x M6 bolts (Torque: 9 Nm)',
      removalSteps: [
        'Remove air intake duct and loosen coolant surge tank for clearance.',
        'Unlock X1, X2, and X3 cam levers and slide E92 upward.',
      ],
    },
    wiringCircuits: [
      {
        pin: 'X1-01',
        wireColorCode: 'RD-WH',
        wireColorHex: '#b93815',
        signalName: 'Battery Positive Voltage',
        circuitType: 'Power',
        connectedComponent: 'Underhood Fuse F43 (20A)',
        testSpec: '12.4+ V constant',
      },
      {
        pin: 'X1-52',
        wireColorCode: 'BU',
        wireColorHex: '#0f5e9c',
        signalName: 'High-Speed GMLAN Serial Data (+)',
        circuitType: 'CAN Bus',
        connectedComponent: 'DLC Pin 6 & T87 TCM',
        testSpec: '500 kbps · 60 Ω across X1-52/53',
      },
      {
        pin: 'X2-14',
        wireColorCode: 'TN-WH',
        wireColorHex: '#8c5a08',
        signalName: 'GDI Injector #7 High-Voltage Boost Control',
        circuitType: 'Actuator Output',
        connectedComponent: 'Cylinder #7 Direct Injector (65 V Peak)',
        testSpec: '65 V peak / 12 V hold · Coil 1.5–2.2 Ω',
      },
    ],
    calibrationFiles: [
      {
        fileName: '12694408-AE_OS.bin',
        format: 'GM SPS2 / TIS2Web J2534',
        version: '12694408-AE',
        releaseDate: '2026-03-08',
        sizeKb: 3072,
        crc32Hex: '0x99F14A20',
        sha256Short: 'a177bc...40e2',
        tsbRef: 'PIP5612D',
        notes: 'Cold-start GDI stratification & VLOM purge timing.',
        isLatest: true,
      },
    ],
  },
];

// VIN 10th-digit Model Year lookup (ISO 3779)
const VIN_YEAR_MAP: Record<string, number> = {
  G: 2016,
  H: 2017,
  J: 2018,
  K: 2019,
  L: 2020,
  M: 2021,
  N: 2022,
  P: 2023,
  R: 2024,
  S: 2025,
  T: 2026,
};

export function lookupModuleLibrary(params: {
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
}): ModuleLibraryLookupResponse {
  const rawVin = (params.vin || '').trim().toUpperCase();

  if (rawVin.length >= 3) {
    // 1. Exact VIN match
    const exactVeh = VEHICLE_PROFILES.find((v) => v.vin.toUpperCase() === rawVin);
    if (exactVeh) {
      return {
        queryMode: 'vin',
        decodedVinInfo: {
          vin: rawVin,
          wmiRegion: `${exactVeh.make} North America / OEM WMI (${rawVin.slice(0, 3)})`,
          modelYear: exactVeh.year,
          platformMatchNote: 'Exact VIN chassis calibration & wiring match verified.',
        },
        vehicle: {
          id: exactVeh.id,
          year: exactVeh.year,
          make: exactVeh.make,
          model: exactVeh.model,
          engine: exactVeh.trimEngine,
          vinSample: exactVeh.vin,
          protocolLabel: exactVeh.protocolLabel,
        },
        modules: MODULE_LIBRARY_RECORDS.filter((m) => m.vehicleId === exactVeh.id),
      };
    }

    // 2. WMI prefix match (1FT = Ford, 3MW = BMW, 5TF = Toyota, 3VW = VW, 3GC = Chevrolet)
    const wmi = rawVin.slice(0, 3);
    const yearChar = rawVin.length >= 10 ? rawVin[9] : '';
    const decodedYear = VIN_YEAR_MAP[yearChar] ?? null;

    let inferredMake = 'Ford';
    if (wmi.startsWith('3MW') || wmi.startsWith('WBA')) inferredMake = 'BMW';
    else if (wmi.startsWith('5TF') || wmi.startsWith('JTD')) inferredMake = 'Toyota';
    else if (wmi.startsWith('3VW') || wmi.startsWith('WVW')) inferredMake = 'Volkswagen';
    else if (wmi.startsWith('3GC') || wmi.startsWith('1GC')) inferredMake = 'Chevrolet';

    const matchedVeh =
      VEHICLE_PROFILES.find((v) => v.make.toLowerCase() === inferredMake.toLowerCase()) ||
      VEHICLE_PROFILES[0];

    return {
      queryMode: 'vin',
      decodedVinInfo: {
        vin: rawVin,
        wmiRegion: `WMI ${wmi} -> ${matchedVeh.make} Platform`,
        modelYear: decodedYear ?? matchedVeh.year,
        platformMatchNote: `Decoded WMI (${wmi}) and Model Year (${
          decodedYear ?? matchedVeh.year
        }) to ${matchedVeh.make} ${matchedVeh.model} architecture.`,
      },
      vehicle: {
        id: matchedVeh.id,
        year: decodedYear ?? matchedVeh.year,
        make: matchedVeh.make,
        model: matchedVeh.model,
        engine: matchedVeh.trimEngine,
        vinSample: rawVin,
        protocolLabel: matchedVeh.protocolLabel,
      },
      modules: MODULE_LIBRARY_RECORDS.filter((m) => m.vehicleId === matchedVeh.id),
    };
  }

  // Manual Make / Model / Year lookup
  const normMake = (params.make || '').trim().toLowerCase();
  const normModel = (params.model || '').trim().toLowerCase();

  const manualVeh =
    VEHICLE_PROFILES.find((v) => {
      if (normMake && v.make.toLowerCase() !== normMake) return false;
      if (normModel && !v.model.toLowerCase().includes(normModel)) return false;
      return true;
    }) || VEHICLE_PROFILES[0];

  return {
    queryMode: 'manual',
    vehicle: {
      id: manualVeh.id,
      year: params.year || manualVeh.year,
      make: manualVeh.make,
      model: manualVeh.model,
      engine: manualVeh.trimEngine,
      vinSample: manualVeh.vin,
      protocolLabel: manualVeh.protocolLabel,
    },
    modules: MODULE_LIBRARY_RECORDS.filter((m) => m.vehicleId === manualVeh.id),
  };
}
