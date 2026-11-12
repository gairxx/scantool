import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  RotateCcw,
  Trash2,
  CheckCircle2,
  ArrowUpRight,
  Search,
  BookOpen,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button, Surface, StatusMark } from './ui';
import { LemonManualEmbed } from './LemonManualEmbed';
import { analyzeDtcForVehicle } from '../data/knowledgeBase';
import type {
  BusNetworkType,
  DtcAnalysisResult,
  DtcRecord,
  EcuModule,
  ReadinessMonitor,
  VehicleProfile,
} from '../types/diagnostic';

interface TopologyAndDtcViewProps {
  vehicle: VehicleProfile;
  modules: EcuModule[];
  dtcs: DtcRecord[];
  readiness: ReadinessMonitor[];
  isScanning: boolean;
  scanProgressModuleId: string | null;
  onRunFullScan: () => void;
  onClearAllDtcs: () => void;
  onJumpToTab: (
    tab: 'live' | 'active' | 'programming' | 'reports' | 'library' | 'manual',
    focusModuleId?: string
  ) => void;
}

const BUS_LANES: Array<{ bus: BusNetworkType; y: number; color: string; speedLabel: string }> = [
  { bus: 'FD-CAN', y: 74, color: 'var(--color-trace-2)', speedLabel: 'FD-CAN 2000 kbps' },
  { bus: 'HS-CAN', y: 158, color: 'var(--color-trace-3)', speedLabel: 'HS-CAN 500 kbps' },
  { bus: 'MS-CAN', y: 242, color: 'var(--color-trace-4)', speedLabel: 'MS-CAN 125 kbps' },
  { bus: 'LIN / IMMO', y: 312, color: 'var(--color-trace-6)', speedLabel: 'LIN / IMMO 19.2k' },
];

