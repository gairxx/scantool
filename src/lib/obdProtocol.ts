import type { ObdProtocolId, PidDefinition } from '../types/diagnostic';

export const PROTOCOL_OPTIONS: Array<{
  id: ObdProtocolId;
  elmAtsp: string;
  label: string;
  baudLabel: string;
}> = [
  {
    id: 'AUTO',
    elmAtsp: 'ATSP0',
    label: 'Auto-Negotiate OBD-II / UDS',
    baudLabel: 'Adaptive',
  },
  {
    id: 'ISO_15765_4_CAN_FD',
    elmAtsp: 'ATSP6',
    label: 'ISO 15765-4 CAN FD (J2534-2)',
    baudLabel: '500k / 2000k bps',
  },
  {
    id: 'ISO_15765_4_CAN_11B_500K',
    elmAtsp: 'ATSP6',
    label: 'ISO 15765-4 CAN (11-bit ID)',
    baudLabel: '500 kbps',
  },
  {
    id: 'DOIP_ISO_13400',
    elmAtsp: 'ATSP6',
    label: 'DoIP ISO 13400 Ethernet + HS-CAN',
    baudLabel: '100 Mbps / 500k',
  },
  {
    id: 'ISO_14230_4_KWP2000',
    elmAtsp: 'ATSP5',
    label: 'ISO 14230-4 KWP2000 Fast Init',
    baudLabel: '10.4 kbps',
  },
  {
    id: 'SAE_J1850_VPW',
    elmAtsp: 'ATSP2',
    label: 'SAE J1850 VPW (GM Class 2)',
    baudLabel: '10.4 kbps',
  },
  {
    id: 'SAE_J1850_PWM',
    elmAtsp: 'ATSP1',
    label: 'SAE J1850 PWM (Ford SCP)',
    baudLabel: '41.6 kbps',
  },
  {
    id: 'ISO_9141_2',
    elmAtsp: 'ATSP3',
    label: 'ISO 9141-2 (5-Baud Init)',
    baudLabel: '10.4 kbps',
  },
];

