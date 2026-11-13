import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bluetooth, Menu, X } from 'lucide-react';
import { Button, StatusMark } from './components/ui';
import { VEHICLE_PROFILES } from './data/vehicles';
import { PROTOCOL_OPTIONS } from './lib/obdProtocol';
import { hardwareManager } from './lib/hardwareAdapter';
import { TelemetryRingStore } from './lib/telemetryEngine';
import type { TelemetryOverrides } from './lib/telemetryEngine';
import { TopologyAndDtcView } from './components/TopologyAndDtcView';
import { LiveDataStreamView } from './components/LiveDataStreamView';
import { BidirectionalTestView } from './components/BidirectionalTestView';
import { ProgrammingAndKeysView } from './components/ProgrammingAndKeysView';
import type { ProgrammingSubMode } from './components/ProgrammingAndKeysView';
import { RepairManualView } from './components/RepairManualView';
import { CloudReportsView } from './components/CloudReportsView';
import { HardwareConnectionDialog } from './components/HardwareConnectionDialog';
import type {
  CalibrationPackage,
  DtcRecord,
  EcuModule,
  HardwareConnectionMode,
  ImmobilizerKeySlot,
  ObdProtocolId,
} from './types/diagnostic';

type WorkspaceTab = 'topology' | 'live' | 'active' | 'programming' | 'manual' | 'reports';