export const TopologyAndDtcView: React.FC<TopologyAndDtcViewProps> = ({
  vehicle,
  modules,
  dtcs,
  readiness,
  isScanning,
  scanProgressModuleId,
  onRunFullScan,
  onClearAllDtcs,
  onJumpToTab,
}) => {
  const [selectedModuleId, setSelectedModuleId] = useState<string | 'ALL'>('ALL');
  const [selectedDtcId, setSelectedDtcId] = useState<string | null>(dtcs[0]?.id ?? null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Confirmed' | 'Pending' | 'History'>('ALL');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Advanced DTC Knowledge Base query state
  const [customDtcQuery, setCustomDtcQuery] = useState<string>('');
  const [queriedCodeOverride, setQueriedCodeOverride] = useState<string | null>(null);
  const [dtcAnalysis, setDtcAnalysis] = useState<DtcAnalysisResult | null>(null);
  const [isAnalyzingDtc, setIsAnalyzingDtc] = useState<boolean>(false);
  const [expandedTsbNumber, setExpandedTsbNumber] = useState<string | null>(null);
  const [embeddedManualUrl, setEmbeddedManualUrl] = useState<string | null>(null);
  const [embeddedManualNonce, setEmbeddedManualNonce] = useState<number>(0);
  const [embeddedInitialSection, setEmbeddedInitialSection] = useState<
    'dtc_index' | 'tsbs' | 'repair'
  >('dtc_index');
  const lemonEmbedRef = useRef<HTMLDivElement | null>(null);

  const dtcCountsByModule = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of dtcs) {
      counts[d.moduleId] = (counts[d.moduleId] || 0) + 1;
    }
    return counts;
  }, [dtcs]);

  const filteredDtcs = useMemo(() => {
    return dtcs.filter((d) => {
      if (selectedModuleId !== 'ALL' && d.moduleId !== selectedModuleId) return false;
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
      return true;
    });
  }, [dtcs, selectedModuleId, statusFilter]);

  const activeDtc = useMemo(() => {
    return (
      filteredDtcs.find((d) => d.id === selectedDtcId) ||
      filteredDtcs[0] ||
      null
    );
  }, [filteredDtcs, selectedDtcId]);

  const selectedModule = useMemo(
    () => (selectedModuleId === 'ALL' ? null : modules.find((m) => m.id === selectedModuleId) || null),
    [modules, selectedModuleId]
  );

  // Pure deterministic node positions along horizontal bus trunks (no overlap, >=14px label clearance)
  const positionedNodes = useMemo(() => {
    return BUS_LANES.flatMap((lane) => {
      const busModules = modules.filter((m) => m.bus === lane.bus);
      return busModules.map((mod, idx) => {
        const spacing = 176;
        const cx = 248 + idx * spacing;
        const cy = lane.y;
        return { mod, cx, cy, laneColor: lane.color };
      });
    });
  }, [modules]);

  const faultModuleCount = modules.filter((m) => (dtcCountsByModule[m.id] ?? 0) > 0).length;

  const targetAnalysisCode = queriedCodeOverride || activeDtc?.code || '';

  useEffect(() => {
    setQueriedCodeOverride(null);
    setCustomDtcQuery('');
    setEmbeddedManualUrl(null);
    setEmbeddedInitialSection('dtc_index');
  }, [vehicle.id]);

  const openInEmbeddedManual = (
    url: string | null,
    section: 'dtc_index' | 'tsbs' | 'repair' = 'tsbs'
  ) => {
    setEmbeddedInitialSection(section);
    setEmbeddedManualUrl(url);
    setEmbeddedManualNonce((n) => n + 1);
    lemonEmbedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (!targetAnalysisCode) {
      setDtcAnalysis(null);
      return;
    }
    let cancelled = false;
    const queryKnowledgeBase = async () => {
      setIsAnalyzingDtc(true);
      try {
        const qs = new URLSearchParams({
          code: targetAnalysisCode,
          make: vehicle.make,
          model: vehicle.model,
          year: String(vehicle.year),
        });
        const res = await fetch(`/api/dtc-analysis?${qs.toString()}`);
        if (!res.ok) throw new Error('Knowledge base lookup error');
        const data = (await res.json()) as { analysis: DtcAnalysisResult };
        if (!cancelled) {
          setDtcAnalysis(data.analysis);
          setExpandedTsbNumber(data.analysis.relatedTsbs[0]?.tsbNumber ?? null);
        }
      } catch {
        if (!cancelled) {
          const fallback = analyzeDtcForVehicle(
            targetAnalysisCode,
            vehicle.make,
            vehicle.model,
            vehicle.year
          );
          setDtcAnalysis(fallback);
          setExpandedTsbNumber(fallback.relatedTsbs[0]?.tsbNumber ?? null);
        }
      } finally {
        if (!cancelled) setIsAnalyzingDtc(false);
      }
    };
    void queryKnowledgeBase();
    return () => {
      cancelled = true;
    };
  }, [targetAnalysisCode, vehicle.make, vehicle.model, vehicle.year]);

  const handleManualDtcLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customDtcQuery.trim().toUpperCase();
    if (!clean) return;
    setQueriedCodeOverride(clean);
  };

  return (
    <div className="space-y-5">
      {/* Top Action & Summary Row */}
      <Surface className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="text-display text-foreground">
              Network topology and fault memory
            </h1>
            <p className="text-sm text-muted">
              {vehicle.year} {vehicle.make} {vehicle.model} ({vehicle.trimEngine}) ·{' '}
              <span className="font-mono text-foreground">{vehicle.vin}</span> ·{' '}
              {vehicle.odometerKm.toLocaleString()} km
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button onClick={onRunFullScan} disabled={isScanning}>
              <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{isScanning ? 'Polling buses…' : 'Scan all modules'}</span>
            </Button>
            {confirmClearOpen ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  tone="danger"
                  onClick={() => {
                    onClearAllDtcs();
                    setConfirmClearOpen(false);
                  }}
                  disabled={isScanning}
                >
                  Confirm Mode $04 clear
                </Button>
                <Button tone="quiet" onClick={() => setConfirmClearOpen(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                tone="quiet"
                onClick={() => setConfirmClearOpen(true)}
                disabled={dtcs.length === 0 || isScanning}
              >
                <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Clear all DTCs</span>
              </Button>
            )}
            <Button tone="quiet" onClick={() => onJumpToTab('manual')}>
              <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Repair manual (lemon.dogeware.me)</span>
            </Button>
            <Button tone="quiet" onClick={() => onJumpToTab('reports')}>
              <span>Save pre/post scan</span>
              <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* Ruled summary readouts directly on Surface (no nested stat boxes) */}
        <div className="mt-4 pt-4 border-t border-border/40 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:divide-x sm:divide-border/40">
          <div className="min-w-0 sm:pr-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">
              MODULES ONLINE
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {modules.length}
              </span>
              <span className="text-sm text-muted">ECUs responding on 4 buses</span>
            </div>
          </div>

          <div className="min-w-0 sm:px-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">
              ACTIVE FAULT CODES
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-2xl font-semibold tabular-nums ${
                  dtcs.length > 0 ? 'text-fault' : 'text-nominal'
                }`}
              >
                {dtcs.length}
              </span>
              <span className="text-sm text-muted">
                {faultModuleCount > 0
                  ? `across ${faultModuleCount} ${faultModuleCount === 1 ? 'module' : 'modules'}`
                  : 'all modules clear'}
              </span>
            </div>
          </div>

          <div className="min-w-0 sm:px-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">
              OBD-II MONITORS
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {readiness.filter((r) => r.status === 'Complete').length}/{readiness.length}
              </span>
              <span className="text-sm text-muted">ready for emissions inspection</span>
            </div>
          </div>

          <div className="min-w-0 sm:pl-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">
              CALIBRATION BULLETINS
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {vehicle.calibrations.length}
              </span>
              <span className="text-sm text-muted">J2534 flash updates matched</span>
            </div>
          </div>
        </div>
      </Surface>

      {/* Main Split: Multi-Bus Network Schematic + Module Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <Surface className="xl:col-span-8 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-title text-foreground">Multi-bus ECU network diagram</h2>
              <p className="text-sm text-muted">
                Select any control module node to isolate its fault codes, CAN IDs, and software calibration.
              </p>
            </div>
            {selectedModuleId !== 'ALL' && (
              <Button size="sm" tone="quiet" onClick={() => setSelectedModuleId('ALL')}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Show all modules</span>
              </Button>
            )}
          </div>

          {/* Interactive SVG Bus Topology */}
          <div className="overflow-x-auto border-t border-b border-border/40 py-2">
            <svg
              viewBox="0 0 880 356"
              className="h-auto w-full min-w-[660px]"
              role="img"
              aria-label="Vehicle CAN FD, HS-CAN, MS-CAN, and Immobilizer LIN network topology"
            >
              {/* DLC J1962 Gateway Spine on left */}
              <rect
                x={20}
                y={48}
                width={102}
                height={286}
                rx={6}
                fill="var(--color-surface-recessed)"
                stroke="var(--color-border)"
                strokeWidth={1.5}
              />
              <text
                x={71}
                y={178}
                textAnchor="middle"
                className="svg-halo fill-foreground text-[13px] font-semibold"
              >
                DLC J1962
              </text>
              <text
                x={71}
                y={198}
                textAnchor="middle"
                className="svg-halo fill-muted text-[11px] font-mono"
              >
                16-Pin Port
              </text>
              <text
                x={71}
                y={218}
                textAnchor="middle"
                className="svg-halo fill-primary text-[11px] font-medium"
              >
                J2534 Bridge
              </text>

              {/* Horizontal Bus Trunks */}
              {BUS_LANES.map((lane) => (
                <g key={lane.bus}>
                  <line
                    x1={122}
                    y1={lane.y}
                    x2={850}
                    y2={lane.y}
                    stroke={lane.color}
                    strokeWidth={2}
                    strokeDasharray={lane.bus === 'LIN / IMMO' ? '5 4' : undefined}
                  />
                  {/* Bus label offset 14px above trunk in open left span */}
                  <text
                    x={132}
                    y={lane.y - 14}
                    textAnchor="start"
                    className="svg-halo fill-muted text-[11px] font-mono"
                  >
                    {lane.speedLabel}
                  </text>
                </g>
              ))}

              {/* ECU Module Nodes */}
              {positionedNodes.map(({ mod, cx, cy }) => {
                const faultCount = dtcCountsByModule[mod.id] ?? 0;
                const isSelected = selectedModuleId === mod.id;
                const isPolling = scanProgressModuleId === mod.id;
                const strokeColor = isPolling
                  ? 'var(--color-primary)'
                  : faultCount > 0
                    ? 'var(--color-fault)'
                    : mod.status === 'Advisory'
                      ? 'var(--color-advisory)'
                      : 'var(--color-nominal)';

                return (
                  <g
                    key={mod.id}
                    onClick={() =>
                      setSelectedModuleId((prev) => (prev === mod.id ? 'ALL' : mod.id))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedModuleId((prev) => (prev === mod.id ? 'ALL' : mod.id));
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-pressed={isSelected}
                    aria-label={`${mod.shortCode} ${mod.name}, ${faultCount} fault codes`}
                    className="cursor-pointer focus:outline-none"
                  >
                    <rect
                      x={cx - 62}
                      y={cy - 23}
                      width={124}
                      height={46}
                      rx={5}
                      fill={isSelected ? 'var(--color-background)' : 'var(--color-surface)'}
                      stroke={isSelected ? 'var(--color-primary)' : strokeColor}
                      strokeWidth={isSelected || isPolling ? 2.5 : 1.5}
                    />
                    <text
                      x={cx - 48}
                      y={cy - 4}
                      textAnchor="start"
                      className="svg-halo fill-foreground text-[12px] font-semibold"
                    >
                      {mod.shortCode}
                    </text>
                    <text
                      x={cx + 50}
                      y={cy - 4}
                      textAnchor="end"
                      className={`svg-halo text-[11px] font-mono font-medium ${
                        faultCount > 0 ? 'fill-fault' : 'fill-nominal'
                      }`}
                    >
                      {isPolling ? 'SCAN' : faultCount > 0 ? `${faultCount} DTC` : 'PASS'}
                    </text>
                    <text
                      x={cx - 48}
                      y={cy + 13}
                      textAnchor="start"
                      className="svg-halo fill-muted text-[11px] font-mono"
                    >
                      0x{mod.canTxId} · {mod.responseTimeMs.toFixed(1)}ms
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <div className="flex flex-wrap items-center gap-4">
              <StatusMark kind="nominal" label="Pass (0 DTCs)" />
              <StatusMark kind="advisory" label="Advisory / Bulletin" />
              <StatusMark kind="fault" label="Fault stored" />
            </div>
            <span>Measured bus ping latency in ms · Click any ECU node to filter</span>
          </div>
        </Surface>

        {/* Right Column: Selected ECU Details + OBD Readiness Monitors */}
        <Surface className="xl:col-span-4 p-4 sm:p-5 space-y-4">
          {selectedModule ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-title text-foreground">{selectedModule.name}</h2>
                  <p className="text-xs font-mono text-muted">
                    {selectedModule.bus} · TX 0x{selectedModule.canTxId} / RX 0x{selectedModule.canRxId}
                  </p>
                </div>
                <StatusMark
                  kind={
                    (dtcCountsByModule[selectedModule.id] ?? 0) > 0
                      ? 'fault'
                      : selectedModule.status === 'Advisory'
                        ? 'advisory'
                        : 'nominal'
                  }
                  label={
                    (dtcCountsByModule[selectedModule.id] ?? 0) > 0
                      ? `${dtcCountsByModule[selectedModule.id]} Fault`
                      : selectedModule.status
                  }
                />
              </div>

              <dl className="divide-y divide-border/40 border-t border-b border-border/40 text-sm">
                <div className="py-2 flex items-center justify-between gap-2">
                  <dt className="text-muted">Hardware part no.</dt>
                  <dd className="font-mono text-foreground">{selectedModule.partNumber}</dd>
                </div>
                <div className="py-2 flex items-center justify-between gap-2">
                  <dt className="text-muted">Current calibration</dt>
                  <dd className="font-mono text-foreground">{selectedModule.calibrationId}</dd>
                </div>
                <div className="py-2 flex items-center justify-between gap-2">
                  <dt className="text-muted">Available J2534 update</dt>
                  <dd className="font-mono text-primary">
                    {selectedModule.targetCalibrationId || 'Up to date'}
                  </dd>
                </div>
                <div className="py-2 flex items-center justify-between gap-2">
                  <dt className="text-muted">UDS ping latency</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    {selectedModule.responseTimeMs.toFixed(1)} ms
                  </dd>
                </div>
              </dl>

              {selectedModule.calibrationReleaseNote && (
                <p className="text-xs text-muted leading-relaxed">
                  {selectedModule.calibrationReleaseNote}
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" onClick={() => onJumpToTab('active')}>
                  Active tests
                </Button>
                <Button
                  size="sm"
                  tone="quiet"
                  onClick={() => onJumpToTab('library', selectedModule.id)}
                >
                  Wiring &amp; pinouts
                </Button>
                {selectedModule.targetCalibrationId && (
                  <Button size="sm" tone="quiet" onClick={() => onJumpToTab('programming')}>
                    Flash update
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <h2 className="text-title text-foreground">Mode $01 readiness monitors</h2>
                <p className="text-sm text-muted">
                  Continuous and drive-cycle emissions self-tests reported by primary powertrain ECU.
                </p>
              </div>
              <div className="divide-y divide-border/40 border-t border-border/40">
                {readiness.map((mon) => (
                  <div
                    key={mon.id}
                    className="py-2.5 flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{mon.name}</div>
                      <div className="text-xs text-muted">{mon.category}</div>
                    </div>
                    <StatusMark
                      kind={mon.status === 'Complete' ? 'nominal' : 'advisory'}
                      label={mon.status}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Surface>
      </div>

      {/* Diagnostic Trouble Codes Table + Freeze Frame & Guided Troubleshooting */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <Surface className="xl:col-span-7 p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-title text-foreground">Diagnostic trouble codes (Mode $03 / UDS $19)</h2>
              <p className="text-sm text-muted">
                {selectedModuleId === 'ALL'
                  ? 'Showing stored, pending, and historical fault records across all modules.'
                  : `Filtered to module ${selectedModuleId}.`}
              </p>
            </div>

            {/* Filter chips (interactive controls) */}
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter DTC status">
              {(['ALL', 'Confirmed', 'Pending', 'History'] as const).map((st) => {
                const active = statusFilter === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`min-h-8 px-2.5 rounded-control text-xs font-medium whitespace-nowrap border transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-surface text-foreground border-border/50 hover:bg-background'
                    }`}
                  >
                    {st === 'ALL' ? 'All states' : st}
                  </button>
                );
              })}
            </div>
          </div>

          {filteredDtcs.length === 0 ? (
            <div className="border-t border-border/40 pt-6 pb-4 flex items-center gap-3 text-sm text-muted">
              <CheckCircle2 className="h-5 w-5 text-nominal shrink-0" aria-hidden="true" />
              <span>
                No trouble codes match the current filter. Run &ldquo;Scan all modules&rdquo; to re-poll vehicle fault memory.
              </span>
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-border/40">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/40 text-xs font-semibold uppercase tracking-wider text-muted">
                    <th className="py-2.5 pr-3">DTC</th>
                    <th className="py-2.5 px-3">MODULE</th>
                    <th className="py-2.5 px-3">STATE</th>
                    <th className="py-2.5 pl-3">DESCRIPTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 text-sm">
                    {filteredDtcs.map((dtc) => {
                    const isSelected = !queriedCodeOverride && activeDtc?.id === dtc.id;
                    return (
                      <tr
                        key={dtc.id}
                        onClick={() => {
                          setQueriedCodeOverride(null);
                          setSelectedDtcId(dtc.id);
                        }}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setQueriedCodeOverride(null);
                            setSelectedDtcId(dtc.id);
                          }
                        }}
                        aria-selected={isSelected}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-background' : 'hover:bg-background/60'
                        }`}
                      >
                        <td className="py-3 pr-3 font-mono font-semibold text-foreground whitespace-nowrap">
                          {dtc.code}
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-muted whitespace-nowrap">
                          {dtc.moduleId}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <StatusMark
                            kind={
                              dtc.status === 'Confirmed'
                                ? 'fault'
                                : dtc.status === 'Pending'
                                  ? 'advisory'
                                  : 'neutral'
                            }
                            label={dtc.status}
                          />
                        </td>
                        <td className="py-3 pl-3 text-foreground">{dtc.description}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Surface>

        {/* Freeze Frame Snapshot ($02) & Module Pinout Quick Link */}
        <Surface className="xl:col-span-5 p-4 sm:p-5 space-y-4">
          {activeDtc ? (
            <>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-title text-foreground">
                    Mode $02 freeze frame ·{' '}
                    <span className="font-mono">{activeDtc.code}</span>
                  </h2>
                </div>
                <p className="text-sm text-muted">
                  {activeDtc.system} · {activeDtc.occurrenceCount} occurrences since{' '}
                  {activeDtc.firstMileageKm.toLocaleString()} km
                </p>
              </div>

              <div className="border-t border-b border-border/40 divide-y divide-border/40 text-sm">
                <div className="py-2 flex items-center justify-between">
                  <span className="text-muted">Engine speed at fault</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {activeDtc.freezeFrame.rpm.toLocaleString()} rpm
                  </span>
                </div>
                <div className="py-2 flex items-center justify-between">
                  <span className="text-muted">Vehicle speed / Load</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {activeDtc.freezeFrame.speedKmh} km/h · {activeDtc.freezeFrame.loadPct.toFixed(1)} %
                  </span>
                </div>
                <div className="py-2 flex items-center justify-between">
                  <span className="text-muted">Manifold absolute pressure</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {activeDtc.freezeFrame.mapKpa} kPa
                  </span>
                </div>
                <div className="py-2 flex items-center justify-between">
                  <span className="text-muted">Coolant temperature</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {activeDtc.freezeFrame.coolantC} °C
                  </span>
                </div>
                <div className="py-2 flex items-center justify-between">
                  <span className="text-muted">Fuel trim B1 (STFT / LTFT)</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {activeDtc.freezeFrame.stftB1Pct > 0 ? '+' : ''}
                    {activeDtc.freezeFrame.stftB1Pct.toFixed(1)} % /{' '}
                    {activeDtc.freezeFrame.ltftB1Pct > 0 ? '+' : ''}
                    {activeDtc.freezeFrame.ltftB1Pct.toFixed(1)} %
                  </span>
                </div>
                <div className="py-2 flex items-center justify-between">
                  <span className="text-muted">Terminal 30 voltage</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {activeDtc.freezeFrame.batteryV.toFixed(2)} V
                  </span>
                </div>
              </div>

              <div className="pt-1 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onJumpToTab('live')}>
                  Graph related PIDs
                </Button>
                <Button size="sm" tone="quiet" onClick={() => onJumpToTab('active')}>
                  Run component test
                </Button>
                <Button
                  size="sm"
                  tone="quiet"
                  onClick={() => onJumpToTab('library', activeDtc.moduleId)}
                >
                  Open {activeDtc.moduleId} wiring
                </Button>
              </div>
            </>
          ) : (
            <div className="py-6 text-sm text-muted">
              Select a diagnostic trouble code to inspect its Mode $02 freeze-frame telemetry, or query any DTC code below in the knowledge base.
            </div>
          )}
        </Surface>
      </div>

      {/* Advanced DTC Knowledge Base Analysis: Causes, Steps & Vehicle-Specific TSBs */}
      <Surface className="p-4 sm:p-5 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between border-b border-border/40 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-title text-foreground">
                Advanced DTC analysis &amp; Technical Service Bulletins
              </h2>
            </div>
            <p className="text-sm text-muted">
              Automatic OEM knowledge base query for {vehicle.year} {vehicle.make} {vehicle.model}, or enter any SAE/OEM DTC code manually.
            </p>
          </div>

          <form onSubmit={handleManualDtcLookup} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="dtc-kb-lookup" className="text-xs font-medium text-muted">
                Manual DTC code lookup
              </label>
              <input
                id="dtc-kb-lookup"
                type="text"
                value={customDtcQuery}
                onChange={(e) => setCustomDtcQuery(e.target.value.toUpperCase())}
                placeholder="e.g. P0304, P0300, P0420"
                className="min-h-10 w-48 rounded-control border border-border/55 bg-surface px-3 font-mono text-sm text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-primary"
              />
            </div>
            <Button type="submit" size="sm">
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Analyze code</span>
            </Button>
            {queriedCodeOverride && (
              <Button
                size="sm"
                tone="quiet"
                onClick={() => {
                  setQueriedCodeOverride(null);
                  setCustomDtcQuery('');
                }}
              >
                Reset to active DTC
              </Button>
            )}
          </form>
        </div>

        {isAnalyzingDtc ? (
          <p className="text-sm text-muted py-4">
            Querying OEM fault knowledge base &amp; TSB index for {targetAnalysisCode}…
          </p>
        ) : dtcAnalysis ? (
          <div className="space-y-5">
            {/* Summary Strip */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-mono text-lg font-semibold text-foreground">
                    {dtcAnalysis.code}
                  </span>
                  <span className="text-base font-semibold text-foreground">
                    {dtcAnalysis.title}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  Scope: <span className="font-medium text-foreground">{dtcAnalysis.matchScope}</span> ·{' '}
                  {dtcAnalysis.vehicleMatch}
                </p>
              </div>

              <StatusMark
                kind={
                  dtcAnalysis.severity === 'High'
                    ? 'fault'
                    : dtcAnalysis.severity === 'Moderate'
                      ? 'advisory'
                      : 'neutral'
                }
                label={`${dtcAnalysis.severity} severity`}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-b border-border/40 py-3.5 text-sm">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                  ECU SETTING CRITERIA
                </div>
                <p className="mt-1 text-foreground leading-relaxed">
                  {dtcAnalysis.settingCriteria}
                </p>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                  DRIVABILITY &amp; EMISSIONS IMPACT
                </div>
                <p className="mt-1 text-foreground leading-relaxed">
                  {dtcAnalysis.drivabilityImpact}
                </p>
              </div>
            </div>

            {/* 3-Column Technical Breakdown: Causes | Recommended Steps | TSBs */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Potential Causes */}
              <div className="lg:col-span-4 space-y-2.5">
                <h3 className="text-sm font-semibold text-foreground">
                  Ranked potential causes ({dtcAnalysis.potentialCauses.length})
                </h3>
                <div className="divide-y divide-border/40 border-t border-border/40 text-sm">
                  {dtcAnalysis.potentialCauses.map((item, idx) => (
                    <div key={idx} className="py-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{item.cause}</span>
                        <StatusMark
                          kind={
                            item.likelihood === 'Primary'
                              ? 'fault'
                              : item.likelihood === 'Secondary'
                                ? 'advisory'
                                : 'neutral'
                          }
                          label={item.likelihood}
                        />
                      </div>
                      <p className="text-xs text-muted leading-relaxed">{item.detail}</p>
                      {item.targetSpec && (
                        <p className="font-mono text-xs text-primary">{item.targetSpec}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommended Diagnostic Steps */}
              <div className="lg:col-span-4 space-y-2.5">
                <h3 className="text-sm font-semibold text-foreground">
                  Recommended pinpoint steps ({dtcAnalysis.diagnosticSteps.length})
                </h3>
                <div className="divide-y divide-border/40 border-t border-border/40 text-sm">
                  {dtcAnalysis.diagnosticSteps.map((step) => (
                    <div key={step.step} className="py-3 space-y-1.5">
                      <div className="font-medium text-foreground">
                        <span className="font-mono text-primary mr-1.5">{step.step}.</span>
                        {step.title}
                      </div>
                      <p className="text-xs text-muted leading-relaxed">{step.procedure}</p>
                      <div className="font-mono text-xs text-nominal">
                        Pass spec: {step.expectedSpec}
                      </div>
                      {step.recommendedTool && (
                        <div className="pt-0.5">
                          <Button
                            size="sm"
                            tone="quiet"
                            onClick={() =>
                              onJumpToTab(
                                step.recommendedTool === 'library'
                                  ? 'library'
                                  : step.recommendedTool === 'programming'
                                    ? 'programming'
                                    : step.recommendedTool === 'active'
                                      ? 'active'
                                      : 'live',
                                dtcAnalysis.relatedModuleId
                              )
                            }
                          >
                            <span>
                              {step.recommendedTool === 'library'
                                ? 'Open wiring & pinouts'
                                : step.recommendedTool === 'programming'
                                  ? 'Open J2534 flasher'
                                  : step.recommendedTool === 'active'
                                    ? 'Run active test'
                                    : 'Open live telemetry'}
                            </span>
                            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Relevant Technical Service Bulletins (TSBs) */}
              <div className="lg:col-span-4 space-y-2.5">
                <h3 className="text-sm font-semibold text-foreground">
                  Relevant TSBs &amp; OEM bulletins ({dtcAnalysis.relatedTsbs.length})
                </h3>
                {dtcAnalysis.relatedTsbs.length === 0 ? (
                  <p className="text-sm text-muted border-t border-border/40 pt-3">
                    No active manufacturer TSBs matched this code for {vehicle.year} {vehicle.make} {vehicle.model}.
                  </p>
                ) : (
                  <div className="divide-y divide-border/40 border-t border-border/40 text-sm">
                    {dtcAnalysis.relatedTsbs.map((tsb) => {
                      const isExpanded = expandedTsbNumber === tsb.tsbNumber;
                      return (
                        <div key={tsb.tsbNumber} className="py-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-mono font-semibold text-primary text-xs">
                                {tsb.tsbNumber} · {tsb.publishDate}
                              </div>
                              <div className="font-medium text-foreground mt-0.5">
                                {tsb.title}
                              </div>
                              <div className="text-xs text-muted">{tsb.appliesTo}</div>
                            </div>
                          </div>

                          <p className="text-xs text-muted leading-relaxed">{tsb.summary}</p>

                          {isExpanded && (
                            <div className="pt-1 space-y-1.5 text-xs border-t border-border/30">
                              <div className="font-semibold text-foreground">
                                Bulletin repair procedure:
                              </div>
                              <p className="text-foreground leading-relaxed">
                                {tsb.repairProcedure}
                              </p>
                              {tsb.calibrationRef && (
                                <div className="font-mono text-primary">
                                  Superseding calibration: {tsb.calibrationRef}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <Button
                              size="sm"
                              tone="quiet"
                              onClick={() =>
                                setExpandedTsbNumber(isExpanded ? null : tsb.tsbNumber)
                              }
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Hide procedure</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Read bulletin steps</span>
                                </>
                              )}
                            </Button>

                            <Button
                              size="sm"
                              tone="quiet"
                              onClick={() => openInEmbeddedManual(tsb.portalUrl, 'tsbs')}
                            >
                              <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>Open in Lemon Manual</span>
                            </Button>

                            <a
                              href={tsb.portalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open TSB ${tsb.tsbNumber} on lemon.dogeware.me in new tab`}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-border/55 bg-surface px-3 text-xs font-medium text-foreground hover:bg-background whitespace-nowrap"
                            >
                              <span>lemon.dogeware.me</span>
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted py-3">
            Select a stored trouble code above or enter any SAE/OEM DTC code (e.g. P0304, P0300, P0420) to query potential causes, diagnostic procedures, and TSB bulletins.
          </p>
        )}

        {/* Embedded Live Lemon Repair Manual for Active Vehicle DTC Index & TSBs */}
        <div ref={lemonEmbedRef} className="border-t border-border/40 pt-5">
          <LemonManualEmbed
            make={vehicle.make}
            model={vehicle.model}
            year={vehicle.year}
            initialSection={embeddedInitialSection}
            forcedUrl={embeddedManualUrl}
            forcedNonce={embeddedManualNonce}
            title="Live OEM DTC Index & TSB Manual (lemon.dogeware.me)"
            subtitle={`Embedded workshop repair manual for ${vehicle.year} ${vehicle.make} ${vehicle.model} — inspect full OEM diagnostic flowcharts, DTC definitions, and Technical Service Bulletins.`}
            heightClassName="h-[600px]"
          />
        </div>
      </Surface>
    </div>
  );
};