export const STANDARD_PIDS: PidDefinition[] = [
  {
    id: 'rpm',
    modePid: '010C',
    shortLabel: 'Engine speed',
    name: 'Engine Rotational Speed (SAE PID $0C)',
    description: 'Crankshaft angular speed resolved at 0.25 rpm/bit over HS-CAN',
    unit: 'rpm',
    min: 0,
    max: 6500,
    nominalMin: 600,
    nominalMax: 3200,
    decimals: 0,
    traceColorVar: 'var(--color-trace-1)',
    category: 'Engine',
  },
  {
    id: 'map',
    modePid: '010B',
    shortLabel: 'Manifold pressure',
    name: 'Intake Manifold Absolute Pressure (SAE PID $0B)',
    description: 'Absolute intake plenum pressure in kilopascals (1 kPa/bit)',
    unit: 'kPa',
    min: 15,
    max: 255,
    nominalMin: 28,
    nominalMax: 185,
    decimals: 0,
    traceColorVar: 'var(--color-trace-2)',
    category: 'Fuel & Air',
  },
  {
    id: 'stft1',
    modePid: '0106',
    shortLabel: 'Short fuel trim B1',
    name: 'Short Term Fuel Trim — Bank 1 (SAE PID $06)',
    description: 'Closed-loop stoichiometric lambda feedback correction ((A - 128) * 100 / 128)',
    unit: '%',
    min: -25,
    max: 25,
    nominalMin: -8,
    nominalMax: 8,
    decimals: 1,
    traceColorVar: 'var(--color-trace-3)',
    category: 'Fuel & Air',
  },
  {
    id: 'ltft1',
    modePid: '0107',
    shortLabel: 'Long fuel trim B1',
    name: 'Long Term Fuel Trim — Bank 1 (SAE PID $07)',
    description: 'Learned adaptive fuel delivery trim stored in KAM',
    unit: '%',
    min: -25,
    max: 25,
    nominalMin: -10,
    nominalMax: 10,
    decimals: 1,
    traceColorVar: 'var(--color-trace-4)',
    category: 'Fuel & Air',
  },
  {
    id: 'ect',
    modePid: '0105',
    shortLabel: 'Coolant temp',
    name: 'Engine Coolant Temperature (SAE PID $05)',
    description: 'Cylinder head coolant thermistor reading (A - 40 °C)',
    unit: '°C',
    min: -20,
    max: 135,
    nominalMin: 80,
    nominalMax: 105,
    decimals: 0,
    traceColorVar: 'var(--color-trace-5)',
    category: 'Engine',
  },
  {
    id: 'vct_in',
    modePid: '220318',
    shortLabel: 'Intake cam angle',
    name: 'Intake Camshaft Phaser Actual Angle Bank 1 (UDS $22 0318)',
    description: 'Measured intake VCT phaser advance in crank degrees',
    unit: '°CA',
    min: -5,
    max: 55,
    nominalMin: 0,
    nominalMax: 45,
    decimals: 1,
    traceColorVar: 'var(--color-trace-6)',
    category: 'Valvetrain & Boost',
  },
  {
    id: 'throttle',
    modePid: '0111',
    shortLabel: 'Throttle plate',
    name: 'Absolute Throttle Position Sensor A (SAE PID $11)',
    description: 'Electronic throttle body blade angle (A * 100 / 255)',
    unit: '%',
    min: 0,
    max: 100,
    nominalMin: 8,
    nominalMax: 88,
    decimals: 1,
    traceColorVar: 'var(--color-trace-7)',
    category: 'Fuel & Air',
  },
  {
    id: 'vpwr',
    modePid: '0142',
    shortLabel: 'Module voltage',
    name: 'Control Module Supply Voltage (SAE PID $42)',
    description: 'PCM terminal 30 supply potential ((256*A + B) / 1000 V)',
    unit: 'V',
    min: 9.0,
    max: 16.5,
    nominalMin: 12.2,
    nominalMax: 14.8,
    decimals: 2,
    traceColorVar: 'var(--color-trace-8)',
    category: 'Electrical & Chassis',
  },
  {
    id: 'maf',
    modePid: '0110',
    shortLabel: 'Mass air flow',
    name: 'Mass Air Flow Sensor Rate (SAE PID $10)',
    description: 'Hot-wire intake mass air flow ((256*A + B) / 100 g/s)',
    unit: 'g/s',
    min: 0,
    max: 260,
    nominalMin: 2.5,
    nominalMax: 190,
    decimals: 1,
    traceColorVar: 'var(--color-trace-2)',
    category: 'Fuel & Air',
  },
  {
    id: 'spark',
    modePid: '010E',
    shortLabel: 'Timing advance',
    name: 'Ignition Timing Advance Cyl #1 (SAE PID $0E)',
    description: 'Spark advance relative to TDC (A / 2 - 64 °BTDC)',
    unit: '°BTDC',
    min: -15,
    max: 50,
    nominalMin: 4,
    nominalMax: 38,
    decimals: 1,
    traceColorVar: 'var(--color-trace-1)',
    category: 'Engine',
  },
  {
    id: 'rail_mpa',
    modePid: '0123',
    shortLabel: 'Fuel rail press',
    name: 'Direct Injection Fuel Rail Gauge Pressure (SAE PID $23)',
    description: 'High-pressure GDI rail transducer in megapascals',
    unit: 'MPa',
    min: 0,
    max: 30,
    nominalMin: 3.2,
    nominalMax: 22.5,
    decimals: 2,
    traceColorVar: 'var(--color-trace-3)',
    category: 'Fuel & Air',
  },
  {
    id: 'misfire_c4',
    modePid: '221204',
    shortLabel: 'Cyl 4 misfires',
    name: 'EWMA Misfire Events Cylinder #4 (Mode $06 / UDS $22 1204)',
    description: 'Crankshaft acceleration drop events in current 1,000-rev window',
    unit: 'cnt',
    min: 0,
    max: 120,
    nominalMin: 0,
    nominalMax: 2,
    decimals: 0,
    traceColorVar: 'var(--color-trace-1)',
    category: 'Engine',
  },
  {
    id: 'fan_duty',
    modePid: '22091F',
    shortLabel: 'Cooling fan PWM',
    name: 'Radiator Cooling Fan Commanded Duty (UDS $22 091F)',
    description: 'Brushless fan controller PWM command percentage',
    unit: '%',
    min: 0,
    max: 100,
    nominalMin: 0,
    nominalMax: 95,
    decimals: 0,
    traceColorVar: 'var(--color-trace-5)',
    category: 'Electrical & Chassis',
  },
  {
    id: 'evap_pa',
    modePid: '0132',
    shortLabel: 'Tank vapor press',
    name: 'EVAP System Vapor Pressure (SAE PID $32)',
    description: 'Differential fuel tank pressure transducer in pascals',
    unit: 'Pa',
    min: -1500,
    max: 1500,
    nominalMin: -450,
    nominalMax: 450,
    decimals: 0,
    traceColorVar: 'var(--color-trace-6)',
    category: 'Electrical & Chassis',
  },
];

