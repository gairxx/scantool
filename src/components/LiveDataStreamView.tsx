import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Download, Activity, Zap } from 'lucide-react';
import { Button, Surface, StatusMark } from './ui';
import { STANDARD_PIDS, encodeCanResponseFrame } from '../lib/obdProtocol';
import type { TelemetryOverrides, TelemetryRingStore } from '../lib/telemetryEngine';
import type { HardwareConnectionMode, VehicleProfile } from '../types/diagnostic';

interface LiveDataStreamViewProps {
  vehicle: VehicleProfile;
  ringStore: TelemetryRingStore;
  connectionMode: HardwareConnectionMode;
  overrides: TelemetryOverrides;
  onUpdateOverrides: (patch: Partial<TelemetryOverrides>) => void;
  isPaused: boolean;
  onTogglePause: () => void;
}

const TRACE_HEX_COLORS: Record<string, string> = {
  'var(--color-trace-1)': '#b93815',
  'var(--color-trace-2)': '#0f5e9c',
  'var(--color-trace-3)': '#116b52',
  'var(--color-trace-4)': '#8c5a08',
  'var(--color-trace-5)': '#0d6775',
  'var(--color-trace-6)': '#9c4215',
  'var(--color-trace-7)': '#3f6212',
  'var(--color-trace-8)': '#374151',
};

