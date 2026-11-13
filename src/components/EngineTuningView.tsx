import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Download,
  Flame,
  RotateCcw,
  Sliders,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { Button, StatusMark, Surface } from './ui';
import { D3TuningChartsPanel } from './D3TuningChartsPanel';
import {
  VEHICLE_TUNING_PROFILES,
  cloneVehicleTuningProfile,
  computeDynoCurve,
  validateCalibrationSafety,
} from '../data/tuningMaps';
import type { TelemetryOverrides, TelemetryRingStore } from '../lib/telemetryEngine';
import type {
  CalibrationPackage,
  TuningPresetSpec,
  TuningTableId,
  TuningTableSpec,
  VehicleProfile,
  VehicleTuningProfile,
} from '../types/diagnostic';

interface EngineTuningViewProps {
  vehicle: VehicleProfile;
  ringStore: TelemetryRingStore;
  overrides: TelemetryOverrides;
  liveBatteryVolts: number;
  onUpdateOverrides: (patch: Partial<TelemetryOverrides>) => void;
  onCompleteFlash: (pkg: CalibrationPackage) => void;
}

interface CellCoord {
  r: number;
  c: number;
}

function roundTo(val: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(val * f) / f;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function closestIndex(arr: number[], target: number): number {
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - target);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function computeCellBg(
  val: number,
  minVal: number,
  maxVal: number,
  higherIsRichOrHigh: 'high' | 'low'
): string {
  const span = maxVal - minVal || 1;
  const rawNorm = clamp((val - minVal) / span, 0, 1);
  const norm = higherIsRichOrHigh === 'low' ? 1 - rawNorm : rawNorm;

  // Low-saturation daytime calibration heat tints guaranteeing >= 7:1 contrast with #14181F ink
  if (norm < 0.25) return 'rgba(219, 234, 254, 0.55)'; // cool sky
  if (norm < 0.55) return 'rgba(209, 250, 229, 0.55)'; // nominal mint
  if (norm < 0.8) return 'rgba(254, 243, 199, 0.72)'; // medium load amber
  return 'rgba(254, 226, 226, 0.75)'; // high load / peak boost coral
}

const TABLE_ORDER: TuningTableId[] = [
  'fuel_ve',
  'target_lambda',
  'spark_advance',
  'vct_intake',
  'boost_target',
  'injector_rail',
];

export const EngineTuningView: React.FC<EngineTuningViewProps> = ({
  vehicle,
  ringStore,
  overrides,
  liveBatteryVolts,
  onUpdateOverrides,
  onCompleteFlash,
}) => {
  const stockProfile = useMemo(
    () => VEHICLE_TUNING_PROFILES[vehicle.id] || VEHICLE_TUNING_PROFILES['ford-f150-2023'],
    [vehicle.id]
  );

  const [tuneProfile, setTuneProfile] = useState<VehicleTuningProfile>(() =>
    cloneVehicleTuningProfile(vehicle.id)
  );
  const [activeTableId, setActiveTableId] = useState<TuningTableId>('fuel_ve');
  const [activePresetId, setActivePresetId] = useState<TuningPresetSpec['id']>('stock');
  const [presetNonce, setPresetNonce] = useState<number>(0);
  const [displayAfrUnits, setDisplayAfrUnits] = useState<boolean>(false);
  const [showDeltaMode, setShowDeltaMode] = useState<boolean>(false);
  const [liveTraceEnabled, setLiveTraceEnabled] = useState<boolean>(true);

  // Selection state (rectangular bounding box anchored at anchorCell -> focusCell)
  const [anchorCell, setAnchorCell] = useState<CellCoord>({ r: 3, c: 2 });
  const [focusCell, setFocusCell] = useState<CellCoord>({ r: 3, c: 2 });
  const [directEditInput, setDirectEditInput] = useState<string>('');

  // Live telemetry snapshot for real-time map hit-tracer (8 Hz)
  const [liveStats, setLiveStats] = useState({
    rpm: ringStore.stats.rpm?.latest ?? 680,
    map: ringStore.stats.map?.latest ?? 35,
    stft1: ringStore.stats.stft1?.latest ?? 2.4,
    ltft1: ringStore.stats.ltft1?.latest ?? 1.6,
    vpwr: ringStore.stats.vpwr?.latest ?? 14.1,
    railMpa: ringStore.stats.rail_mpa?.latest ?? 4.8,
  });

  // J2534 tune flash state
  const [isFlashingTune, setIsFlashingTune] = useState<boolean>(false);
  const [flashPct, setFlashPct] = useState<number>(0);
  const [flashMessage, setFlashMessage] = useState<string>('');

  useEffect(() => {
    setTuneProfile(cloneVehicleTuningProfile(vehicle.id));
    setActivePresetId('stock');
    setAnchorCell({ r: 3, c: 2 });
    setFocusCell({ r: 3, c: 2 });
    setFlashMessage('');
    setIsFlashingTune(false);
    setFlashPct(0);
  }, [vehicle.id]);

  useEffect(() => {
    if (!liveTraceEnabled) return;
    const id = window.setInterval(() => {
      setLiveStats({
        rpm: ringStore.stats.rpm?.latest ?? 0,
        map: ringStore.stats.map?.latest ?? 101,
        stft1: ringStore.stats.stft1?.latest ?? 0,
        ltft1: ringStore.stats.ltft1?.latest ?? 0,
        vpwr: ringStore.stats.vpwr?.latest ?? 12.6,
        railMpa: ringStore.stats.rail_mpa?.latest ?? 4.5,
      });
    }, 125);
    return () => window.clearInterval(id);
  }, [liveTraceEnabled, ringStore]);

  const activeTable: TuningTableSpec = tuneProfile.tables[activeTableId];
  const stockTable: TuningTableSpec = stockProfile.tables[activeTableId];

  const stoichAfr =
    tuneProfile.scalars.find((s) => s.id === 'stoich_afr')?.value ?? 14.68;

  // Format cell display value (supports Lambda <-> AFR conversion when on target_lambda)
  const formatTableValue = (val: number, tableId: TuningTableId, decimals: number): string => {
    if (tableId === 'target_lambda' && displayAfrUnits) {
      return (val * stoichAfr).toFixed(2);
    }
    return val.toFixed(decimals);
  };

  // Sync direct edit box when focusCell or activeTable changes
  useEffect(() => {
    const row = activeTable.values[focusCell.r];
    if (!row) return;
    const rawVal = row[focusCell.c];
    if (rawVal === undefined) return;
    setDirectEditInput(
      activeTableId === 'target_lambda' && displayAfrUnits
        ? (rawVal * stoichAfr).toFixed(2)
        : rawVal.toFixed(activeTable.decimals)
    );
  }, [focusCell, activeTableId, displayAfrUnits, stoichAfr, activeTable.values, activeTable.decimals]);

  // Selection bounds
  const selBounds = useMemo(() => {
    const rMin = Math.min(anchorCell.r, focusCell.r);
    const rMax = Math.max(anchorCell.r, focusCell.r);
    const cMin = Math.min(anchorCell.c, focusCell.c);
    const cMax = Math.max(anchorCell.c, focusCell.c);
    return {
      rMin,
      rMax,
      cMin,
      cMax,
      count: (rMax - rMin + 1) * (cMax - cMin + 1),
    };
  }, [anchorCell, focusCell]);

  // Live traced operating cell on the currently visible table
  const tracedCell: CellCoord | null = useMemo(() => {
    if (!liveTraceEnabled) return null;
    if (activeTableId === 'injector_rail') {
      return {
        r: closestIndex(activeTable.yBreakpoints, liveStats.railMpa),
        c: closestIndex(activeTable.xBreakpoints, liveStats.vpwr),
      };
    }
    return {
      r: closestIndex(activeTable.yBreakpoints, liveStats.map),
      c: closestIndex(activeTable.xBreakpoints, liveStats.rpm),
    };
  }, [liveTraceEnabled, activeTableId, activeTable, liveStats]);

  // Min / Max across active table for heat-map scaling
  const tableBounds = useMemo(() => {
    const flat = activeTable.values.flat();
    return {
      min: Math.min(...flat),
      max: Math.max(...flat),
    };
  }, [activeTable]);

  // Count total modified cells & scalars vs stock
  const modificationStats = useMemo(() => {
    let modifiedCells = 0;
    for (const id of TABLE_ORDER) {
      const cur = tuneProfile.tables[id].values;
      const stk = stockProfile.tables[id].values;
      for (let r = 0; r < cur.length; r++) {
        for (let c = 0; c < cur[r].length; c++) {
          if (Math.abs(cur[r][c] - stk[r][c]) > 0.0005) {
            modifiedCells += 1;
          }
        }
      }
    }
    let modifiedScalars = 0;
    for (let i = 0; i < tuneProfile.scalars.length; i++) {
      if (Math.abs(tuneProfile.scalars[i].value - stockProfile.scalars[i].value) > 0.001) {
        modifiedScalars += 1;
      }
    }
    return { modifiedCells, modifiedScalars };
  }, [tuneProfile, stockProfile]);

  const dynoResult = useMemo(
    () => computeDynoCurve(stockProfile, tuneProfile),
    [stockProfile, tuneProfile]
  );

  const safetyAlerts = useMemo(
    () => validateCalibrationSafety(stockProfile, tuneProfile),
    [stockProfile, tuneProfile]
  );

  const hasSafetyFault = safetyAlerts.some((a) => a.severity === 'fault');

  // Update active table values helper
  const mutateActiveTable = (updater: (nextValues: number[][]) => void) => {
    setTuneProfile((prev) => {
      const cloned = structuredClone(prev);
      const tbl = cloned.tables[activeTableId];
      updater(tbl.values);
      return cloned;
    });
  };

  const handleCellClick = (r: number, c: number, shiftKey: boolean) => {
    if (shiftKey) {
      setFocusCell({ r, c });
    } else {
      setAnchorCell({ r, c });
      setFocusCell({ r, c });
    }
  };

  const handleSelectRow = (r: number) => {
    setAnchorCell({ r, c: 0 });
    setFocusCell({ r, c: activeTable.xBreakpoints.length - 1 });
  };

  const handleSelectCol = (c: number) => {
    setAnchorCell({ r: 0, c });
    setFocusCell({ r: activeTable.yBreakpoints.length - 1, c });
  };

  const handleSelectAll = () => {
    setAnchorCell({ r: 0, c: 0 });
    setFocusCell({
      r: activeTable.yBreakpoints.length - 1,
      c: activeTable.xBreakpoints.length - 1,
    });
  };

  const applyScalePct = (pctDelta: number) => {
    mutateActiveTable((vals) => {
      for (let r = selBounds.rMin; r <= selBounds.rMax; r++) {
        for (let c = selBounds.cMin; c <= selBounds.cMax; c++) {
          const next = vals[r][c] * (1 + pctDelta / 100);
          vals[r][c] = roundTo(
            clamp(next, activeTable.minAllowed, activeTable.maxAllowed),
            activeTable.decimals
          );
        }
      }
    });
  };

  const applyAddDelta = (delta: number) => {
    mutateActiveTable((vals) => {
      for (let r = selBounds.rMin; r <= selBounds.rMax; r++) {
        for (let c = selBounds.cMin; c <= selBounds.cMax; c++) {
          const next = vals[r][c] + delta;
          vals[r][c] = roundTo(
            clamp(next, activeTable.minAllowed, activeTable.maxAllowed),
            activeTable.decimals
          );
        }
      }
    });
  };

  const applyDirectValueSet = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(directEditInput);
    if (!Number.isFinite(parsed)) return;
    const rawTarget =
      activeTableId === 'target_lambda' && displayAfrUnits
        ? parsed / stoichAfr
        : parsed;
    const clamped = roundTo(
      clamp(rawTarget, activeTable.minAllowed, activeTable.maxAllowed),
      activeTable.decimals
    );
    mutateActiveTable((vals) => {
      for (let r = selBounds.rMin; r <= selBounds.rMax; r++) {
        for (let c = selBounds.cMin; c <= selBounds.cMax; c++) {
          vals[r][c] = clamped;
        }
      }
    });
  };

  const applyBilinearInterpolate = () => {
    if (selBounds.rMax === selBounds.rMin && selBounds.cMax === selBounds.cMin) return;
    mutateActiveTable((vals) => {
      const v00 = vals[selBounds.rMin][selBounds.cMin];
      const v01 = vals[selBounds.rMin][selBounds.cMax];
      const v10 = vals[selBounds.rMax][selBounds.cMin];
      const v11 = vals[selBounds.rMax][selBounds.cMax];
      const rSpan = Math.max(1, selBounds.rMax - selBounds.rMin);
      const cSpan = Math.max(1, selBounds.cMax - selBounds.cMin);

      for (let r = selBounds.rMin; r <= selBounds.rMax; r++) {
        const ty = (r - selBounds.rMin) / rSpan;
        for (let c = selBounds.cMin; c <= selBounds.cMax; c++) {
          const tx = (c - selBounds.cMin) / cSpan;
          const interp =
            v00 * (1 - tx) * (1 - ty) +
            v01 * tx * (1 - ty) +
            v10 * (1 - tx) * ty +
            v11 * tx * ty;
          vals[r][c] = roundTo(
            clamp(interp, activeTable.minAllowed, activeTable.maxAllowed),
            activeTable.decimals
          );
        }
      }
    });
  };

  const applySmoothSelection = () => {
    mutateActiveTable((vals) => {
      const snapshot = vals.map((row) => [...row]);
      for (let r = selBounds.rMin; r <= selBounds.rMax; r++) {
        for (let c = selBounds.cMin; c <= selBounds.cMax; c++) {
          let sum = snapshot[r][c] * 2;
          let weight = 2;
          const neighbors = [
            [r - 1, c],
            [r + 1, c],
            [r, c - 1],
            [r, c + 1],
          ];
          for (const [nr, nc] of neighbors) {
            if (nr >= 0 && nr < snapshot.length && nc >= 0 && nc < snapshot[0].length) {
              sum += snapshot[nr][nc];
              weight += 1;
            }
          }
          vals[r][c] = roundTo(
            clamp(sum / weight, activeTable.minAllowed, activeTable.maxAllowed),
            activeTable.decimals
          );
        }
      }
    });
  };

  const handleRevertSelected = () => {
    mutateActiveTable((vals) => {
      for (let r = selBounds.rMin; r <= selBounds.rMax; r++) {
        for (let c = selBounds.cMin; c <= selBounds.cMax; c++) {
          vals[r][c] = stockTable.values[r][c];
        }
      }
    });
  };

  const handleApplyLiveTrimToTracedCell = () => {
    if (!tracedCell || activeTableId !== 'fuel_ve') return;
    const totalTrimPct = liveStats.stft1 + liveStats.ltft1;
    // Positive fuel trim means ECU is adding fuel because VE estimate was too low -> increase VE
    mutateActiveTable((vals) => {
      const cur = vals[tracedCell.r][tracedCell.c];
      vals[tracedCell.r][tracedCell.c] = roundTo(
        clamp(cur * (1 + totalTrimPct / 100), activeTable.minAllowed, activeTable.maxAllowed),
        activeTable.decimals
      );
    });
    setAnchorCell(tracedCell);
    setFocusCell(tracedCell);
  };

  const handleApplyPreset = (preset: TuningPresetSpec) => {
    const next = cloneVehicleTuningProfile(vehicle.id);
    if (preset.id !== 'stock') {
      // Scale VE
      next.tables.fuel_ve.values = next.tables.fuel_ve.values.map((row, rIdx) =>
        row.map((val) => {
          const loadWeight = rIdx >= 4 ? 1.0 : 0.45;
          return roundTo(
            clamp(
              val * (1 + (preset.veMultiplierPct * loadWeight) / 100),
              next.tables.fuel_ve.minAllowed,
              next.tables.fuel_ve.maxAllowed
            ),
            next.tables.fuel_ve.decimals
          );
        })
      );

      // Adjust upper-load lambda
      next.tables.target_lambda.values = next.tables.target_lambda.values.map((row, rIdx) =>
        row.map((val) => {
          if (rIdx < 4) return val;
          return roundTo(
            clamp(
              val + preset.lambdaBoostOffset,
              next.tables.target_lambda.minAllowed,
              next.tables.target_lambda.maxAllowed
            ),
            next.tables.target_lambda.decimals
          );
        })
      );

      // Adjust upper-load spark timing
      next.tables.spark_advance.values = next.tables.spark_advance.values.map((row, rIdx) =>
        row.map((val) => {
          if (rIdx < 4) return val;
          const weight = rIdx >= 6 ? 1.0 : 0.6;
          return roundTo(
            clamp(
              val + preset.sparkOffsetHighLoad * weight,
              next.tables.spark_advance.minAllowed,
              next.tables.spark_advance.maxAllowed
            ),
            next.tables.spark_advance.decimals
          );
        })
      );

      // Adjust boost / torque target
      next.tables.boost_target.values = next.tables.boost_target.values.map((row, rIdx) =>
        row.map((val) => {
          if (rIdx < 3) return val;
          const weight = (rIdx - 2) / 5;
          return roundTo(
            clamp(
              val + preset.boostKpaDelta * weight,
              next.tables.boost_target.minAllowed,
              next.tables.boost_target.maxAllowed
            ),
            next.tables.boost_target.decimals
          );
        })
      );

      // Adjust Scalars
      next.scalars = next.scalars.map((sc) => {
        if (sc.id === 'rev_limit_rpm' || sc.id === 'soft_cut_rpm') {
          return { ...sc, value: clamp(sc.value + preset.revLimitDelta, sc.min, sc.max) };
        }
        if (sc.id === 'stoich_afr' && preset.stoichAfr) {
          return { ...sc, value: preset.stoichAfr };
        }
        if (sc.id === 'boost_cut_kpa' && preset.boostKpaDelta > 10) {
          return { ...sc, value: clamp(sc.value + preset.boostKpaDelta + 10, sc.min, sc.max) };
        }
        if (sc.id === 'fan_on_temp_c' && preset.id === 'tow_economy') {
          return { ...sc, value: 93 };
        }
        return sc;
      });
    }

    setTuneProfile(next);
    setActivePresetId(preset.id);
    setPresetNonce((n) => n + 1);
    setFlashMessage(`Loaded "${preset.label}" calibration base (${preset.fuelOctane}).`);
  };

  const handleScalarChange = (id: string, rawVal: number) => {
    if (!Number.isFinite(rawVal)) return;
    setTuneProfile((prev) => ({
      ...prev,
      scalars: prev.scalars.map((s) =>
        s.id === id ? { ...s, value: roundTo(clamp(rawVal, s.min, s.max), s.decimals) } : s
      ),
    }));
  };

  // J2534 Custom Tune Flashing
  const maintainerVolts = overrides.maintainerVoltageSet ?? liveBatteryVolts;
  const voltageOk = maintainerVolts >= 12.6;
  const koeoOk = overrides.ignitionState === 'KOEO';

  useEffect(() => {
    if (!isFlashingTune) return;
    const timer = window.setInterval(() => {
      setFlashPct((prev) => {
        const next = Math.min(100, prev + 10);
        if (next >= 100) {
          window.clearInterval(timer);
          setIsFlashingTune(false);
          const primaryMod = vehicle.modules[0];
          const tunedCalId = `${primaryMod.calibrationId.split('-TUNED')[0]}-TUNED-${activePresetId.toUpperCase()}`;
          onCompleteFlash({
            id: `custom-tune-${Date.now()}`,
            moduleId: primaryMod.id,
            moduleName: primaryMod.name,
            currentCalId: primaryMod.calibrationId,
            newCalId: tunedCalId,
            tsbNumber: `CUSTOM-${activePresetId.toUpperCase()}`,
            releaseDate: new Date().toISOString().slice(0, 10),
            sizeKb: 4096,
            crc32Hex: '0x9E4B2F11',
            summary: `Custom ${tuneProfile.ecuStrategy} calibration (${modificationStats.modifiedCells} map cells, ${modificationStats.modifiedScalars} scalars)`,
            requiresMaintainerVolts: 12.6,
          });
          setFlashMessage(
            `Flashed custom calibration ${tunedCalId} via J2534 (${modificationStats.modifiedCells} map cells & ${modificationStats.modifiedScalars} scalars verified).`
          );
        }
        return next;
      });
    }, 150);
    return () => window.clearInterval(timer);
  }, [
    isFlashingTune,
    vehicle.modules,
    activePresetId,
    tuneProfile.ecuStrategy,
    modificationStats.modifiedCells,
    modificationStats.modifiedScalars,
    onCompleteFlash,
  ]);

  const handleExportCalibrationJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      vin: vehicle.vin,
      ecuStrategy: tuneProfile.ecuStrategy,
      presetBase: activePresetId,
      modifiedCells: modificationStats.modifiedCells,
      modifiedScalars: modificationStats.modifiedScalars,
      scalars: tuneProfile.scalars,
      tables: tuneProfile.tables,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vehicle.make.toLowerCase()}-${vehicle.year}-calibration.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyQuickParameterOffsets = (offsets: {
    veHighLoadPct: number;
    lambdaHighLoadDelta: number;
    sparkHighLoadDeg: number;
    boostHighLoadKpa: number;
  }) => {
    setTuneProfile((prev) => {
      const next = structuredClone(prev);
      const stk = stockProfile;

      next.tables.fuel_ve.values = stk.tables.fuel_ve.values.map((row, rIdx) =>
        row.map((val) => {
          const w = rIdx >= 4 ? 1.0 : rIdx === 3 ? 0.45 : 0;
          return roundTo(
            clamp(
              val * (1 + (offsets.veHighLoadPct * w) / 100),
              next.tables.fuel_ve.minAllowed,
              next.tables.fuel_ve.maxAllowed
            ),
            next.tables.fuel_ve.decimals
          );
        })
      );

      next.tables.target_lambda.values = stk.tables.target_lambda.values.map((row, rIdx) =>
        row.map((val) => {
          const w = rIdx >= 4 ? 1.0 : 0;
          return roundTo(
            clamp(
              val + offsets.lambdaHighLoadDelta * w,
              next.tables.target_lambda.minAllowed,
              next.tables.target_lambda.maxAllowed
            ),
            next.tables.target_lambda.decimals
          );
        })
      );

      next.tables.spark_advance.values = stk.tables.spark_advance.values.map((row, rIdx) =>
        row.map((val) => {
          const w = rIdx >= 5 ? 1.0 : rIdx === 4 ? 0.55 : 0;
          return roundTo(
            clamp(
              val + offsets.sparkHighLoadDeg * w,
              next.tables.spark_advance.minAllowed,
              next.tables.spark_advance.maxAllowed
            ),
            next.tables.spark_advance.decimals
          );
        })
      );

      next.tables.boost_target.values = stk.tables.boost_target.values.map((row, rIdx) =>
        row.map((val) => {
          if (rIdx < 3) return val;
          const w = (rIdx - 2) / 5;
          return roundTo(
            clamp(
              val + offsets.boostHighLoadKpa * w,
              next.tables.boost_target.minAllowed,
              next.tables.boost_target.maxAllowed
            ),
            next.tables.boost_target.decimals
          );
        })
      );

      return next;
    });
  };

  const hpGain = dynoResult.peakTunedHp - dynoResult.peakStockHp;
  const tqGain = dynoResult.peakTunedTq - dynoResult.peakStockTq;

  return (
    <div className="space-y-5">
      {/* Calibration Strategy, Presets & Peak Output Summary */}
      <Surface className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <Flame className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
              <h2 className="text-title text-foreground">
                {tuneProfile.ecuStrategy}
              </h2>
              <StatusMark kind="nominal" label={tuneProfile.aspiration} />
            </div>
            <p className="text-sm text-muted">
              Edit 2D Fuel VE, Target Lambda/AFR, Ignition Spark Timing, Cam VCT, Boost/ETC, and Injector Latency tables with live telemetry hit-tracing and J2534 ECU write.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" tone="quiet" onClick={handleExportCalibrationJson}>
              <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Export .JSON map</span>
            </Button>
            <Button
              size="sm"
              tone="quiet"
              onClick={() => handleApplyPreset(tuneProfile.presets[0])}
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Revert all to OEM</span>
            </Button>
          </div>
        </div>

        {/* Preset Calibration Selector */}
        <div className="pt-3 border-t border-border/40 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Base calibration presets">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted mr-1">
              Base stage:
            </span>
            {tuneProfile.presets.map((preset) => {
              const active = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  className={`min-h-9 px-3 rounded-control text-xs font-medium border whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-surface text-foreground border-border/55 hover:bg-background'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
            <span>
              Peak HP:{' '}
              <strong className="text-foreground">{dynoResult.peakTunedHp} hp</strong>{' '}
              <span className={hpGain >= 0 ? 'text-nominal' : 'text-fault'}>
                ({hpGain >= 0 ? `+${hpGain}` : hpGain})
              </span>
            </span>
            <span>
              Peak Torque:{' '}
              <strong className="text-foreground">{dynoResult.peakTunedTq} Nm</strong>{' '}
              <span className={tqGain >= 0 ? 'text-nominal' : 'text-fault'}>
                ({tqGain >= 0 ? `+${tqGain}` : tqGain})
              </span>
            </span>
            <span className="text-muted">
              {modificationStats.modifiedCells} cells · {modificationStats.modifiedScalars} scalars edited
            </span>
          </div>
        </div>
      </Surface>

      {/* Dedicated D3 Calibration Maps & Dyno Output Section */}
      <D3TuningChartsPanel
        stockProfile={stockProfile}
        tuneProfile={tuneProfile}
        dynoPoints={dynoResult.points}
        peakStockHp={dynoResult.peakStockHp}
        peakTunedHp={dynoResult.peakTunedHp}
        peakStockTq={dynoResult.peakStockTq}
        peakTunedTq={dynoResult.peakTunedTq}
        liveRpm={liveStats.rpm}
        liveMapKpa={liveStats.map}
        displayAfrUnits={displayAfrUnits}
        activePreset={tuneProfile.presets.find((p) => p.id === activePresetId)}
        presetNonce={presetNonce}
        onApplyQuickParameterOffsets={handleApplyQuickParameterOffsets}
        onSelectTableCell={(tableId, r, c) => {
          setActiveTableId(tableId);
          setAnchorCell({ r, c });
          setFocusCell({ r, c });
        }}
      />

      {/* Main 2D Calibration Table Workbench */}
      <Surface className="p-4 sm:p-5 space-y-4">
        {/* Table Selector Tabs & View Controls */}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between border-b border-border/40 pb-3.5">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Calibration maps">
            {TABLE_ORDER.map((id) => {
              const tbl = tuneProfile.tables[id];
              const active = activeTableId === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setActiveTableId(id);
                    setAnchorCell({ r: 3, c: 2 });
                    setFocusCell({ r: 3, c: 2 });
                  }}
                  className={`min-h-9 px-3 rounded-control text-xs font-medium border whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-surface text-foreground border-border/55 hover:bg-background'
                  }`}
                >
                  {tbl.shortName}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeTableId === 'target_lambda' && (
              <button
                type="button"
                onClick={() => setDisplayAfrUnits((v) => !v)}
                className="min-h-9 px-3 rounded-control text-xs font-medium border border-border/55 bg-surface text-foreground hover:bg-background whitespace-nowrap"
              >
                Units: {displayAfrUnits ? `AFR (${stoichAfr}:1 stoich)` : 'Lambda (λ)'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDeltaMode((v) => !v)}
              className={`min-h-9 px-3 rounded-control text-xs font-medium border whitespace-nowrap ${
                showDeltaMode
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface text-foreground border-border/55 hover:bg-background'
              }`}
            >
              {showDeltaMode ? 'Viewing Δ vs Stock' : 'Show Δ vs Stock'}
            </button>
            <button
              type="button"
              onClick={() => setLiveTraceEnabled((v) => !v)}
              className={`min-h-9 px-3 rounded-control text-xs font-medium border inline-flex items-center gap-1.5 whitespace-nowrap ${
                liveTraceEnabled
                  ? 'bg-surface text-nominal border-nominal'
                  : 'bg-surface text-muted border-border/55'
              }`}
            >
              <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{liveTraceEnabled ? 'Live trace ON' : 'Live trace OFF'}</span>
            </button>
          </div>
        </div>

        {/* Active Table Description & Live Dyno Sweep Simulator Bar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-6 space-y-0.5">
            <div className="font-semibold text-sm text-foreground">{activeTable.name}</div>
            <p className="text-xs text-muted">{activeTable.description}</p>
          </div>

          <div className="lg:col-span-6 flex flex-col sm:flex-row sm:items-center gap-3 justify-end">
            <div className="flex-1 max-w-xs space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="tune-load-sweep" className="font-medium text-foreground">
                  Live dyno / pedal trace sweep
                </label>
                <span className="font-mono tabular-nums text-primary">
                  {Math.round(liveStats.rpm)} rpm · {Math.round(liveStats.map)} kPa
                </span>
              </div>
              <input
                id="tune-load-sweep"
                type="range"
                min={0}
                max={80}
                step={2}
                value={overrides.simulatedThrottleDemandPct}
                onChange={(e) => {
                  if (overrides.ignitionState !== 'KOER') {
                    onUpdateOverrides({
                      ignitionState: 'KOER',
                      simulatedThrottleDemandPct: Number(e.target.value),
                    });
                  } else {
                    onUpdateOverrides({ simulatedThrottleDemandPct: Number(e.target.value) });
                  }
                }}
                className="w-full accent-primary"
              />
            </div>

            {activeTableId === 'fuel_ve' && tracedCell && (
              <Button size="sm" tone="quiet" onClick={handleApplyLiveTrimToTracedCell}>
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Auto-trim cell ({liveStats.stft1 + liveStats.ltft1 >= 0 ? '+' : ''}
                  {(liveStats.stft1 + liveStats.ltft1).toFixed(1)}%)
                </span>
              </Button>
            )}
          </div>
        </div>

        {/* Batch Cell Editor Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-b border-border/40 py-2.5">
          <form onSubmit={applyDirectValueSet} className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-muted">
              Selected: {selBounds.count} {selBounds.count === 1 ? 'cell' : 'cells'}
            </span>
            <label htmlFor="cell-direct-value" className="sr-only">
              Set selected cell value
            </label>
            <input
              id="cell-direct-value"
              type="number"
              step="any"
              value={directEditInput}
              onChange={(e) => setDirectEditInput(e.target.value)}
              className="min-h-8 w-24 rounded-control border border-border/55 bg-surface px-2 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            />
            <Button size="sm" type="submit">
              Set
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" tone="quiet" onClick={() => applyScalePct(-2)}>
              -2%
            </Button>
            <Button size="sm" tone="quiet" onClick={() => applyScalePct(-0.5)}>
              -0.5%
            </Button>
            <Button size="sm" tone="quiet" onClick={() => applyScalePct(0.5)}>
              +0.5%
            </Button>
            <Button size="sm" tone="quiet" onClick={() => applyScalePct(2)}>
              +2%
            </Button>
            <Button
              size="sm"
              tone="quiet"
              onClick={() => applyAddDelta(-activeTable.step)}
            >
              -{activeTable.step}
            </Button>
            <Button
              size="sm"
              tone="quiet"
              onClick={() => applyAddDelta(activeTable.step)}
            >
              +{activeTable.step}
            </Button>
            <Button size="sm" tone="quiet" onClick={applyBilinearInterpolate}>
              Interpolate
            </Button>
            <Button size="sm" tone="quiet" onClick={applySmoothSelection}>
              Smooth
            </Button>
            <Button size="sm" tone="quiet" onClick={handleSelectAll}>
              All
            </Button>
            <Button size="sm" tone="quiet" onClick={handleRevertSelected}>
              Revert
            </Button>
          </div>
        </div>

        {/* 2D Heat-Mapped Calibration Grid inside Recessed Well */}
        <Surface inset className="p-2.5 overflow-x-auto">
          <div className="flex items-center justify-between text-[11px] font-mono text-muted pb-2 px-1">
            <span>
              Y: {activeTable.yLabel} · X: {activeTable.xLabel}
            </span>
            <span>
              Click cell or header · Shift+Click for range · Primary outline = live operating cell
            </span>
          </div>
          <table className="w-full border-collapse font-mono text-xs tabular-nums select-none">
            <thead>
              <tr>
                <th className="p-1.5 text-left text-[11px] text-muted border border-border/35 bg-surface min-w-[78px]">
                  {activeTableId === 'injector_rail' ? 'MPa \\ V' : 'kPa \\ RPM'}
                </th>
                {activeTable.xBreakpoints.map((xVal, cIdx) => (
                  <th
                    key={xVal}
                    onClick={() => handleSelectCol(cIdx)}
                    title={`Select column ${xVal}`}
                    className="p-1.5 text-center font-semibold text-foreground border border-border/35 bg-surface cursor-pointer hover:bg-background min-w-[58px]"
                  >
                    {xVal}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeTable.yBreakpoints.map((yVal, rIdx) => (
                <tr key={yVal}>
                  <th
                    scope="row"
                    onClick={() => handleSelectRow(rIdx)}
                    title={`Select row ${yVal}`}
                    className="p-1.5 text-left font-semibold text-foreground border border-border/35 bg-surface cursor-pointer hover:bg-background whitespace-nowrap"
                  >
                    {yVal} {activeTableId === 'injector_rail' ? 'MPa' : 'kPa'}
                  </th>
                  {activeTable.values[rIdx].map((val, cIdx) => {
                    const isSelected =
                      rIdx >= selBounds.rMin &&
                      rIdx <= selBounds.rMax &&
                      cIdx >= selBounds.cMin &&
                      cIdx <= selBounds.cMax;
                    const isTraced =
                      tracedCell?.r === rIdx && tracedCell?.c === cIdx;
                    const stockVal = stockTable.values[rIdx][cIdx];
                    const delta = val - stockVal;
                    const isModified = Math.abs(delta) > 0.0005;

                    const displayText = showDeltaMode
                      ? `${delta > 0 ? '+' : ''}${formatTableValue(
                          activeTableId === 'target_lambda' && displayAfrUnits
                            ? delta
                            : delta,
                          activeTableId,
                          activeTable.decimals
                        )}`
                      : formatTableValue(val, activeTableId, activeTable.decimals);

                    const bgColor = computeCellBg(
                      val,
                      tableBounds.min,
                      tableBounds.max,
                      activeTable.higherIsRichOrHigh
                    );

                    return (
                      <td
                        key={`${rIdx}-${cIdx}`}
                        onClick={(e) => handleCellClick(rIdx, cIdx, e.shiftKey)}
                        style={{ backgroundColor: bgColor }}
                        className={`relative p-1.5 text-center border border-border/35 text-foreground cursor-pointer transition-shadow ${
                          isSelected
                            ? 'ring-2 ring-inset ring-foreground font-bold'
                            : ''
                        } ${isTraced ? 'outline-2 outline-primary -outline-offset-2 font-bold' : ''}`}
                      >
                        <span>{displayText}</span>
                        {isModified && !showDeltaMode && (
                          <span
                            aria-hidden="true"
                            className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary"
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      </Surface>

      {/* Bottom Split: Global Tuning Scalars + Dyno Estimator & J2534 Write */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Global Scalars */}
        <Surface className="xl:col-span-5 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
              <h3 className="text-title text-foreground">ECU limiters &amp; fueling scalars</h3>
            </div>
          </div>

          <div className="divide-y divide-border/40 border-t border-b border-border/40">
            {tuneProfile.scalars.map((sc, idx) => {
              const stockScalar = stockProfile.scalars[idx];
              const diff = sc.value - (stockScalar?.value ?? sc.value);
              return (
                <div
                  key={sc.id}
                  className="py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                >
                  <div className="min-w-0">
                    <label
                      htmlFor={`scalar-${sc.id}`}
                      className="text-sm font-medium text-foreground block"
                    >
                      {sc.label}
                    </label>
                    <span className="text-xs text-muted">{sc.description}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      id={`scalar-${sc.id}`}
                      type="number"
                      min={sc.min}
                      max={sc.max}
                      step={sc.step}
                      value={sc.value}
                      onChange={(e) => handleScalarChange(sc.id, Number(e.target.value))}
                      className="min-h-9 w-24 rounded-control border border-border/55 bg-surface px-2.5 font-mono text-sm text-foreground text-right focus-visible:outline-2 focus-visible:outline-primary"
                    />
                    <span className="text-xs font-mono text-muted w-14">
                      {sc.unit}
                      {Math.abs(diff) > 0.001 && (
                        <span className="block text-[10px] text-primary">
                          {diff > 0 ? `+${diff.toFixed(sc.decimals)}` : diff.toFixed(sc.decimals)}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Surface>

        {/* Calibration Safety Validator & J2534 Flash */}
        <Surface className="xl:col-span-7 p-4 sm:p-5 space-y-5">
          {/* Calibration Safety Checks */}
          <div className="space-y-2">
            <h3 className="text-title text-foreground">
              Pre-flash calibration safety &amp; J2534 ECU write
            </h3>
            <p className="text-sm text-muted">
              Automatic detonation, boost-cut margin, and air-fuel enrichment verification prior to committing tuned tables to ECU flash memory.
            </p>
            <div className="divide-y divide-border/40 border-t border-b border-border/40 pt-1">
              {safetyAlerts.map((al, i) => (
                <div key={i} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                  <div className="space-y-0.5">
                    <div className="font-medium text-foreground">{al.title}</div>
                    <p className="text-xs text-muted">{al.detail}</p>
                  </div>
                  <StatusMark
                    kind={al.severity}
                    label={
                      al.severity === 'fault'
                        ? 'Block'
                        : al.severity === 'advisory'
                          ? 'Verify'
                          : 'Safe'
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          {/* J2534 Flash Interlock & Execution */}
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <StatusMark
                  kind={koeoOk ? 'nominal' : 'fault'}
                  label={koeoOk ? 'KOEO verified' : 'KOER active'}
                />
                {!koeoOk && (
                  <Button
                    size="sm"
                    tone="quiet"
                    onClick={() => onUpdateOverrides({ ignitionState: 'KOEO' })}
                  >
                    Set KOEO
                  </Button>
                )}
                <StatusMark
                  kind={voltageOk ? 'nominal' : 'fault'}
                  label={`Supply ${maintainerVolts.toFixed(2)} V`}
                />
                {!voltageOk && (
                  <Button
                    size="sm"
                    tone="quiet"
                    onClick={() => onUpdateOverrides({ maintainerVoltageSet: 13.6 })}
                  >
                    Set 13.6 V supply
                  </Button>
                )}
              </div>
            </div>

            {isFlashingTune && (
              <div className="space-y-1.5" role="status" aria-live="polite">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>Writing Fuel/Spark/Scalar calibration sectors via J2534…</span>
                  <span className="font-mono text-primary">{flashPct}%</span>
                </div>
                <div className="h-2.5 w-full rounded-control bg-surface-recessed overflow-hidden border border-border/40">
                  <div
                    className="h-full bg-primary transition-[width] duration-150"
                    style={{ width: `${flashPct}%` }}
                  />
                </div>
              </div>
            )}

            {flashMessage && (
              <div role="status" className="flex items-center gap-2 text-sm font-medium text-nominal">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{flashMessage}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => {
                  setFlashMessage('');
                  setFlashPct(0);
                  setIsFlashingTune(true);
                }}
                disabled={!koeoOk || !voltageOk || isFlashingTune || hasSafetyFault}
              >
                <Cpu className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {isFlashingTune
                    ? 'Writing calibration to ECU…'
                    : 'Flash custom calibration via J2534'}
                </span>
              </Button>
              {hasSafetyFault && (
                <span className="text-xs font-medium text-fault flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Resolve calibration safety blocks above before flashing.
                </span>
              )}
            </div>
          </div>
        </Surface>
      </div>
    </div>
  );
};