const NAV_TABS: Array<{ id: WorkspaceTab; label: string; shortcut: string }> = [
  { id: 'topology', label: 'Topology & DTCs', shortcut: 'Alt+1' },
  { id: 'live', label: 'Live data', shortcut: 'Alt+2' },
  { id: 'active', label: 'Active tests', shortcut: 'Alt+3' },
  { id: 'programming', label: 'ECU & tuning', shortcut: 'Alt+4' },
  { id: 'manual', label: 'Repair manual', shortcut: 'Alt+5' },
  { id: 'reports', label: 'Cloud reports', shortcut: 'Alt+6' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('topology');
  const [programmingSubMode, setProgrammingSubMode] = useState<ProgrammingSubMode>('engine_tuning');
  const [focusModuleId, setFocusModuleId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [hardwareDialogOpen, setHardwareDialogOpen] = useState<boolean>(false);

  // Active Vehicle & Session State
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(VEHICLE_PROFILES[0].id);
  const vehicle = useMemo(
    () => VEHICLE_PROFILES.find((v) => v.id === selectedVehicleId) || VEHICLE_PROFILES[0],
    [selectedVehicleId]
  );

  const [modules, setModules] = useState<EcuModule[]>(() =>
    structuredClone(VEHICLE_PROFILES[0].modules)
  );
  const [dtcs, setDtcs] = useState<DtcRecord[]>(() =>
    structuredClone(VEHICLE_PROFILES[0].initialDtcs)
  );
  const [keySlots, setKeySlots] = useState<ImmobilizerKeySlot[]>(() =>
    structuredClone(VEHICLE_PROFILES[0].keySlots)
  );
  const [appliedCalibrations, setAppliedCalibrations] = useState<string[]>([]);

  // VCI Hardware & Protocol State
  const [protocol, setProtocol] = useState<ObdProtocolId>(VEHICLE_PROFILES[0].protocol);
  const [connectionMode, setConnectionMode] = useState<HardwareConnectionMode>('simulated');
  const [deviceName, setDeviceName] = useState<string>('TorqueLink J2534-2 Virtual Bus');

  // Telemetry Stream & Overrides
  const [isStreamPaused, setIsStreamPaused] = useState<boolean>(false);
  const [overrides, setOverrides] = useState<TelemetryOverrides>({
    ignitionState: 'KOER',
    simulatedThrottleDemandPct: 0,
    cutoutCylinder: null,
    vctDutyOverridePct: null,
    etcPlateOverridePct: null,
    fanPwmOverridePct: null,
    fuelTrimInjectionDeltaPct: null,
    evapSealActive: false,
    maintainerVoltageSet: null,
    faultInjectionMisfire: false,
    highLoadStressBurst: false,
  });

  // Scanning animation & status line
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgressModuleId, setScanProgressModuleId] = useState<string | null>(null);
  const [statusAnnouncement, setStatusAnnouncement] = useState<string>(
    'Connected to 2023 Ford F-150 Lariat PowerBoost · 8 modules online'
  );
  const [elapsedSec, setElapsedSec] = useState<number>(184); // opened mid-session (03:04 elapsed)
  const [headerVoltage, setHeaderVoltage] = useState<number>(14.18);

  const ringStoreRef = useRef<TelemetryRingStore | null>(null);
  if (!ringStoreRef.current) {
    const store = new TelemetryRingStore();
    store.resetForVehicle(VEHICLE_PROFILES[0], overrides);
    ringStoreRef.current = store;
  }
  const ringStore = ringStoreRef.current;

  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const vehicleRef = useRef(vehicle);
  vehicleRef.current = vehicle;

  const updateOverrides = useCallback((patch: Partial<TelemetryOverrides>) => {
    setOverrides((prev) => ({ ...prev, ...patch }));
  }, []);

  // Handle switching vehicle manufacturer / VIN profile
  const handleSelectVehicle = (nextId: string) => {
    const nextVeh = VEHICLE_PROFILES.find((v) => v.id === nextId);
    if (!nextVeh) return;

    const cleanOverrides: TelemetryOverrides = {
      ignitionState: 'KOER',
      simulatedThrottleDemandPct: 0,
      cutoutCylinder: null,
      vctDutyOverridePct: null,
      etcPlateOverridePct: null,
      fanPwmOverridePct: null,
      fuelTrimInjectionDeltaPct: null,
      evapSealActive: false,
      maintainerVoltageSet: null,
      faultInjectionMisfire: false,
      highLoadStressBurst: overrides.highLoadStressBurst,
    };

    setSelectedVehicleId(nextVeh.id);
    setProtocol(nextVeh.protocol);
    setModules(structuredClone(nextVeh.modules));
    setDtcs(structuredClone(nextVeh.initialDtcs));
    setKeySlots(structuredClone(nextVeh.keySlots));
    setAppliedCalibrations([]);
    setOverrides(cleanOverrides);
    ringStore.resetForVehicle(nextVeh, cleanOverrides);
    setStatusAnnouncement(
      `Loaded ${nextVeh.year} ${nextVeh.make} ${nextVeh.model} (${nextVeh.protocolLabel}) · ${nextVeh.modules.length} modules online`
    );
  };

  // High-frequency telemetry pump (25 Hz standard, 200 Hz under high-load stress burst)
  useEffect(() => {
    if (isStreamPaused) return;

    const intervalMs = overrides.highLoadStressBurst ? 5 : 40;
    const timer = window.setInterval(() => {
      const nowSec = performance.now() / 1000;
      ringStore.stepSample(nowSec, vehicleRef.current, overridesRef.current, true);
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isStreamPaused, overrides.highLoadStressBurst, ringStore]);

  // If paired with real Bluetooth BLE or USB Serial hardware, poll core OBD Mode $01 PIDs
  useEffect(() => {
    if (connectionMode === 'simulated' || isStreamPaused) return;
    let active = true;
    const noop = () => {};

    const pollHardwareLoop = async () => {
      while (active) {
        try {
          const respRpm = await hardwareManager.sendCommand('010C', noop);
          const parsedRpm = hardwareManager.parseLiveHexPid('010C', respRpm);
          if (parsedRpm !== null) {
            ringStore.stats.rpm.latest = parsedRpm;
          }
          const respEct = await hardwareManager.sendCommand('0105', noop);
          const parsedEct = hardwareManager.parseLiveHexPid('0105', respEct);
          if (parsedEct !== null) {
            ringStore.stats.ect.latest = parsedEct;
          }
        } catch {
          // keep loop resilient
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    };

    void pollHardwareLoop();
    return () => {
      active = false;
    };
  }, [connectionMode, isStreamPaused, ringStore]);

  // Session elapsed clock & header voltage refresh (1 Hz)
  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsedSec((s) => s + 1);
      setHeaderVoltage(ringStore.stats.vpwr?.latest ?? 14.15);
    }, 1000);
    return () => window.clearInterval(id);
  }, [ringStore]);

  // Accessible keyboard shortcuts Alt+1 .. Alt+6
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === '1') {
        e.preventDefault();
        setActiveTab('topology');
      } else if (e.key === '2') {
        e.preventDefault();
        setActiveTab('live');
      } else if (e.key === '3') {
        e.preventDefault();
        setActiveTab('active');
      } else if (e.key === '4') {
        e.preventDefault();
        setActiveTab('programming');
      } else if (e.key === '5') {
        e.preventDefault();
        setActiveTab('manual');
      } else if (e.key === '6') {
        e.preventDefault();
        setActiveTab('reports');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Full All-Module Bus Scan Sequence
  const handleRunFullScan = () => {
    if (isScanning) return;
    setIsScanning(true);
    setStatusAnnouncement(`Scanning ${modules.length} control modules across vehicle buses…`);

    modules.forEach((mod, index) => {
      window.setTimeout(() => {
        setScanProgressModuleId(mod.id);
        if (index === modules.length - 1) {
          window.setTimeout(() => {
            setScanProgressModuleId(null);
            setIsScanning(false);
            setStatusAnnouncement(
              `Completed full network sweep: ${modules.length} modules polled · ${dtcs.length} fault codes stored`
            );
          }, 220);
        }
      }, index * 190);
    });
  };

  // Clear All Fault Codes (Mode $04 / UDS $14 FF FF FF)
  const handleClearAllDtcs = () => {
    const clearedCount = dtcs.length;
    setDtcs([]);
    setModules((prev) =>
      prev.map((m) => ({
        ...m,
        status: m.targetCalibrationId ? 'Advisory' : 'Nominal',
      }))
    );
    setStatusAnnouncement(
      `Transmitted Mode $04 / UDS $14 FF FF FF clear: erased ${clearedCount} diagnostic trouble codes`
    );
  };

  // Complete ECU Calibration Flash
  const handleCompleteFlash = useCallback((pkg: CalibrationPackage) => {
    setModules((prev) =>
      prev.map((m) =>
        m.id === pkg.moduleId
          ? {
              ...m,
              calibrationId: pkg.newCalId,
              targetCalibrationId: undefined,
              status: 'Nominal',
            }
          : m
      )
    );
    setAppliedCalibrations((prev) =>
      prev.includes(pkg.newCalId) ? prev : [...prev, pkg.newCalId]
    );
    setStatusAnnouncement(
      `Completed J2534 flash on ${pkg.moduleId}: updated calibration to ${pkg.newCalId}`
    );
  }, []);

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const activeProtocolMeta =
    PROTOCOL_OPTIONS.find((p) => p.id === protocol) || PROTOCOL_OPTIONS[0];

  const liveValuesSnapshot = {
    rpm: ringStore.stats.rpm?.latest ?? 680,
    ect: ringStore.stats.ect?.latest ?? 89,
    stft1: ringStore.stats.stft1?.latest ?? 4.2,
    vpwr: headerVoltage,
  };

  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      <a
        href="#main-diagnostic-stage"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to diagnostic workspace
      </a>

      {/* Quiet Single Top Navigation Bar (Brand + 5 Links + 1 Hardware Action) */}
      <header className="border-b border-border/50 bg-surface no-print">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <span className="text-lg font-bold tracking-tight text-foreground whitespace-nowrap shrink-0">
              TorqueLink J2534
            </span>

            {/* Desktop Navigation */}
            <nav aria-label="Diagnostic workspaces" className="hidden lg:flex items-center gap-1">
              {NAV_TABS.map((tab) => {
                const current = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={current ? 'page' : undefined}
                    title={`Shortcut: ${tab.shortcut}`}
                    className={`min-h-10 px-3 rounded-control text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                      current
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-background'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              tone={connectionMode === 'simulated' ? 'quiet' : 'primary'}
              size="sm"
              onClick={() => setHardwareDialogOpen(true)}
            >
              <Bluetooth className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>VCI hardware</span>
            </Button>

            {/* Mobile Hamburger Fold */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-workspace-nav"
              aria-label="Toggle navigation menu"
              className="lg:hidden inline-flex min-h-10 min-w-10 items-center justify-center rounded-control border border-border/55 bg-surface text-foreground"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Collapsible Mobile Navigation */}
        {mobileMenuOpen && (
          <nav
            id="mobile-workspace-nav"
            aria-label="Mobile diagnostic workspaces"
            className="lg:hidden border-t border-border/40 px-4 py-3 flex flex-col gap-1.5 bg-surface"
          >
            {NAV_TABS.map((tab) => {
              const current = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setMobileMenuOpen(false);
                  }}
                  aria-current={current ? 'page' : undefined}
                  className={`min-h-11 px-3 rounded-control text-left text-sm font-medium flex items-center justify-between ${
                    current
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-background'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="font-mono text-xs uppercase opacity-80">[{tab.shortcut}]</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Instrument Console Status Strip (Vehicle selector + Protocol + Voltage + Session state) */}
        <div className="border-t border-border/40 bg-background/70 px-4 sm:px-6 py-2">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              <label htmlFor="active-vehicle-select" className="font-medium text-muted shrink-0">
                Active vehicle:
              </label>
              <select
                id="active-vehicle-select"
                value={selectedVehicleId}
                onChange={(e) => handleSelectVehicle(e.target.value)}
                className="min-h-8 rounded-control border border-border/55 bg-surface px-2.5 py-1 text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              >
                {VEHICLE_PROFILES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.year} {v.make} {v.model} · {v.vin}
                  </option>
                ))}
              </select>

              <span className="hidden lg:inline text-muted">·</span>
              <span className="hidden lg:inline font-mono text-foreground">
                {activeProtocolMeta.label}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
              <span className="text-foreground">
                DLC {headerVoltage.toFixed(2)} V ({overrides.ignitionState})
              </span>
              <span className="text-muted">·</span>
              <span className="text-muted">Session {formatElapsed(elapsedSec)}</span>
              <span className="text-muted">·</span>
              <StatusMark
                kind={connectionMode === 'simulated' ? 'advisory' : 'nominal'}
                label={
                  connectionMode === 'simulated'
                    ? 'Simulated VCI'
                    : connectionMode === 'bluetooth_ble'
                      ? 'Bluetooth BLE'
                      : 'USB J2534'
                }
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Full-Width Workstation Stage */}
      <main id="main-diagnostic-stage" className="flex-1 w-full px-4 sm:px-6 py-5">
        {activeTab === 'topology' && (
          <TopologyAndDtcView
            vehicle={vehicle}
            modules={modules}
            dtcs={dtcs}
            readiness={vehicle.readiness}
            isScanning={isScanning}
            scanProgressModuleId={scanProgressModuleId}
            onRunFullScan={handleRunFullScan}
            onClearAllDtcs={handleClearAllDtcs}
            onJumpToTab={(tab, modId) => {
              if (tab === 'library') {
                setProgrammingSubMode('library');
                setFocusModuleId(modId ?? null);
                setActiveTab('programming');
              } else if (tab === 'programming') {
                setProgrammingSubMode('ecu_flash');
                setFocusModuleId(modId ?? null);
                setActiveTab('programming');
              } else {
                setActiveTab(tab);
              }
            }}
          />
        )}

        {activeTab === 'live' && (
          <LiveDataStreamView
            vehicle={vehicle}
            ringStore={ringStore}
            connectionMode={connectionMode}
            overrides={overrides}
            onUpdateOverrides={updateOverrides}
            isPaused={isStreamPaused}
            onTogglePause={() => setIsStreamPaused((p) => !p)}
          />
        )}

        {activeTab === 'active' && (
          <BidirectionalTestView
            vehicle={vehicle}
            ringStore={ringStore}
            overrides={overrides}
            onUpdateOverrides={updateOverrides}
          />
        )}

        {activeTab === 'programming' && (
          <ProgrammingAndKeysView
            vehicle={vehicle}
            modules={modules}
            keySlots={keySlots}
            appliedCalibrations={appliedCalibrations}
            overrides={overrides}
            ringStore={ringStore}
            liveBatteryVolts={headerVoltage}
            initialSubMode={programmingSubMode}
            initialFocusModuleId={focusModuleId}
            onUpdateOverrides={updateOverrides}
            onCompleteFlash={handleCompleteFlash}
            onUpdateKeySlots={setKeySlots}
          />
        )}

        {activeTab === 'manual' && <RepairManualView activeVehicle={vehicle} />}

        {activeTab === 'reports' && (
          <CloudReportsView
            vehicle={vehicle}
            modules={modules}
            dtcs={dtcs}
            keySlots={keySlots}
            appliedCalibrations={appliedCalibrations}
            ringStore={ringStore}
          />
        )}
      </main>

      {/* Accessible Live Region Status Footer */}
      <footer className="border-t border-border/40 bg-surface px-4 sm:px-6 py-2.5 text-xs text-muted no-print">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="status" aria-live="polite" className="font-medium text-foreground">
            {statusAnnouncement}
          </div>
          <div className="font-mono text-muted">
            Shortcuts: [ALT+1] Topology · [ALT+2] Live data · [ALT+3] Active tests · [ALT+4] Modules · [ALT+5] Repair manual · [ALT+6] Reports
          </div>
        </div>
      </footer>

      <HardwareConnectionDialog
        open={hardwareDialogOpen}
        onClose={() => setHardwareDialogOpen(false)}
        vehicle={vehicle}
        protocol={protocol}
        onChangeProtocol={setProtocol}
        connectionMode={connectionMode}
        deviceName={deviceName}
        onConnectionChanged={(mode, name) => {
          setConnectionMode(mode);
          setDeviceName(name);
          setStatusAnnouncement(`Active VCI interface switched to ${name}`);
        }}
        liveValues={liveValuesSnapshot}
      />
    </div>
  );
}