export const LiveDataStreamView: React.FC<LiveDataStreamViewProps> = ({
  vehicle,
  ringStore,
  connectionMode,
  overrides,
  onUpdateOverrides,
  isPaused,
  onTogglePause,
}) => {
  const [selectedPidIds, setSelectedPidIds] = useState<string[]>([
    'rpm',
    'stft1',
    'vct_in',
    'map',
  ]);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const [, setReadoutTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Refresh numeric table readouts at 10 Hz (smooth human reading without React DOM thrashing)
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!isPaused) {
        setReadoutTick((t) => (t + 1) % 100000);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [isPaused]);

  const watchedPids = useMemo(
    () => STANDARD_PIDS.filter((p) => selectedPidIds.includes(p.id)),
    [selectedPidIds]
  );

  // High-fps requestAnimationFrame oscilloscope renderer with separate horizontal lanes per unit
  useEffect(() => {
    let rafId = 0;

    const renderOscilloscope = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(320, Math.floor(rect.width));
        const laneHeight = 112;
        const topPad = 14;
        const bottomAxisHeight = 28;
        const totalHeight = Math.max(
          180,
          watchedPids.length * laneHeight + topPad + bottomAxisHeight
        );

        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(totalHeight * dpr)) {
          canvas.width = Math.floor(width * dpr);
          canvas.height = Math.floor(totalHeight * dpr);
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, totalHeight);

          const plotLeft = 64;
          const plotRight = width - 18;
          const plotWidth = Math.max(80, plotRight - plotLeft);
          const maxSamples = 240;

          // Vertical time gridlines
          ctx.strokeStyle = 'rgba(75, 85, 99, 0.16)';
          ctx.lineWidth = 1;
          const vTicks = 5;
          for (let g = 0; g <= vTicks; g++) {
            const gx = plotLeft + (plotWidth * g) / vTicks;
            ctx.beginPath();
            ctx.moveTo(gx, topPad);
            ctx.lineTo(gx, totalHeight - bottomAxisHeight);
            ctx.stroke();
          }

          watchedPids.forEach((pid, laneIndex) => {
            const laneTop = topPad + laneIndex * laneHeight;
            const laneBottom = laneTop + laneHeight - 14;
            const innerH = laneBottom - laneTop;
            const strokeHex = TRACE_HEX_COLORS[pid.traceColorVar] || '#0f5e9c';

            // Faint horizontal lane frame & midpoint line
            ctx.strokeStyle = 'rgba(75, 85, 99, 0.22)';
            ctx.beginPath();
            ctx.moveTo(plotLeft, laneBottom);
            ctx.lineTo(plotRight, laneBottom);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(75, 85, 99, 0.10)';
            ctx.beginPath();
            ctx.moveTo(plotLeft, laneTop + innerH / 2);
            ctx.lineTo(plotRight, laneTop + innerH / 2);
            ctx.stroke();

            // Y-axis min / max labels (single unit per lane)
            ctx.font = '500 11px "Geist Mono", monospace';
            ctx.fillStyle = '#4b5563';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText(`${pid.max}`, plotLeft - 8, laneTop);
            ctx.textBaseline = 'bottom';
            ctx.fillText(`${pid.min}`, plotLeft - 8, laneBottom);

            // Plot waveform trace
            const { times, values } = ringStore.getChronologicalSlice(pid.id, maxSamples);
            if (values.length > 1) {
              ctx.strokeStyle = strokeHex;
              ctx.lineWidth = 2;
              if (connectionMode === 'simulated') {
                ctx.setLineDash([]);
              } else {
                ctx.setLineDash([]);
              }
              ctx.beginPath();
              for (let i = 0; i < values.length; i++) {
                const x = plotLeft + (i / (maxSamples - 1)) * plotWidth;
                const clamped = Math.max(pid.min, Math.min(pid.max, values[i]));
                const norm = (clamped - pid.min) / Math.max(1e-6, pid.max - pid.min);
                const y = laneBottom - norm * innerH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.stroke();

              // Lane header pill in top-left open offset space (opaque ground backing per skill rule)
              const latestVal = values[values.length - 1];
              const headerText = `${pid.shortLabel}: ${latestVal.toFixed(pid.decimals)} ${pid.unit}`;
              ctx.font = '600 12px "Atkinson Hyperlegible Next", sans-serif';
              const textMetrics = ctx.measureText(headerText);
              const pillX = plotLeft + 10;
              const pillY = laneTop + 4;
              const pillW = textMetrics.width + 14;
              const pillH = 20;

              ctx.fillStyle = 'rgba(252, 251, 249, 0.92)';
              ctx.beginPath();
              ctx.roundRect(pillX, pillY, pillW, pillH, 4);
              ctx.fill();
              ctx.strokeStyle = 'rgba(75, 85, 99, 0.25)';
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.fillStyle = strokeHex;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(headerText, pillX + 7, pillY + pillH / 2);

              // Hover cursor inspection with exact (t, y) readout
              if (hoverFraction !== null) {
                const sampleIndex = Math.min(
                  values.length - 1,
                  Math.max(0, Math.round(hoverFraction * (maxSamples - 1)))
                );
                const cursorX = plotLeft + (sampleIndex / (maxSamples - 1)) * plotWidth;
                const valAtCursor = values[sampleIndex];
                const tRel = times[sampleIndex] - times[times.length - 1];
                const norm =
                  (Math.max(pid.min, Math.min(pid.max, valAtCursor)) - pid.min) /
                  Math.max(1e-6, pid.max - pid.min);
                const cursorY = laneBottom - norm * innerH;

                ctx.strokeStyle = 'rgba(31, 41, 55, 0.45)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(cursorX, laneTop);
                ctx.lineTo(cursorX, laneBottom);
                ctx.stroke();

                ctx.fillStyle = strokeHex;
                ctx.beginPath();
                ctx.arc(cursorX, cursorY, 4, 0, Math.PI * 2);
                ctx.fill();

                const inspectLabel = `${tRel.toFixed(1)} s · ${valAtCursor.toFixed(pid.decimals)} ${pid.unit}`;
                ctx.font = '500 11px "Geist Mono", monospace';
                const im = ctx.measureText(inspectLabel);
                const boxW = im.width + 12;
                const boxH = 19;
                const boxX =
                  cursorX + 12 + boxW > plotRight ? cursorX - 12 - boxW : cursorX + 12;
                const boxY = Math.max(laneTop + 4, Math.min(laneBottom - boxH - 4, cursorY - boxH / 2));

                ctx.fillStyle = 'rgba(252, 251, 249, 0.96)';
                ctx.beginPath();
                ctx.roundRect(boxX, boxY, boxW, boxH, 3);
                ctx.fill();
                ctx.strokeStyle = strokeHex;
                ctx.stroke();

                ctx.fillStyle = '#111827';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(inspectLabel, boxX + 6, boxY + boxH / 2);
              }
            }
          });

          // Shared X-axis time ticks at bottom
          ctx.font = '500 11px "Geist Mono", monospace';
          ctx.fillStyle = '#4b5563';
          ctx.textBaseline = 'top';
          for (let g = 0; g <= vTicks; g++) {
            const gx = plotLeft + (plotWidth * g) / vTicks;
            const secAgo = -12 + (g * 12) / vTicks;
            ctx.textAlign = g === 0 ? 'left' : g === vTicks ? 'right' : 'center';
            ctx.fillText(secAgo === 0 ? '0.0 s (Now)' : `${secAgo.toFixed(1)} s`, gx, totalHeight - 20);
          }

          ctx.restore();
        }
      }
      rafId = window.requestAnimationFrame(renderOscilloscope);
    };

    rafId = window.requestAnimationFrame(renderOscilloscope);
    return () => window.cancelAnimationFrame(rafId);
  }, [watchedPids, ringStore, hoverFraction, connectionMode]);

  const togglePidChannel = (pidId: string) => {
    setSelectedPidIds((prev) => {
      if (prev.includes(pidId)) {
        if (prev.length === 1) return prev; // keep at least 1 trace active
        return prev.filter((id) => id !== pidId);
      }
      if (prev.length >= 6) {
        return [...prev.slice(1), pidId];
      }
      return [...prev, pidId];
    });
  };

  const handleExportCsv = () => {
    const maxRows = 200;
    const baseSlice = ringStore.getChronologicalSlice('rpm', maxRows);
    const header = [
      'timestamp_rel_s',
      ...STANDARD_PIDS.map((p) => `${p.modePid}_${p.id}_${p.unit}`),
    ].join(',');

    const allSlices: Record<string, number[]> = {};
    for (const p of STANDARD_PIDS) {
      allSlices[p.id] = ringStore.getChronologicalSlice(p.id, maxRows).values;
    }

    const tEnd = baseSlice.times[baseSlice.times.length - 1] || 0;
    const rows = baseSlice.times.map((t, idx) => {
      const rel = (t - tEnd).toFixed(3);
      const cols = STANDARD_PIDS.map((p) => (allSlices[p.id][idx] ?? 0).toFixed(p.decimals));
      return [rel, ...cols].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `torquelink-telemetry-${vehicle.vin}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const plotLeft = 64;
    const plotRight = rect.width - 18;
    const x = e.clientX - rect.left;
    if (x < plotLeft || x > plotRight) {
      setHoverFraction(null);
      return;
    }
    setHoverFraction((x - plotLeft) / Math.max(1, plotRight - plotLeft));
  };

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <Surface className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-display text-foreground">Real-time OBD-II &amp; UDS telemetry</h1>
              <StatusMark
                kind={connectionMode === 'simulated' ? 'advisory' : 'nominal'}
                label={
                  connectionMode === 'simulated'
                    ? 'Simulated VCI stream'
                    : connectionMode === 'bluetooth_ble'
                      ? 'Measured Bluetooth BLE'
                      : 'Measured USB Serial'
                }
              />
            </div>
            <p className="text-sm text-muted">
              Multi-channel ring-buffer oscilloscope · {ringStore.framesPerSecond} PID frames/s ·{' '}
              {ringStore.totalFramesProcessed.toLocaleString()} packets captured
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button tone={isPaused ? 'primary' : 'quiet'} onClick={onTogglePause}>
              {isPaused ? (
                <>
                  <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Resume stream</span>
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Freeze buffer</span>
                </>
              )}
            </Button>

            <Button
              tone={overrides.highLoadStressBurst ? 'primary' : 'quiet'}
              onClick={() =>
                onUpdateOverrides({ highLoadStressBurst: !overrides.highLoadStressBurst })
              }
            >
              <Zap className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {overrides.highLoadStressBurst ? 'High-load 24-PID burst ON' : '24-PID stress burst'}
              </span>
            </Button>

            <Button tone="quiet" onClick={handleExportCsv}>
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Export CSV</span>
            </Button>
          </div>
        </div>

        {/* Bench Dynamometer / Engine Load & Fault Controls */}
        <div className="mt-4 pt-4 border-t border-border/40 grid grid-cols-1 md:grid-cols-3 gap-5 items-center">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="pedal-load-slider" className="font-medium text-foreground">
                Simulated accelerator load
              </label>
              <span className="font-mono tabular-nums text-foreground">
                {overrides.simulatedThrottleDemandPct} %
              </span>
            </div>
            <input
              id="pedal-load-slider"
              type="range"
              min={0}
              max={75}
              step={5}
              value={overrides.simulatedThrottleDemandPct}
              disabled={overrides.ignitionState === 'KOEO'}
              onChange={(e) =>
                onUpdateOverrides({ simulatedThrottleDemandPct: Number(e.target.value) })
              }
              className="w-full accent-primary"
            />
            <div className="text-xs text-muted">
              Raise load to observe MAP, MAF, VCT advance, and vacuum-leak fuel trim recovery.
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-foreground">Ignition &amp; engine state</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Ignition mode">
              {(['KOER', 'KOEO'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onUpdateOverrides({ ignitionState: mode })}
                  className={`min-h-9 px-3 rounded-control text-xs font-medium border whitespace-nowrap ${
                    overrides.ignitionState === mode
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-surface text-foreground border-border/55 hover:bg-background'
                  }`}
                >
                  {mode === 'KOER' ? 'KOER (Engine running)' : 'KOEO (Ignition on, engine off)'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-foreground">Transient fault trigger</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  onUpdateOverrides({ faultInjectionMisfire: !overrides.faultInjectionMisfire })
                }
                className={`min-h-9 px-3 rounded-control text-xs font-medium border whitespace-nowrap ${
                  overrides.faultInjectionMisfire
                    ? 'bg-fault text-primary-foreground border-fault'
                    : 'bg-surface text-foreground border-border/55 hover:bg-background'
                }`}
              >
                {overrides.faultInjectionMisfire
                  ? 'Cyl #4 misfire stumble active'
                  : 'Inject Cyl #4 load stumble'}
              </button>
            </div>
          </div>
        </div>
      </Surface>

      {/* Recessed Multi-Channel Oscilloscope Canvas */}
      <Surface className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-title text-foreground">
              Synchronized multi-lane waveform scope ({watchedPids.length} of 6 channels active)
            </h2>
          </div>
          <span className="text-xs text-muted">
            Hover or tap waveform for exact (time, value) cursor readout · Each unit plotted on dedicated axis
          </span>
        </div>

        {/* Channel selector toggles */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Oscilloscope PID channels">
          {STANDARD_PIDS.map((pid) => {
            const active = selectedPidIds.includes(pid.id);
            return (
              <button
                key={pid.id}
                type="button"
                onClick={() => togglePidChannel(pid.id)}
                aria-pressed={active}
                className={`min-h-8 px-2.5 rounded-control text-xs font-medium border whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-surface text-foreground border-border/50 hover:bg-background'
                }`}
              >
                {pid.shortLabel} ({pid.unit})
              </button>
            );
          })}
        </div>

        <Surface inset className="p-2">
          <canvas
            ref={canvasRef}
            onPointerMove={handleCanvasPointer}
            onPointerLeave={() => setHoverFraction(null)}
            style={{
              height: `${Math.max(180, watchedPids.length * 112 + 42)}px`,
            }}
            className="w-full block cursor-crosshair touch-none"
            aria-label="Live automotive OBD-II PID waveform oscilloscope"
          />
        </Surface>
      </Surface>

      {/* Complete 14-PID Tabular Live Data Grid with Raw CAN Hex Frame Readout */}
      <Surface className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-title text-foreground">All SAE J1979 &amp; UDS $22 parameter readouts</h2>
            <p className="text-sm text-muted">
              Click &ldquo;Graph&rdquo; on any row to pin or unpin its waveform in the oscilloscope above.
            </p>
          </div>
          <span className="text-xs font-mono text-muted">
            Sampling interval: {overrides.highLoadStressBurst ? '5 ms (200 Hz)' : '40 ms (25 Hz)'}
          </span>
        </div>

        <div className="overflow-x-auto border-t border-border/40">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border/40 text-xs font-semibold uppercase tracking-wider text-muted">
                <th className="py-2.5 pr-3">PID</th>
                <th className="py-2.5 px-3">PARAMETER</th>
                <th className="py-2.5 px-3 text-right">CURRENT</th>
                <th className="py-2.5 px-3 text-right">MIN / MAX</th>
                <th className="py-2.5 px-3">SPEC RANGE</th>
                <th className="py-2.5 px-3">CAN HEX RX</th>
                <th className="py-2.5 pl-3 text-right">SCOPE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 text-sm">
              {STANDARD_PIDS.map((pid) => {
                const st = ringStore.stats[pid.id] || { latest: 0, min: 0, max: 0 };
                const val = st.latest;
                const outOfNominal =
                  overrides.ignitionState === 'KOER' &&
                  (val < pid.nominalMin || val > pid.nominalMax);
                const graphed = selectedPidIds.includes(pid.id);

                return (
                  <tr key={pid.id} className="hover:bg-background/60">
                    <td className="py-2.5 pr-3 font-mono text-xs text-muted whitespace-nowrap">
                      0x{pid.modePid}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-foreground">{pid.shortLabel}</div>
                      <div className="text-xs text-muted">{pid.description}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <span
                        className={`font-mono text-base font-semibold tabular-nums ${
                          outOfNominal ? 'text-fault' : 'text-foreground'
                        }`}
                      >
                        {val.toFixed(pid.decimals)}
                      </span>{' '}
                      <span className="text-xs text-muted">{pid.unit}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-muted whitespace-nowrap">
                      {Number.isFinite(st.min) ? st.min.toFixed(pid.decimals) : '—'} /{' '}
                      {Number.isFinite(st.max) ? st.max.toFixed(pid.decimals) : '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted whitespace-nowrap">
                      {pid.nominalMin}..{pid.nominalMax} {pid.unit}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted whitespace-nowrap">
                      {encodeCanResponseFrame('7E8', pid.modePid, val)}
                    </td>
                    <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => togglePidChannel(pid.id)}
                        className={`min-h-8 px-2.5 rounded-control text-xs font-medium border ${
                          graphed
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-surface text-foreground border-border/50 hover:bg-background'
                        }`}
                      >
                        {graphed ? 'Pinned' : 'Graph'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Surface>
    </div>
  );
};
