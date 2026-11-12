import React, { useEffect, useMemo, useState } from 'react';
import { CloudUpload, Download, Printer, RotateCcw, Trash2, CheckCircle2 } from 'lucide-react';
import { Button, Field, SelectField, Surface, StatusMark } from './ui';
import type { TelemetryRingStore } from '../lib/telemetryEngine';
import type {
  CloudReport,
  DtcRecord,
  EcuModule,
  ImmobilizerKeySlot,
  VehicleProfile,
} from '../types/diagnostic';

interface CloudReportsViewProps {
  vehicle: VehicleProfile;
  modules: EcuModule[];
  dtcs: DtcRecord[];
  keySlots: ImmobilizerKeySlot[];
  appliedCalibrations: string[];
  ringStore: TelemetryRingStore;
}

const LOCAL_CACHE_KEY = 'torquelink_cloud_reports_v1';

function readCachedReports(): CloudReport[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CloudReport[]) : [];
  } catch {
    return [];
  }
}

function writeCachedReports(reports: CloudReport[]): void {
  try {
    window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(reports));
  } catch {
    // ignore storage quota issues
  }
}

function formatReportTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export const CloudReportsView: React.FC<CloudReportsViewProps> = ({
  vehicle,
  modules,
  dtcs,
  keySlots,
  appliedCalibrations,
  ringStore,
}) => {
  const [reports, setReports] = useState<CloudReport[]>(() => readCachedReports());
  const [loading, setLoading] = useState<boolean>(true);
  const [syncError, setSyncError] = useState<string>('');
  const [statusFeedback, setStatusFeedback] = useState<string>('');

  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [scanTypeFilter, setScanTypeFilter] = useState<'ALL' | CloudReport['scanType']>('ALL');

  // New Cloud Report Capture Form
  const [newScanType, setNewScanType] = useState<CloudReport['scanType']>('Post-Scan');
  const [bayName, setBayName] = useState<string>('Bay 4 · Master Diag');
  const [techNotes, setTechNotes] = useState<string>(
    'Verified cylinder power balance, applied latest OEM calibration, and confirmed readiness monitors.'
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const fetchReports = async () => {
    setLoading(true);
    setSyncError('');
    try {
      const res = await fetch('/api/reports');
      if (!res.ok) {
        throw new Error(`Cloud archive returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as { reports: CloudReport[] };
      setReports(data.reports);
      writeCachedReports(data.reports);
      if (data.reports.length > 0 && !selectedReportId) {
        setSelectedReportId(data.reports[0].id);
      }
    } catch (err) {
      setSyncError(
        err instanceof Error
          ? `${err.message} — using local workstation archive cache.`
          : 'Unable to reach cloud archive — using local cache.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return reports.filter((r) => {
      if (scanTypeFilter !== 'ALL' && r.scanType !== scanTypeFilter) return false;
      if (!q) return true;
      return (
        r.vin.toLowerCase().includes(q) ||
        r.make.toLowerCase().includes(q) ||
        r.model.toLowerCase().includes(q) ||
        r.reportNumber.toLowerCase().includes(q)
      );
    });
  }, [reports, searchQuery, scanTypeFilter]);

  const activeReport = useMemo(() => {
    return (
      filteredReports.find((r) => r.id === selectedReportId) ||
      filteredReports[0] ||
      null
    );
  }, [filteredReports, selectedReportId]);

  // Automatic Pre-Scan baseline lookup for same VIN when viewing a Post-Scan
  const pairedPreScan = useMemo(() => {
    if (!activeReport || activeReport.scanType !== 'Post-Scan') return null;
    return (
      reports.find(
        (r) =>
          r.vin === activeReport.vin &&
          r.scanType === 'Pre-Scan' &&
          r.id !== activeReport.id
      ) || null
    );
  }, [activeReport, reports]);

  const handleUploadCurrentSessionReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSyncError('');
    setStatusFeedback('');

    const authorizedKeysCount = keySlots.filter((k) => k.status === 'Authorized').length;
    const faultModuleIds = new Set(dtcs.map((d) => d.moduleId));

    const payload: Omit<CloudReport, 'id' | 'reportNumber'> = {
      createdAtIso: new Date().toISOString(),
      scanType: newScanType,
      vin: vehicle.vin,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      engine: vehicle.trimEngine,
      odometerKm: vehicle.odometerKm,
      protocol: vehicle.protocolLabel,
      technicianBay: bayName.trim() || 'Bay 4 · Master Diag',
      batteryVoltage: Number((ringStore.stats.vpwr?.latest ?? 13.8).toFixed(2)),
      modulesScanned: modules.length,
      modulesWithFaults: faultModuleIds.size,
      dtcs: dtcs.map((d) => ({
        code: d.code,
        moduleId: d.moduleId,
        moduleName: d.moduleName,
        status: d.status,
        description: d.description,
        freezeFrameSummary: `${d.freezeFrame.rpm} rpm · ${d.freezeFrame.mapKpa} kPa · ${d.freezeFrame.coolantC} °C`,
      })),
      calibrationsApplied: appliedCalibrations,
      keysProgrammedCount: authorizedKeysCount,
      notes: techNotes.trim(),
      telemetrySnapshot: [
        {
          pid: '010C',
          label: 'Engine speed',
          value: Math.round(ringStore.stats.rpm?.latest ?? 0),
          unit: 'rpm',
        },
        {
          pid: '0105',
          label: 'Coolant temp',
          value: Math.round(ringStore.stats.ect?.latest ?? 88),
          unit: '°C',
        },
        {
          pid: '0106',
          label: 'Short fuel trim B1',
          value: Number((ringStore.stats.stft1?.latest ?? 0).toFixed(1)),
          unit: '%',
        },
        {
          pid: '0142',
          label: 'Module voltage',
          value: Number((ringStore.stats.vpwr?.latest ?? 14.1).toFixed(2)),
          unit: 'V',
        },
      ],
    };

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Failed to store cloud report (HTTP ${res.status})`);
      }
      const { report } = (await res.json()) as { report: CloudReport };
      const next = [report, ...reports];
      setReports(next);
      writeCachedReports(next);
      setSelectedReportId(report.id);
      setStatusFeedback(`Saved ${report.reportNumber} (${report.scanType}) to cloud diagnostic archive.`);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Cloud report upload failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteReport = async (id: string, numberLabel: string) => {
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete request failed');
      const next = reports.filter((r) => r.id !== id);
      setReports(next);
      writeCachedReports(next);
      setStatusFeedback(`Deleted report ${numberLabel} from cloud archive.`);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Could not delete report.');
    }
  };

  const handleResetArchive = async () => {
    try {
      const res = await fetch('/api/reports/reset', { method: 'POST' });
      if (!res.ok) throw new Error('Archive reset failed');
      const data = (await res.json()) as { reports: CloudReport[] };
      setReports(data.reports);
      writeCachedReports(data.reports);
      if (data.reports[0]) setSelectedReportId(data.reports[0].id);
      setStatusFeedback('Restored default shop historical diagnostic archive.');
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Could not reset cloud archive.');
    }
  };

  const handleDownloadJson = (rep: CloudReport) => {
    const blob = new Blob([JSON.stringify(rep, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rep.reportNumber}-${rep.vin}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Capture Live Vehicle Snapshot to Cloud */}
      <Surface className="p-4 sm:p-5 no-print">
        <form onSubmit={handleUploadCurrentSessionReport} className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-display text-foreground">
                Cloud diagnostic reports and vehicle history
              </h1>
              <p className="text-sm text-muted">
                Capture pre-scan, post-scan, J2534 calibration, and immobilizer audit records for{' '}
                {vehicle.year} {vehicle.make} {vehicle.model} (<span className="font-mono">{vehicle.vin}</span>).
              </p>
            </div>
            <Button type="submit" disabled={isSaving}>
              <CloudUpload className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{isSaving ? 'Uploading snapshot…' : 'Save live snapshot to cloud'}</span>
            </Button>
          </div>

          <div className="pt-3 border-t border-border/40 grid grid-cols-1 md:grid-cols-12 gap-4">
            <SelectField
              id="report-scan-type"
              label="Report classification"
              value={newScanType}
              onChange={(e) => setNewScanType(e.target.value as CloudReport['scanType'])}
              className="md:col-span-3"
            >
              <option value="Pre-Scan">Pre-Scan</option>
              <option value="Post-Scan">Post-Scan</option>
              <option value="Flash & Calibration">Flash &amp; Calibration</option>
              <option value="Immobilizer Audit">Immobilizer Audit</option>
            </SelectField>

            <Field
              id="report-bay-input"
              label="Service bay &amp; technician"
              value={bayName}
              onChange={(e) => setBayName(e.target.value)}
              className="md:col-span-3"
            />

            <Field
              id="report-notes-input"
              label="Diagnostic findings &amp; repair verification notes"
              value={techNotes}
              onChange={(e) => setTechNotes(e.target.value)}
              className="md:col-span-6"
            />
          </div>

          {statusFeedback && (
            <div role="status" className="flex items-center gap-2 text-sm font-medium text-nominal">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{statusFeedback}</span>
            </div>
          )}
          {syncError && (
            <div role="alert" className="text-sm font-medium text-advisory">
              {syncError}
            </div>
          )}
        </form>
      </Surface>

      {/* Main Split: Cloud Report Archive List + Detailed Printable Report Sheet */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left Archive Column */}
        <Surface className="xl:col-span-5 p-4 sm:p-5 space-y-4 no-print">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-title text-foreground">
              Stored cloud reports ({filteredReports.length})
            </h2>
            <Button size="sm" tone="quiet" onClick={handleResetArchive}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset archive</span>
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              id="archive-search"
              label="Filter by VIN, RO#, or make"
              placeholder="1FTFW1... or RO-884"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <SelectField
              id="archive-type-filter"
              label="Scan stage"
              value={scanTypeFilter}
              onChange={(e) =>
                setScanTypeFilter(e.target.value as 'ALL' | CloudReport['scanType'])
              }
            >
              <option value="ALL">All report types</option>
              <option value="Pre-Scan">Pre-Scan</option>
              <option value="Post-Scan">Post-Scan</option>
              <option value="Flash & Calibration">Flash &amp; Calibration</option>
              <option value="Immobilizer Audit">Immobilizer Audit</option>
            </SelectField>
          </div>

          {loading ? (
            <p className="text-sm text-muted py-4">Loading historical shop archive…</p>
          ) : filteredReports.length === 0 ? (
            <p className="text-sm text-muted py-4">
              No archived reports match the search criteria. Clear filters or save a live snapshot above.
            </p>
          ) : (
            <div className="divide-y divide-border/40 border-t border-border/40">
              {filteredReports.map((rep) => {
                const selected = activeReport?.id === rep.id;
                return (
                  <button
                    key={rep.id}
                    type="button"
                    onClick={() => setSelectedReportId(rep.id)}
                    className={`w-full text-left py-3.5 px-2 rounded-control transition-colors space-y-1 ${
                      selected ? 'bg-background' : 'hover:bg-background/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-sm text-foreground">
                        {rep.reportNumber} · {rep.scanType}
                      </span>
                      <StatusMark
                        kind={rep.dtcs.length > 0 ? 'fault' : 'nominal'}
                        label={rep.dtcs.length > 0 ? `${rep.dtcs.length} DTCs` : '0 DTCs'}
                      />
                    </div>
                    <div className="text-sm text-foreground">
                      {rep.year} {rep.make} {rep.model}
                    </div>
                    <div className="text-xs text-muted font-mono">
                      {rep.vin} · {formatReportTimestamp(rep.createdAtIso)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Surface>

        {/* Right Detailed Inspection & Pre/Post Comparison Sheet */}
        <Surface className="xl:col-span-7 p-4 sm:p-6 space-y-5">
          {activeReport ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-border/40 pb-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-title text-foreground">
                      {activeReport.reportNumber} — {activeReport.scanType}
                    </h2>
                    <StatusMark
                      kind={activeReport.dtcs.length === 0 ? 'nominal' : 'fault'}
                      label={
                        activeReport.dtcs.length === 0
                          ? 'All modules pass'
                          : `${activeReport.dtcs.length} fault codes recorded`
                      }
                    />
                  </div>
                  <p className="text-sm text-muted">
                    {activeReport.year} {activeReport.make} {activeReport.model} ({activeReport.engine}) ·{' '}
                    {formatReportTimestamp(activeReport.createdAtIso)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 no-print">
                  <Button
                    size="sm"
                    tone="quiet"
                    onClick={() => handleDownloadJson(activeReport)}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>JSON</span>
                  </Button>
                  <Button size="sm" tone="quiet" onClick={() => window.print()}>
                    <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Print sheet</span>
                  </Button>
                  <Button
                    size="sm"
                    tone="quiet"
                    onClick={() =>
                      handleDeleteReport(activeReport.id, activeReport.reportNumber)
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Delete</span>
                  </Button>
                </div>
              </div>

              {/* Metadata Grid */}
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm border-b border-border/40 pb-4">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted">VIN</dt>
                  <dd className="font-mono text-foreground mt-0.5">{activeReport.vin}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted">
                    ODOMETER &amp; SUPPLY
                  </dt>
                  <dd className="font-mono text-foreground mt-0.5">
                    {activeReport.odometerKm.toLocaleString()} km · {activeReport.batteryVoltage.toFixed(2)} V
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted">
                    BUS &amp; BAY
                  </dt>
                  <dd className="text-foreground mt-0.5">
                    {activeReport.technicianBay} ({activeReport.modulesScanned} ECUs)
                  </dd>
                </div>
              </dl>

              {/* Pre-Scan vs Post-Scan Delta Callout when available */}
              {pairedPreScan && (
                <div className="border-b border-border/40 pb-4 space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                    PRE-SCAN COMPARISON ({pairedPreScan.reportNumber})
                  </div>
                  <p className="text-sm text-foreground">
                    Fault codes reduced from{' '}
                    <span className="font-mono font-semibold">{pairedPreScan.dtcs.length}</span> on{' '}
                    {formatReportTimestamp(pairedPreScan.createdAtIso)} to{' '}
                    <span className="font-mono font-semibold text-nominal">
                      {activeReport.dtcs.length}
                    </span>{' '}
                    in this post-repair verification scan.
                  </p>
                </div>
              )}

              {/* Recorded Fault Codes */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Recorded fault memory ({activeReport.dtcs.length})
                </h3>
                {activeReport.dtcs.length === 0 ? (
                  <p className="text-sm text-nominal">
                    Zero diagnostic trouble codes present across all {activeReport.modulesScanned} scanned control modules.
                  </p>
                ) : (
                  <div className="divide-y divide-border/40 border-t border-b border-border/40 text-sm">
                    {activeReport.dtcs.map((d, i) => (
                      <div key={`${d.code}-${i}`} className="py-2.5 space-y-0.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-foreground">
                            {d.code} · {d.moduleId} ({d.moduleName})
                          </span>
                          <span className="text-xs text-muted">{d.status}</span>
                        </div>
                        <p className="text-foreground">{d.description}</p>
                        {d.freezeFrameSummary && (
                          <p className="font-mono text-xs text-muted">
                            Freeze frame: {d.freezeFrameSummary}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Calibrations & Keys Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-border/40 pb-4 text-sm">
                <div>
                  <h3 className="font-semibold text-foreground">J2534 calibrations applied</h3>
                  <p className="text-muted font-mono text-xs mt-1">
                    {activeReport.calibrationsApplied.length > 0
                      ? activeReport.calibrationsApplied.join(', ')
                      : 'None recorded in this session'}
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Authorized immobilizer keys</h3>
                  <p className="text-muted font-mono text-xs mt-1">
                    {activeReport.keysProgrammedCount} active smart fobs verified in BCM/Certification ECU
                  </p>
                </div>
              </div>

              {/* Telemetry Snapshot */}
              {activeReport.telemetrySnapshot.length > 0 && (
                <div className="space-y-2 border-b border-border/40 pb-4">
                  <h3 className="text-sm font-semibold text-foreground">PID baseline snapshot</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    {activeReport.telemetrySnapshot.map((s) => (
                      <div key={s.pid}>
                        <div className="text-xs text-muted">{s.label}</div>
                        <div className="font-mono font-semibold tabular-nums text-foreground">
                          {s.value} {s.unit}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Technician Notes */}
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Technician repair notes</h3>
                <p className="text-sm text-muted leading-relaxed">
                  {activeReport.notes || 'No technician notes attached.'}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted py-6">
              Select a diagnostic report from the archive to view full module, DTC, and calibration details.
            </p>
          )}
        </Surface>
      </div>
    </div>
  );
};
