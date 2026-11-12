import { STANDARD_PIDS } from './obdProtocol';
import type { IgnitionState, VehicleProfile } from '../types/diagnostic';

export const RING_CAPACITY = 600; // 600 samples per PID channel

export interface TelemetryOverrides {
  ignitionState: IgnitionState;
  simulatedThrottleDemandPct: number; // 0 - 80% load test
  cutoutCylinder: number | null; // 1..8
  vctDutyOverridePct: number | null; // 0..80%
  etcPlateOverridePct: number | null; // 8..95%
  fanPwmOverridePct: number | null; // 0..100%
  fuelTrimInjectionDeltaPct: number | null; // -12..+12%
  evapSealActive: boolean;
  maintainerVoltageSet: number | null; // 11.8..14.4 V
  faultInjectionMisfire: boolean;
  highLoadStressBurst: boolean;
}

export interface ChannelStats {
  latest: number;
  min: number;
  max: number;
}

export class TelemetryRingStore {
  public readonly capacity = RING_CAPACITY;
  public timestamps = new Float64Array(RING_CAPACITY);
  public channels: Record<string, Float64Array> = {};
  public stats: Record<string, ChannelStats> = {};
  public head = 0;
  public count = 0;
  public totalFramesProcessed = 0;
  public framesPerSecond = 0;

  private fpsCounter = 0;
  private lastFpsWindowMs = performance.now();
  private ectState = 89.0;
  private evapState = -35.0;

  constructor() {
    for (const pid of STANDARD_PIDS) {
      this.channels[pid.id] = new Float64Array(RING_CAPACITY);
      this.stats[pid.id] = {
        latest: 0,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
      };
    }
  }

  public resetForVehicle(vehicle: VehicleProfile, overrides: TelemetryOverrides): void {
    this.head = 0;
    this.count = 0;
    this.ectState = 88.5;
    this.evapState = -30.0;
    for (const pid of STANDARD_PIDS) {
      this.channels[pid.id].fill(0);
      this.stats[pid.id] = {
        latest: 0,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
      };
    }
    // Pre-seed 160 samples so the oscilloscope opens mid-session with rich live history
    const nowSec = performance.now() / 1000;
    for (let i = 160; i >= 1; i--) {
      this.stepSample(nowSec - i * 0.05, vehicle, overrides, false);
    }
  }