/**
 * Pure SAE J1979 OBD-II Mode $01 hex payload decoder.
 *
 * Verified Textbook Reference Cases (SAE J1979 / ISO 15031-5):
 * 1. Known Case — PID $0C (Engine RPM):
 *    Formula: ((256 * A) + B) / 4
 *    Input hex bytes: A = 0x1A (26), B = 0xF8 (248) -> ((256 * 26) + 248) / 4 = 6904 / 4 = 1726.0 rpm.
 * 2. Known Case — PID $05 (Coolant Temp):
 *    Formula: A - 40 °C
 *    Input hex byte: A = 0x81 (129) -> 129 - 40 = 89 °C.
 * 3. Invariant — PID $06 (Short Term Fuel Trim):
 *    Center byte A = 0x80 (128) MUST decode to exactly 0.0 % trim, and bounds [0x00, 0xFF] stay within [-100%, +99.22%].
 */
export function decodeSaeJ1979Pid(pidHex: string, bytes: number[]): number | null {
  const normalized = pidHex.trim().toUpperCase();
  const a = bytes[0];
  const b = bytes[1];

  switch (normalized) {
    case '010C':
    case '0C': {
      if (a === undefined || b === undefined) return null;
      return (256 * a + b) / 4;
    }
    case '0105':
    case '05': {
      if (a === undefined) return null;
      return a - 40;
    }
    case '010B':
    case '0B': {
      if (a === undefined) return null;
      return a;
    }
    case '0106':
    case '06':
    case '0107':
    case '07': {
      if (a === undefined) return null;
      return ((a - 128) * 100) / 128;
    }
    case '0111':
    case '11': {
      if (a === undefined) return null;
      return (a * 100) / 255;
    }
    case '0142':
    case '42': {
      if (a === undefined || b === undefined) return null;
      return (256 * a + b) / 1000;
    }
    case '0110':
    case '10': {
      if (a === undefined || b === undefined) return null;
      return (256 * a + b) / 100;
    }
    case '010E':
    case '0E': {
      if (a === undefined) return null;
      return a / 2 - 64;
    }
    default:
      return null;
  }
}

/**
 * Encodes a numeric physical value into an ISO 15765-4 CAN 8-byte response frame
 * for transparent protocol inspection.
 */
export function encodeCanResponseFrame(
  rxCanId: string,
  modePid: string,
  physicalValue: number
): string {
  const clean = modePid.toUpperCase();
  const bytes: number[] = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];

  if (clean === '010C') {
    const raw = Math.max(0, Math.min(65535, Math.round(physicalValue * 4)));
    bytes[0] = 0x04;
    bytes[1] = 0x41;
    bytes[2] = 0x0c;
    bytes[3] = (raw >> 8) & 0xff;
    bytes[4] = raw & 0xff;
  } else if (clean === '0105') {
    const raw = Math.max(0, Math.min(255, Math.round(physicalValue + 40)));
    bytes[0] = 0x03;
    bytes[1] = 0x41;
    bytes[2] = 0x05;
    bytes[3] = raw;
  } else if (clean === '0106' || clean === '0107') {
    const raw = Math.max(0, Math.min(255, Math.round((physicalValue * 128) / 100 + 128)));
    bytes[0] = 0x03;
    bytes[1] = 0x41;
    bytes[2] = clean === '0106' ? 0x06 : 0x07;
    bytes[3] = raw;
  } else if (clean === '0142') {
    const raw = Math.max(0, Math.min(65535, Math.round(physicalValue * 1000)));
    bytes[0] = 0x04;
    bytes[1] = 0x41;
    bytes[2] = 0x42;
    bytes[3] = (raw >> 8) & 0xff;
    bytes[4] = raw & 0xff;
  } else {
    const scaled = Math.max(0, Math.min(65535, Math.round(Math.abs(physicalValue) * 10)));
    bytes[0] = 0x05;
    bytes[1] = 0x62;
    bytes[2] = parseInt(clean.slice(2, 4) || '03', 16) & 0xff;
    bytes[3] = parseInt(clean.slice(4, 6) || '18', 16) & 0xff;
    bytes[4] = (scaled >> 8) & 0xff;
    bytes[5] = scaled & 0xff;
  }

  return `${rxCanId}  ${bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`;
}

/**
 * Self-check assertion run once at module load to guarantee SAE J1979 math fidelity:
 * - 0x1A 0xF8 -> 1726 rpm
 * - 0x80 -> 0.0 % fuel trim
 */
const _rpmKnownCheck = decodeSaeJ1979Pid('010C', [0x1a, 0xf8]);
const _trimInvariantCheck = decodeSaeJ1979Pid('0106', [0x80]);
if (_rpmKnownCheck !== 1726 || _trimInvariantCheck !== 0) {
  console.error('SAE J1979 decoder invariant failure', { _rpmKnownCheck, _trimInvariantCheck });
}
