import React, { useEffect, useMemo, useState } from 'react';
import { Sliders, RotateCcw, ShieldAlert, Play, Square } from 'lucide-react';
import { Button, Surface, StatusMark } from './ui';
import { STANDARD_PIDS } from '../lib/obdProtocol';
import type { TelemetryOverrides, TelemetryRingStore } from '../lib/telemetryEngine';
import type { BidirectionalTestSpec, VehicleProfile } from '../types/diagnostic';

interface BidirectionalTestViewProps {
  vehicle: VehicleProfile;
  ringStore: TelemetryRingStore;
  overrides: TelemetryOverrides;
  onUpdateOverrides: (patch: Partial<TelemetryOverrides>) => void;
}

interface UdsBusEntry {
  id: string;
  ts: string;
  tx: string;
  rx: string;
  note: string;
}

const ABS_CORNERS = [
  'Stage 1/4: Left-Front (LF) isolation & dump valve pulse + HCU pump',
  'Stage 2/4: Right-Front (RF) isolation & dump valve pulse + HCU pump',
  'Stage 3/4: Left-Rear (LR) isolation & dump valve pulse + HCU pump',
  'Stage 4/4: Right-Rear (RR) isolation & dump valve pulse + accumulator zero',
];

export const BidirectionalTestView: React.FC<BidirectionalTestViewProps> = ({
  vehicle,
  ringStore,
  overrides,
  onUpdateOverrides,
}) => {
  const [selectedTestId, setSelectedTestId] = useState<string>(
    vehicle.activeTests[0]?.id ?? ''
  );
  const [baselineRpm, setBaselineRpm] = useState<number>(vehicle.idleRpmTarget);
  const [bleedStageIdx, setBleedStageIdx] = useState<number | null>(null);
  const [udsLog, setUdsLog] = useState<UdsBusEntry[]>([
    {
      id: 'init-1',
      ts: '15:00:12.104',
      tx: '7E0  02 10 03 00 00 00 00 00',
      rx: '7E8  06 50 03 00 32 01 F4 00',
      note: 'Entered UDS Extended Diagnostic Session ($10 $03)',
    },
  ]);
  const [, setTick] = useState(0);

  useEffect(() => {
    setSelectedTestId(vehicle.activeTests[0]?.id ?? '');
    setBleedStageIdx(null);
  }, [vehicle.id, vehicle.activeTests]);

  // Refresh live actuator feedback readouts at 10 Hz
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) % 10000), 100);
    return () => window.clearInterval(id);
  }, []);

  // Automated ABS Bleed stepper timer
  useEffect(() => {
    if (bleedStageIdx === null) return;
    if (bleedStageIdx >= ABS_CORNERS.length) {
      setBleedStageIdx(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setBleedStageIdx((prev) => (prev === null ? null : prev + 1));
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [bleedStageIdx]);

  const activeTest: BidirectionalTestSpec | undefined = useMemo(
    () =>
      vehicle.activeTests.find((t) => t.id === selectedTestId) || vehicle.activeTests[0],
    [vehicle.activeTests, selectedTestId]
  );

  const appendUdsFrame = (serviceHex: string, paramByteHex: string, note: string) => {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
      2,
      '0'
    )}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(
      3,
      '0'
    )}`;
    const mod = vehicle.modules.find((m) => m.id === activeTest?.moduleId) || vehicle.modules[0];
    const posRespByte = (parseInt(serviceHex.slice(0, 2), 16) + 0x40)
      .toString(16)
      .toUpperCase()
      .padStart(2, '0');
    const tx = `${mod.canTxId}  05 ${serviceHex} ${paramByteHex} 00 00`;
    const rx = `${mod.canRxId}  04 ${posRespByte} ${serviceHex.slice(3, 8)} ${paramByteHex}`;
    setUdsLog((prev) => [{ id: `${Date.now()}-${Math.random()}`, ts, tx, rx, note }, ...prev.slice(0, 9)]);
  };

  const releaseAllActuators = () => {
    setBleedStageIdx(null);
    onUpdateOverrides({
      cutoutCylinder: null,
      vctDutyOverridePct: null,
      etcPlateOverridePct: null,
      fanPwmOverridePct: null,
      fuelTrimInjectionDeltaPct: null,
      evapSealActive: false,
    });
    if (activeTest) {
      appendUdsFrame(
        activeTest.udsServiceHex.replace(/03$/, '00'),
        '00',
        'ReturnControlToECU ($2F $00) — normal closed-loop control restored'
      );
    }
  };

  const interlockMet =
    !activeTest ||
    activeTest.requiresState === 'ANY' ||
    activeTest.requiresState === overrides.ignitionState;

  const targetPid = STANDARD_PIDS.find((p) => p.id === activeTest?.targetPidId) || STANDARD_PIDS[0];
  const secondaryPid =
    STANDARD_PIDS.find((p) => p.id === activeTest?.secondaryPidId) || STANDARD_PIDS[2];

  const currentPrimaryVal = ringStore.stats[targetPid.id]?.latest ?? 0;
  const currentSecondaryVal = ringStore.stats[secondaryPid.id]?.latest ?? 0;

  // Determine current slider value if duty_slider
  const currentDutyVal = useMemo(() => {
    if (!activeTest || activeTest.controlType !== 'duty_slider') return 0;
    if (activeTest.targetPidId === 'vct_in') {
      return overrides.vctDutyOverridePct ?? activeTest.defaultValue;
    }
    if (activeTest.targetPidId === 'throttle') {
      return overrides.etcPlateOverridePct ?? activeTest.defaultValue;
    }
    if (activeTest.targetPidId === 'fan_duty') {
      return overrides.fanPwmOverridePct ?? activeTest.defaultValue;
    }
    return overrides.fuelTrimInjectionDeltaPct ?? activeTest.defaultValue;
  }, [activeTest, overrides]);

  const applyDutyValue = (rawVal: number) => {
    if (!activeTest) return;
    const min = activeTest.min ?? 0;
    const max = activeTest.max ?? 100;
    const bounded = Number.isNaN(rawVal) ? min : Math.max(min, Math.min(max, rawVal));
    const byteHex = Math.max(0, Math.min(255, Math.round(Math.abs(bounded) * 2.55)))
      .toString(16)
      .toUpperCase()
      .padStart(2, '0');

    if (activeTest.targetPidId === 'vct_in') {
      onUpdateOverrides({ vctDutyOverridePct: bounded });
    } else if (activeTest.targetPidId === 'throttle') {
      onUpdateOverrides({ etcPlateOverridePct: bounded });
    } else if (activeTest.targetPidId === 'fan_duty') {
      onUpdateOverrides({ fanPwmOverridePct: bounded });
    } else {
      onUpdateOverrides({ fuelTrimInjectionDeltaPct: bounded });
    }

    appendUdsFrame(
      activeTest.udsServiceHex,
      byteHex,
      `Commanded ${activeTest.title} -> ${bounded} ${activeTest.unit || '%'}`
    );
  };

  const anyOverrideActive =
    overrides.cutoutCylinder !== null ||
    overrides.vctDutyOverridePct !== null ||
    overrides.etcPlateOverridePct !== null ||
    overrides.fanPwmOverridePct !== null ||
    overrides.fuelTrimInjectionDeltaPct !== null ||
    overrides.evapSealActive ||
    bleedStageIdx !== null;

  return (
    <div className="space-y-5">
      {/* Header & Global Return Control to ECU Safety Bar */}
      <Surface className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-display text-foreground">
                Bidirectional component actuation
              </h1>
              <StatusMark
                kind={anyOverrideActive ? 'advisory' : 'nominal'}
                label={anyOverrideActive ? 'ECU actuator override active' : 'Closed-loop ECU control'}
              />
            </div>
            <p className="text-sm text-muted">
              UDS ISO 14229 Service $2F (InputOutputControlById) &amp; Service $31 (RoutineControl) across{' '}
              {vehicle.make} modules.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5" role="group" aria-label="Ignition state selector">
              {(['KOER', 'KOEO'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => onUpdateOverrides({ ignitionState: st })}
                  className={`min-h-10 px-3 rounded-control text-xs font-medium border whitespace-nowrap ${
                    overrides.ignitionState === st
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-surface text-foreground border-border/55 hover:bg-background'
                  }`}
                >
                  {st === 'KOER' ? 'State: KOER (Running)' : 'State: KOEO (Key On)'}
                </button>
              ))}
            </div>

            <Button
              tone={anyOverrideActive ? 'danger' : 'quiet'}
              onClick={releaseAllActuators}
              disabled={!anyOverrideActive}
            >
              <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Return all control to ECU</span>
            </Button>
          </div>
        </div>
      </Surface>

      {/* Main Split: Test Catalog + Active Control Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Available Bidirectional Tests for Current Vehicle */}
        <Surface className="lg:col-span-4 p-4 sm:p-5 space-y-3">
          <h2 className="text-title text-foreground">Supported module active tests</h2>
          <div className="divide-y divide-border/40 border-t border-border/40">
            {vehicle.activeTests.map((test) => {
              const selected = activeTest?.id === test.id;
              return (
                <button
                  key={test.id}
                  type="button"
                  onClick={() => setSelectedTestId(test.id)}
                  className={`w-full text-left py-3 px-2 rounded-control transition-colors flex flex-col gap-1 ${
                    selected ? 'bg-background' : 'hover:bg-background/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-foreground">{test.title}</span>
                    <span className="font-mono text-xs text-muted shrink-0">{test.moduleId}</span>
                  </div>
                  <div className="text-xs text-muted font-mono">
                    UDS 0x{test.udsServiceHex} · Req: {test.requiresState}
                  </div>
                </button>
              );
            })}
          </div>
        </Surface>

        {/* Right Column: Command Stage + Real-time Sensor Response + UDS Hex Monitor */}
        <Surface className="lg:col-span-8 p-4 sm:p-5 space-y-5">
          {activeTest ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h2 className="text-title text-foreground">{activeTest.title}</h2>
                  </div>
                  <p className="text-sm text-muted">{activeTest.safetyNote}</p>
                </div>
                <span className="font-mono text-xs text-muted whitespace-nowrap">
                  Module {activeTest.moduleId} · 0x{activeTest.udsServiceHex}
                </span>
              </div>

              {/* Safety Interlock Banner if state mismatch */}
              {!interlockMet && (
                <div
                  role="status"
                  className="border-t border-b border-border/40 py-3 flex flex-wrap items-center justify-between gap-3 text-sm"
                >
                  <div className="flex items-center gap-2 text-advisory font-medium">
                    <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      Safety interlock: This routine requires ignition state {activeTest.requiresState}{' '}
                      (currently {overrides.ignitionState}).
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      onUpdateOverrides({
                        ignitionState: activeTest.requiresState === 'KOEO' ? 'KOEO' : 'KOER',
                      })
                    }
                  >
                    Switch vehicle to {activeTest.requiresState}
                  </Button>
                </div>
              )}

              {/* Live Feedback Readouts (Ruled row, no nested boxes) */}
              <div className="border-t border-b border-border/40 py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:divide-x sm:divide-border/40">
                <div className="sm:pr-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {targetPid.shortLabel}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-2xl font-mono font-semibold tabular-nums text-foreground">
                      {currentPrimaryVal.toFixed(targetPid.decimals)}
                    </span>
                    <span className="text-xs text-muted">{targetPid.unit}</span>
                  </div>
                </div>

                <div className="sm:px-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {secondaryPid.shortLabel}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-2xl font-mono font-semibold tabular-nums text-foreground">
                      {currentSecondaryVal.toFixed(secondaryPid.decimals)}
                    </span>
                    <span className="text-xs text-muted">{secondaryPid.unit}</span>
                  </div>
                </div>

                <div className="sm:pl-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {activeTest.controlType === 'cylinder_cutout'
                      ? 'MEASURED RPM DELTA'
                      : 'MODULE VOLTAGE'}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    {activeTest.controlType === 'cylinder_cutout' ? (
                      <>
                        <span className="text-2xl font-mono font-semibold tabular-nums text-foreground">
                          {overrides.cutoutCylinder !== null
                            ? `${Math.round(currentPrimaryVal - baselineRpm)}`
                            : '0'}
                        </span>
                        <span className="text-xs text-muted">
                          rpm {overrides.cutoutCylinder ? `(Cyl #${overrides.cutoutCylinder} cut)` : '(all firing)'}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-2xl font-mono font-semibold tabular-nums text-foreground">
                          {(ringStore.stats.vpwr?.latest ?? 14.1).toFixed(2)}
                        </span>
                        <span className="text-xs text-muted">V</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Actuator Control Surface by Type */}
              {activeTest.controlType === 'cylinder_cutout' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">
                      Select individual injector to disable ({vehicle.cylinders}-cylinder firing bank)
                    </span>
                    {overrides.cutoutCylinder !== null && (
                      <Button
                        size="sm"
                        tone="quiet"
                        onClick={() => {
                          onUpdateOverrides({ cutoutCylinder: null });
                          appendUdsFrame(
                            activeTest.udsServiceHex,
                            '00',
                            'Re-enabled all fuel injectors'
                          );
                        }}
                      >
                        Restore all injectors
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: vehicle.cylinders }, (_, i) => i + 1).map((cyl) => {
                      const isCut = overrides.cutoutCylinder === cyl;
                      return (
                        <Button
                          key={cyl}
                          tone={isCut ? 'danger' : 'quiet'}
                          disabled={!interlockMet}
                          onClick={() => {
                            if (isCut) {
                              onUpdateOverrides({ cutoutCylinder: null });
                              appendUdsFrame(
                                activeTest.udsServiceHex,
                                '00',
                                `Injector #${cyl} restored`
                              );
                            } else {
                              if (overrides.cutoutCylinder === null) {
                                setBaselineRpm(currentPrimaryVal);
                              }
                              onUpdateOverrides({ cutoutCylinder: cyl });
                              appendUdsFrame(
                                activeTest.udsServiceHex,
                                `0${cyl}`,
                                `Disabled Cylinder #${cyl} injector pulse`
                              );
                            }
                          }}
                        >
                          {isCut ? `Cyl #${cyl} OFF` : `Cut Cyl #${cyl}`}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted">
                    Diagnostic tip: A healthy cylinder drops speed by ~90–100 rpm when cut; a misfiring or low-compression cylinder (such as Cyl #4 on RO-88412) drops much less (~30 rpm).
                  </p>
                </div>
              )}

              {activeTest.controlType === 'duty_slider' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
                    <div className="sm:col-span-8 space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <label htmlFor="uds-duty-range" className="font-medium text-foreground">
                          Commanded setpoint ({activeTest.min} to {activeTest.max} {activeTest.unit})
                        </label>
                        <span className="font-mono font-semibold tabular-nums text-foreground">
                          {currentDutyVal} {activeTest.unit}
                        </span>
                      </div>
                      <input
                        id="uds-duty-range"
                        type="range"
                        min={activeTest.min ?? 0}
                        max={activeTest.max ?? 100}
                        step={activeTest.step ?? 1}
                        value={currentDutyVal}
                        disabled={!interlockMet}
                        onChange={(e) => applyDutyValue(Number(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>

                    <div className="sm:col-span-4 flex flex-col gap-1.5">
                      <label htmlFor="uds-exact-num" className="text-xs font-medium text-muted">
                        Exact numeric command ({activeTest.unit})
                      </label>
                      <input
                        id="uds-exact-num"
                        type="number"
                        min={activeTest.min ?? 0}
                        max={activeTest.max ?? 100}
                        step={activeTest.step ?? 1}
                        value={currentDutyVal}
                        disabled={!interlockMet}
                        onChange={(e) => applyDutyValue(Number(e.target.value))}
                        className="min-h-10 rounded-control border border-border/55 bg-surface px-3 font-mono text-sm text-foreground"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTest.controlType === 'toggle_relay' && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    tone={overrides.evapSealActive ? 'danger' : 'primary'}
                    disabled={!interlockMet}
                    onClick={() => {
                      const next = !overrides.evapSealActive;
                      onUpdateOverrides({ evapSealActive: next });
                      appendUdsFrame(
                        activeTest.udsServiceHex,
                        next ? '01' : '00',
                        next
                          ? 'Closed EVAP vent solenoid & commanded purge pull (-450 Pa target)'
                          : 'Opened EVAP vent solenoid to atmosphere'
                      );
                    }}
                  >
                    {overrides.evapSealActive ? (
                      <>
                        <Square className="h-4 w-4" aria-hidden="true" />
                        <span>Vent EVAP system</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" aria-hidden="true" />
                        <span>Seal vent &amp; pull tank vacuum</span>
                      </>
                    )}
                  </Button>
                  <span className="text-xs text-muted">
                    Watch Tank Vapor Pressure settle near -460 Pa with zero leak decay.
                  </span>
                </div>
              )}

              {activeTest.controlType === 'bleed_sequence' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      disabled={!interlockMet || bleedStageIdx !== null}
                      onClick={() => {
                        setBleedStageIdx(0);
                        appendUdsFrame(
                          activeTest.udsServiceHex,
                          '01',
                          'Started automated 4-channel ABS hydraulic bleed routine ($31 $01)'
                        );
                      }}
                    >
                      <Play className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {bleedStageIdx !== null
                          ? 'Cycling HCU solenoids…'
                          : 'Start 4-corner ABS service bleed'}
                      </span>
                    </Button>
                    {bleedStageIdx !== null && (
                      <Button tone="quiet" onClick={() => setBleedStageIdx(null)}>
                        Abort routine
                      </Button>
                    )}
                  </div>
                  {bleedStageIdx !== null && bleedStageIdx < ABS_CORNERS.length && (
                    <p className="text-sm font-medium text-primary" role="status">
                      {ABS_CORNERS[bleedStageIdx]}
                    </p>
                  )}
                </div>
              )}

              {/* Recessed UDS ISO 14229 Hex Bus Frame Monitor */}
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                  UDS ISO 14229 ACTUATION FRAME LOG
                </div>
                <Surface inset className="p-3 font-mono text-xs space-y-1.5">
                  {udsLog.map((item) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-1 md:grid-cols-12 gap-1 md:gap-3 border-b border-border/25 last:border-b-0 pb-1.5 last:pb-0"
                    >
                      <span className="md:col-span-2 text-muted tabular-nums">{item.ts}</span>
                      <span className="md:col-span-5 text-foreground">
                        TX {item.tx} → RX {item.rx}
                      </span>
                      <span className="md:col-span-5 text-muted font-sans">{item.note}</span>
                    </div>
                  ))}
                </Surface>
              </div>
            </>
          ) : null}
        </Surface>
      </div>
    </div>
  );
};