  public stepSample(
    timeSec: number,
    vehicle: VehicleProfile,
    overrides: TelemetryOverrides,
    countThroughput = true
  ): void {
    const idx = this.head;
    this.timestamps[idx] = timeSec;

    const isKoer = overrides.ignitionState === 'KOER';
    const pedal = isKoer ? overrides.simulatedThrottleDemandPct : 0;
    const harmonic = Math.sin(timeSec * 3.7) * 6 + Math.cos(timeSec * 9.3) * 3.5;

    // cylinder misfire signature (e.g. Ford F-150 P0304 or manual fault trigger)
    const hasF150Misfire = vehicle.id === 'ford-f150-2023' || overrides.faultInjectionMisfire;

    // RPM physics
    let rpm = 0;
    if (isKoer) {
      rpm = vehicle.idleRpmTarget + pedal * 44 + harmonic;
      if (overrides.cutoutCylinder !== null) {
        // Weak cylinder #4 on F-150 drops only ~32 rpm when cut; healthy cylinder drops ~95 rpm!
        const isWeakCyl =
          (vehicle.id === 'ford-f150-2023' && overrides.cutoutCylinder === 4) ||
          (vehicle.id === 'chevy-silverado-2016' && overrides.cutoutCylinder === 7);
        rpm -= isWeakCyl ? 32 : 96;
        rpm += Math.sin(timeSec * 19) * 14;
      } else if (hasF150Misfire) {
        // Intermittent stumble every ~1.8s
        const stumble = Math.sin(timeSec * 3.4) > 0.82 ? -38 : 0;
        rpm += stumble;
      }
      if (overrides.vctDutyOverridePct !== null && overrides.vctDutyOverridePct > 45 && pedal < 10) {
        rpm -= (overrides.vctDutyOverridePct - 45) * 2.4;
      }
      rpm = Math.max(380, Math.min(6200, rpm));
    }

    // Throttle plate (%)
    const throttle =
      overrides.etcPlateOverridePct !== null && !isKoer
        ? overrides.etcPlateOverridePct + Math.sin(timeSec * 4) * 0.15
        : isKoer
          ? Math.min(98, 11.4 + pedal * 0.92 + Math.sin(timeSec * 2.5) * 0.3)
          : 11.2;

    // Intake MAP (kPa)
    const map = isKoer
      ? Math.min(235, 34 + pedal * 1.65 + (overrides.cutoutCylinder ? 6 : 0) + Math.sin(timeSec * 4.1) * 1.2)
      : 101;

    // Intake Cam Angle (°CA)
    const vctIn = !isKoer
      ? 0
      : overrides.vctDutyOverridePct !== null
        ? Math.max(0, Math.min(52, overrides.vctDutyOverridePct * 0.62 + Math.sin(timeSec * 5) * 0.4))
        : Math.max(0, pedal * 0.44 + Math.sin(timeSec * 2.1) * 0.6);

    // Fuel Trims (%)
    const leanBias =
      vehicle.id === 'toyota-tacoma-2020'
        ? Math.max(3.5, 14.2 - pedal * 0.16) // classic vacuum leak: high trim at idle, drops off idle!
        : hasF150Misfire
          ? 5.8
          : 0.8;
    const injDelta = overrides.fuelTrimInjectionDeltaPct ?? 0;
    const stft1 = isKoer
      ? Math.max(
          -24,
          Math.min(
            24,
            leanBias - injDelta * 0.85 + (overrides.cutoutCylinder ? 8.4 : 0) + Math.sin(timeSec * 2.8) * 1.3
          )
        )
      : 0;
    const ltft1 = vehicle.id === 'toyota-tacoma-2020' ? 11.7 : hasF150Misfire ? 4.7 : 1.6;

    // Cooling fan & Coolant Temp
    const fanDuty =
      overrides.fanPwmOverridePct !== null
        ? overrides.fanPwmOverridePct
        : this.ectState > 95
          ? 65
          : 15;
    const targetEct = isKoer ? 91.5 - (fanDuty - 20) * 0.09 + pedal * 0.06 : 84.0;
    this.ectState += (targetEct - this.ectState) * 0.02;

    // Supply Voltage (V)
    const vpwr =
      overrides.maintainerVoltageSet !== null
        ? overrides.maintainerVoltageSet + Math.sin(timeSec * 6.2) * 0.02
        : isKoer
          ? 14.18 + Math.sin(timeSec * 7.5) * 0.04
          : 12.46 + Math.sin(timeSec * 3.1) * 0.01;

    // Mass Air Flow (g/s)
    const maf = isKoer ? Math.max(2.4, (rpm / 680) * 3.8 * (map / 35) * 0.85) : 0;

    // Spark Advance (°BTDC)
    const spark = isKoer ? 14.5 + pedal * 0.28 - (hasF150Misfire ? 1.5 : 0) + Math.cos(timeSec * 4) * 0.8 : 0;

    // GDI Fuel Rail Pressure (MPa)
    const railMpa = isKoer ? 4.8 + pedal * 0.19 + Math.sin(timeSec * 6) * 0.12 : 3.4;

    // Cyl 4 Misfire counter
    const misfireC4 =
      isKoer && hasF150Misfire
        ? Math.round(12 + ((Math.floor(timeSec * 0.7) % 9)))
        : overrides.cutoutCylinder === 4 && isKoer
          ? 28
          : 0;

    // EVAP Tank Pressure (Pa)
    const targetEvap = overrides.evapSealActive && isKoer ? -465 : -32;
    this.evapState += (targetEvap - this.evapState) * 0.08;

    const sampleMap: Record<string, number> = {
      rpm,
      map,
      stft1,
      ltft1,
      ect: this.ectState,
      vct_in: vctIn,
      throttle,
      vpwr,
      maf,
      spark,
      rail_mpa: railMpa,
      misfire_c4: misfireC4,
      fan_duty: fanDuty,
      evap_pa: this.evapState + Math.sin(timeSec * 5) * 4,
    };

    for (const pid of STANDARD_PIDS) {
      const val = sampleMap[pid.id] ?? 0;
      this.channels[pid.id][idx] = val;
      const st = this.stats[pid.id];
      st.latest = val;
      if (val < st.min) st.min = val;
      if (val > st.max) st.max = val;
    }

    this.head = (this.head + 1) % RING_CAPACITY;
    if (this.count < RING_CAPACITY) {
      this.count += 1;
    }

    if (countThroughput) {
      const packetMultiplier = overrides.highLoadStressBurst ? 24 : 8;
      this.totalFramesProcessed += packetMultiplier;
      this.fpsCounter += packetMultiplier;
      const nowMs = performance.now();
      const elapsed = nowMs - this.lastFpsWindowMs;
      if (elapsed >= 500) {
        this.framesPerSecond = Math.round((this.fpsCounter * 1000) / elapsed);
        this.fpsCounter = 0;
        this.lastFpsWindowMs = nowMs;
      }
    }
  }

  public getChronologicalSlice(pidId: string, maxPoints: number): {
    times: number[];
    values: number[];
  } {
    const n = Math.min(this.count, maxPoints);
    const times = new Array<number>(n);
    const values = new Array<number>(n);
    const buf = this.channels[pidId];
    if (!buf || n === 0) return { times: [], values: [] };

    const startIdx = (this.head - n + RING_CAPACITY) % RING_CAPACITY;
    for (let i = 0; i < n; i++) {
      const pos = (startIdx + i) % RING_CAPACITY;
      times[i] = this.timestamps[pos];
      values[i] = buf[pos];
    }
    return { times, values };
  }
}
