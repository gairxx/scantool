import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Cpu,
  MapPin,
  Cable,
  FileCode2,
  ArrowUpRight,
  CheckCircle2,
  BookOpen,
} from 'lucide-react';
import { Button, Field, SelectField, Surface, StatusMark } from './ui';
import { LemonManualEmbed } from './LemonManualEmbed';
import { VEHICLE_PROFILES } from '../data/vehicles';
import { lookupModuleLibrary } from '../data/knowledgeBase';
import type {
  LemonManualSection,
  ModuleLibraryLookupResponse,
  ModuleLibraryRecord,
  VehicleProfile,
  WiringCircuit,
} from '../types/diagnostic';

interface VehicleModuleLibraryViewProps {
  activeVehicle: VehicleProfile;
  initialFocusModuleId?: string | null;
  onJumpToFlasher: () => void;
}

type LibraryDetailTab = 'wiring' | 'location' | 'calibrations' | 'lemon';

export const VehicleModuleLibraryView: React.FC<VehicleModuleLibraryViewProps> = ({
  activeVehicle,
  initialFocusModuleId,
  onJumpToFlasher,
}) => {
  const [lookupMode, setLookupMode] = useState<'vin' | 'manual'>('vin');
  const [vinInput, setVinInput] = useState<string>(activeVehicle.vin);
  const [manualMake, setManualMake] = useState<string>(activeVehicle.make);
  const [manualModel, setManualModel] = useState<string>(activeVehicle.model);
  const [manualYear, setManualYear] = useState<number>(activeVehicle.year);

  const [libraryData, setLibraryData] = useState<ModuleLibraryLookupResponse>(() =>
    lookupModuleLibrary({ vin: activeVehicle.vin })
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [lookupError, setLookupError] = useState<string>('');

  const [selectedModuleId, setSelectedModuleId] = useState<string>(
    initialFocusModuleId || libraryData.modules[0]?.moduleId || ''
  );
  const [detailTab, setDetailTab] = useState<LibraryDetailTab>('wiring');
  const [lemonSection, setLemonSection] = useState<LemonManualSection['id']>('repair');
  const [lemonJumpNonce, setLemonJumpNonce] = useState<number>(0);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);

  const executeLookup = async (params: {
    mode: 'vin' | 'manual';
    vin?: string;
    make?: string;
    model?: string;
    year?: number;
  }) => {
    setIsLoading(true);
    setLookupError('');
    try {
      const qs = new URLSearchParams();
      if (params.mode === 'vin' && params.vin) {
        qs.set('vin', params.vin.trim());
      } else {
        if (params.make) qs.set('make', params.make);
        if (params.model) qs.set('model', params.model);
        if (params.year) qs.set('year', String(params.year));
      }
      const res = await fetch(`/api/module-library/lookup?${qs.toString()}`);
      if (!res.ok) {
        throw new Error(`Module library query failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as ModuleLibraryLookupResponse;
      setLibraryData(data);
      const firstMod = data.modules[0]?.moduleId || '';
      setSelectedModuleId(
        initialFocusModuleId && data.modules.some((m) => m.moduleId === initialFocusModuleId)
          ? initialFocusModuleId
          : firstMod
      );
      setSelectedPin(null);
    } catch (err) {
      // Fallback to deterministic local lookup if network interrupted
      const fallback = lookupModuleLibrary(
        params.mode === 'vin'
          ? { vin: params.vin }
          : { make: params.make, model: params.model, year: params.year }
      );
      setLibraryData(fallback);
      setSelectedModuleId(fallback.modules[0]?.moduleId || '');
      setLookupError(
        err instanceof Error
          ? `${err.message} — resolved via local workstation library.`
          : 'Resolved via local workstation library.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Sync when activeVehicle or initialFocusModuleId changes from Topology/DTC jump
  useEffect(() => {
    setVinInput(activeVehicle.vin);
    setManualMake(activeVehicle.make);
    setManualModel(activeVehicle.model);
    setManualYear(activeVehicle.year);
    void executeLookup({ mode: 'vin', vin: activeVehicle.vin });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVehicle.id, initialFocusModuleId]);

  const activeModule: ModuleLibraryRecord | undefined = useMemo(
    () =>
      libraryData.modules.find((m) => m.moduleId === selectedModuleId) ||
      libraryData.modules[0],
    [libraryData.modules, selectedModuleId]
  );

  const uniqueMakes = useMemo(
    () => Array.from(new Set(VEHICLE_PROFILES.map((v) => v.make))),
    []
  );
  const modelsForMake = useMemo(
    () => VEHICLE_PROFILES.filter((v) => v.make === manualMake),
    [manualMake]
  );

  const selectedCircuit: WiringCircuit | null = useMemo(() => {
    if (!activeModule) return null;
    if (selectedPin) {
      return activeModule.wiringCircuits.find((c) => c.pin === selectedPin) || null;
    }
    return activeModule.wiringCircuits[0] || null;
  }, [activeModule, selectedPin]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (lookupMode === 'vin') {
      void executeLookup({ mode: 'vin', vin: vinInput });
    } else {
      void executeLookup({
        mode: 'manual',
        make: manualMake,
        model: manualModel,
        year: manualYear,
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* VIN & Manual Vehicle Lookup Bar */}
      <Surface className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-title text-foreground">
              Vehicle-specific module library &amp; technical schematics
            </h2>
            <p className="text-sm text-muted">
              Retrieve connector pinout wiring diagrams, chassis component location guides, and verified OEM calibration files by VIN or manual vehicle selection.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Lookup method">
            <button
              type="button"
              onClick={() => setLookupMode('vin')}
              className={`min-h-9 px-3 rounded-control text-xs font-medium border whitespace-nowrap ${
                lookupMode === 'vin'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface text-foreground border-border/55 hover:bg-background'
              }`}
            >
              Lookup by VIN
            </button>
            <button
              type="button"
              onClick={() => setLookupMode('manual')}
              className={`min-h-9 px-3 rounded-control text-xs font-medium border whitespace-nowrap ${
                lookupMode === 'manual'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface text-foreground border-border/55 hover:bg-background'
              }`}
            >
              Manual Year / Make / Model
            </button>
            <Button
              size="sm"
              tone="quiet"
              onClick={() => {
                setLookupMode('vin');
                setVinInput(activeVehicle.vin);
                void executeLookup({ mode: 'vin', vin: activeVehicle.vin });
              }}
            >
              Sync active vehicle
            </Button>
          </div>
        </div>

        <form
          onSubmit={handleFormSubmit}
          className="pt-3 border-t border-border/40 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
        >
          {lookupMode === 'vin' ? (
            <Field
              id="library-vin-input"
              label="17-character VIN (ISO 3779 WMI & Model Year decoder)"
              value={vinInput}
              onChange={(e) => setVinInput(e.target.value.toUpperCase())}
              placeholder="e.g. 1FTFW1ED6PFA48219 or 3MW5R7J04M8B91402"
              className="md:col-span-9 font-mono"
            />
          ) : (
            <>
              <SelectField
                id="library-year-select"
                label="Model year"
                value={String(manualYear)}
                onChange={(e) => setManualYear(Number(e.target.value))}
                className="md:col-span-2"
              >
                {[2024, 2023, 2022, 2021, 2020, 2019, 2018, 2016].map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </SelectField>

              <SelectField
                id="library-make-select"
                label="Manufacturer"
                value={manualMake}
                onChange={(e) => {
                  const nextMake = e.target.value;
                  setManualMake(nextMake);
                  const first = VEHICLE_PROFILES.find((v) => v.make === nextMake);
                  if (first) {
                    setManualModel(first.model);
                    setManualYear(first.year);
                  }
                }}
                className="md:col-span-3"
              >
                {uniqueMakes.map((mk) => (
                  <option key={mk} value={mk}>
                    {mk}
                  </option>
                ))}
              </SelectField>

              <SelectField
                id="library-model-select"
                label="Model & powertrain"
                value={manualModel}
                onChange={(e) => setManualModel(e.target.value)}
                className="md:col-span-4"
              >
                {modelsForMake.map((v) => (
                  <option key={v.id} value={v.model}>
                    {v.model} ({v.trimEngine})
                  </option>
                ))}
              </SelectField>
            </>
          )}

          <div className="md:col-span-3 flex gap-2">
            <Button type="submit" disabled={isLoading} className="w-full">
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{isLoading ? 'Querying…' : 'Retrieve modules'}</span>
            </Button>
          </div>
        </form>

        {/* Decoded Vehicle Banner */}
        <div className="pt-3 border-t border-border/40 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusMark kind="nominal" label="Library matched" />
            <span className="font-semibold text-foreground">
              {libraryData.vehicle.year} {libraryData.vehicle.make} {libraryData.vehicle.model}
            </span>
            <span className="text-muted">({libraryData.vehicle.engine})</span>
          </div>
          <span className="font-mono text-xs text-muted">
            {libraryData.decodedVinInfo
              ? libraryData.decodedVinInfo.platformMatchNote
              : libraryData.vehicle.protocolLabel}
          </span>
        </div>

        {lookupError && (
          <p role="alert" className="text-xs font-medium text-advisory">
            {lookupError}
          </p>
        )}
      </Surface>

      {/* Main Split: Vehicle Module Catalog (Left) + Wiring / Location / Calibrations (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <Surface className="xl:col-span-4 p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-title text-foreground">
              Documented ECUs ({libraryData.modules.length})
            </h3>
            <span className="text-xs font-mono text-muted">
              {libraryData.vehicle.make}
            </span>
          </div>

          <div className="divide-y divide-border/40 border-t border-border/40">
            {libraryData.modules.map((mod) => {
              const selected = activeModule?.id === mod.id;
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => {
                    setSelectedModuleId(mod.moduleId);
                    setSelectedPin(null);
                  }}
                  className={`w-full text-left py-3 px-2 rounded-control transition-colors space-y-1 ${
                    selected ? 'bg-background' : 'hover:bg-background/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-foreground">
                      {mod.shortCode} · {mod.moduleName}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-muted">
                    {mod.connectorCode} · {mod.pinCount} pins · {mod.bus}
                  </div>
                </button>
              );
            })}
          </div>
        </Surface>

        {/* Right Detail Stage */}
        <Surface className="xl:col-span-8 p-4 sm:p-5 space-y-5">
          {activeModule ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-border/40 pb-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Cpu className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 className="text-title text-foreground">{activeModule.moduleName}</h3>
                  </div>
                  <p className="text-xs font-mono text-muted">
                    Part {activeModule.oemPartNumber} · TX 0x{activeModule.canTxId} / RX 0x
                    {activeModule.canRxId} · Fuse {activeModule.fuseFeed} · Ground{' '}
                    {activeModule.groundPoint}
                  </p>
                </div>

                {/* Detail sub-tabs */}
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Module documentation views">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={detailTab === 'wiring'}
                    onClick={() => setDetailTab('wiring')}
                    className={`min-h-9 px-3 rounded-control text-xs font-medium border inline-flex items-center gap-1.5 whitespace-nowrap ${
                      detailTab === 'wiring'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-surface text-foreground border-border/55 hover:bg-background'
                    }`}
                  >
                    <Cable className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Wiring &amp; pinouts</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={detailTab === 'location'}
                    onClick={() => setDetailTab('location')}
                    className={`min-h-9 px-3 rounded-control text-xs font-medium border inline-flex items-center gap-1.5 whitespace-nowrap ${
                      detailTab === 'location'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-surface text-foreground border-border/55 hover:bg-background'
                    }`}
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Location guide</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={detailTab === 'calibrations'}
                    onClick={() => setDetailTab('calibrations')}
                    className={`min-h-9 px-3 rounded-control text-xs font-medium border inline-flex items-center gap-1.5 whitespace-nowrap ${
                      detailTab === 'calibrations'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-surface text-foreground border-border/55 hover:bg-background'
                    }`}
                  >
                    <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Calibration files ({activeModule.calibrationFiles.length})</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={detailTab === 'lemon'}
                    onClick={() => setDetailTab('lemon')}
                    className={`min-h-9 px-3 rounded-control text-xs font-medium border inline-flex items-center gap-1.5 whitespace-nowrap ${
                      detailTab === 'lemon'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-surface text-foreground border-border/55 hover:bg-background'
                    }`}
                  >
                    <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Lemon Manual (Live)</span>
                  </button>
                </div>
              </div>

              {/* TAB 1: Interactive Wiring Schematic + Pinout Table */}
              {detailTab === 'wiring' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto border-b border-border/40 pb-3">
                    <svg
                      viewBox="0 0 820 320"
                      className="h-auto w-full min-w-[620px]"
                      role="img"
                      aria-label={`Wiring diagram schematic for ${activeModule.moduleName}`}
                    >
                      {/* ECU Connector Block on Left */}
                      <rect
                        x={20}
                        y={22}
                        width={175}
                        height={276}
                        rx={5}
                        fill="var(--color-surface-recessed)"
                        stroke="var(--color-border)"
                        strokeWidth={1.5}
                      />
                      <text
                        x={107}
                        y={46}
                        textAnchor="middle"
                        className="svg-halo fill-foreground text-[12px] font-semibold"
                      >
                        {activeModule.shortCode} Header
                      </text>
                      <text
                        x={107}
                        y={63}
                        textAnchor="middle"
                        className="svg-halo fill-muted text-[10px] font-mono"
                      >
                        {activeModule.pinCount}-Pin Harness
                      </text>

                      {/* Circuit Rows */}
                      {activeModule.wiringCircuits.map((circuit, idx) => {
                        const y = 92 + idx * 32;
                        const active = selectedCircuit?.pin === circuit.pin;
                        return (
                          <g
                            key={circuit.pin}
                            onClick={() => setSelectedPin(circuit.pin)}
                            className="cursor-pointer"
                          >
                            {/* Connector Pin Node */}
                            <rect
                              x={178}
                              y={y - 10}
                              width={34}
                              height={20}
                              rx={3}
                              fill={active ? 'var(--color-primary)' : 'var(--color-surface)'}
                              stroke={active ? 'var(--color-primary)' : 'var(--color-border)'}
                              strokeWidth={1.2}
                            />
                            <text
                              x={170}
                              y={y + 4}
                              textAnchor="end"
                              className="svg-halo fill-foreground text-[10px] font-mono font-medium"
                            >
                              {circuit.pin}
                            </text>
                            <text
                              x={195}
                              y={y + 4}
                              textAnchor="middle"
                              className={`text-[9px] font-mono font-semibold ${
                                active ? 'fill-primary-foreground' : 'fill-foreground'
                              }`}
                            >
                              {circuit.wireColorCode}
                            </text>

                            {/* Wire Trace */}
                            <line
                              x1={212}
                              y1={y}
                              x2={530}
                              y2={y}
                              stroke={circuit.wireColorHex}
                              strokeWidth={active ? 3 : 1.75}
                              strokeDasharray={
                                circuit.circuitType === 'CAN Bus' ? '6 3' : undefined
                              }
                            />

                            {/* Signal Label in open offset space above wire */}
                            <text
                              x={370}
                              y={y - 7}
                              textAnchor="middle"
                              className="svg-halo fill-foreground text-[11px] font-medium"
                            >
                              {circuit.signalName}
                            </text>

                            {/* Connected Component Box on Right */}
                            <rect
                              x={530}
                              y={y - 12}
                              width={270}
                              height={24}
                              rx={4}
                              fill={active ? 'var(--color-background)' : 'var(--color-surface)'}
                              stroke={active ? 'var(--color-primary)' : 'var(--color-border)'}
                              strokeWidth={active ? 1.75 : 1}
                            />
                            <text
                              x={542}
                              y={y + 4}
                              textAnchor="start"
                              className="svg-halo fill-foreground text-[11px]"
                            >
                              {circuit.connectedComponent}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Selected Pin Multimeter Probe Spec & Lemon Wiring Quick Jump */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm border-b border-border/40 pb-3">
                    {selectedCircuit ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>
                          <span className="font-mono font-semibold text-foreground">
                            Pin {selectedCircuit.pin} ({selectedCircuit.wireColorCode})
                          </span>{' '}
                          · {selectedCircuit.signalName}
                        </span>
                        <span className="font-mono text-xs text-primary">
                          Test spec: {selectedCircuit.testSpec}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted text-xs">
                        Select any pin row to inspect multimeter probe values.
                      </span>
                    )}
                    <Button
                      size="sm"
                      tone="quiet"
                      onClick={() => {
                        setLemonSection('wiring');
                        setLemonJumpNonce((n) => n + 1);
                        setDetailTab('lemon');
                      }}
                    >
                      <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Open OEM wiring in Lemon Manual</span>
                    </Button>
                  </div>

                  {/* Full Pinout Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border/40 text-xs font-semibold uppercase tracking-wider text-muted">
                          <th className="py-2 pr-3">PIN</th>
                          <th className="py-2 px-3">WIRE</th>
                          <th className="py-2 px-3">CIRCUIT SIGNAL</th>
                          <th className="py-2 px-3">CONNECTED TO</th>
                          <th className="py-2 pl-3">MULTIMETER TEST SPEC</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 text-sm">
                        {activeModule.wiringCircuits.map((c) => {
                          const active = selectedCircuit?.pin === c.pin;
                          return (
                            <tr
                              key={c.pin}
                              onClick={() => setSelectedPin(c.pin)}
                              className={`cursor-pointer ${
                                active ? 'bg-background' : 'hover:bg-background/60'
                              }`}
                            >
                              <td className="py-2.5 pr-3 font-mono font-semibold text-foreground whitespace-nowrap">
                                {c.pin}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-xs text-muted whitespace-nowrap">
                                {c.wireColorCode}
                              </td>
                              <td className="py-2.5 px-3 text-foreground">{c.signalName}</td>
                              <td className="py-2.5 px-3 text-muted">{c.connectedComponent}</td>
                              <td className="py-2.5 pl-3 font-mono text-xs text-foreground">
                                {c.testSpec}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 2: Component Location Guide (Top-Down Chassis Locator SVG + Access Steps) */}
              {detailTab === 'location' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  <div className="lg:col-span-6 border-b lg:border-b-0 lg:border-r border-border/40 pb-4 lg:pb-0 lg:pr-4">
                    <svg
                      viewBox="0 0 360 420"
                      className="h-auto w-full max-w-[340px] mx-auto"
                      role="img"
                      aria-label={`Chassis location map for ${activeModule.moduleName}`}
                    >
                      {/* Top-Down Vehicle Body Outline */}
                      <rect
                        x={65}
                        y={24}
                        width={230}
                        height={372}
                        rx={34}
                        fill="var(--color-surface-recessed)"
                        stroke="var(--color-border)"
                        strokeWidth={1.5}
                      />
                      {/* Front Firewall Divider */}
                      <line
                        x1={65}
                        y1={134}
                        x2={295}
                        y2={134}
                        stroke="var(--color-border)"
                        strokeWidth={1.2}
                        strokeDasharray="4 4"
                      />
                      {/* Rear Bulkhead Divider */}
                      <line
                        x1={65}
                        y1={296}
                        x2={295}
                        y2={296}
                        stroke="var(--color-border)"
                        strokeWidth={1.2}
                        strokeDasharray="4 4"
                      />
                      {/* Zone Labels */}
                      <text
                        x={180}
                        y={46}
                        textAnchor="middle"
                        className="svg-halo fill-muted text-[10px] font-mono"
                      >
                        FRONT / ENGINE BAY
                      </text>
                      <text
                        x={180}
                        y={156}
                        textAnchor="middle"
                        className="svg-halo fill-muted text-[10px] font-mono"
                      >
                        CABIN / DASHBOARD
                      </text>
                      <text
                        x={180}
                        y={316}
                        textAnchor="middle"
                        className="svg-halo fill-muted text-[10px] font-mono"
                      >
                        REAR / BED OR TRUNK
                      </text>

                      {/* Reference DLC J1962 Port Marker (LH Driver Dash) */}
                      <circle
                        cx={118}
                        cy={186}
                        r={6}
                        fill="var(--color-surface)"
                        stroke="var(--color-muted)"
                        strokeWidth={1.5}
                      />
                      <text
                        x={118}
                        y={204}
                        textAnchor="middle"
                        className="svg-halo fill-muted text-[10px] font-mono"
                      >
                        DLC J1962
                      </text>

                      {/* Target ECU Pin */}
                      {(() => {
                        const px = 65 + (activeModule.location.xPct / 100) * 230;
                        const py = 24 + (activeModule.location.yPct / 100) * 372;
                        return (
                          <g>
                            <circle
                              cx={px}
                              cy={py}
                              r={13}
                              fill="var(--color-primary)"
                              fillOpacity={0.18}
                              stroke="var(--color-primary)"
                              strokeWidth={2}
                            />
                            <circle cx={px} cy={py} r={5} fill="var(--color-primary)" />
                            <text
                              x={px}
                              y={py - 18}
                              textAnchor="middle"
                              className="svg-halo fill-primary text-[12px] font-semibold"
                            >
                              {activeModule.shortCode}
                            </text>
                          </g>
                        );
                      })()}
                    </svg>
                  </div>

                  <div className="lg:col-span-6 space-y-4 text-sm">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                        CHASSIS ZONE
                      </div>
                      <div className="font-semibold text-foreground mt-0.5">
                        {activeModule.location.zone}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                        PHYSICAL ACCESS SUMMARY
                      </div>
                      <p className="text-foreground leading-relaxed mt-0.5">
                        {activeModule.location.accessSummary}
                      </p>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                        MOUNTING &amp; TORQUE SPEC
                      </div>
                      <p className="font-mono text-xs text-foreground mt-0.5">
                        {activeModule.location.mountingFasteners}
                      </p>
                    </div>

                    <div className="border-t border-border/40 pt-3 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                        R&amp;R REMOVAL PROCEDURE
                      </div>
                      <ol className="space-y-2">
                        {activeModule.location.removalSteps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2 leading-relaxed">
                            <span className="font-mono text-xs text-primary mt-0.5">
                              {i + 1}.
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="pt-1">
                      <Button
                        size="sm"
                        tone="quiet"
                        onClick={() => {
                          setLemonSection('locations');
                          setLemonJumpNonce((n) => n + 1);
                          setDetailTab('lemon');
                        }}
                      >
                        <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>Open OEM location views in Lemon Manual</span>
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Calibration Files & Flash Manifest */}
              {detailTab === 'calibrations' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border/40 text-xs font-semibold uppercase tracking-wider text-muted">
                          <th className="py-2 pr-3">CALIBRATION FILE</th>
                          <th className="py-2 px-3">FORMAT</th>
                          <th className="py-2 px-3">RELEASE</th>
                          <th className="py-2 px-3">CHECKSUM</th>
                          <th className="py-2 pl-3 text-right">ACTION</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 text-sm">
                        {activeModule.calibrationFiles.map((file) => (
                          <tr key={file.fileName}>
                            <td className="py-3 pr-3">
                              <div className="font-mono font-semibold text-foreground">
                                {file.fileName}
                              </div>
                              <div className="text-xs text-muted mt-0.5">{file.notes}</div>
                            </td>
                            <td className="py-3 px-3 text-xs text-muted whitespace-nowrap">
                              {file.format} · {file.sizeKb.toLocaleString()} KB
                            </td>
                            <td className="py-3 px-3 text-xs whitespace-nowrap">
                              <div className="font-mono text-foreground">{file.releaseDate}</div>
                              {file.tsbRef && (
                                <div className="text-primary font-medium">{file.tsbRef}</div>
                              )}
                            </td>
                            <td className="py-3 px-3 font-mono text-xs text-muted whitespace-nowrap">
                              <div>CRC {file.crc32Hex}</div>
                              <div>SHA {file.sha256Short}</div>
                            </td>
                            <td className="py-3 pl-3 text-right whitespace-nowrap">
                              {file.isLatest ? (
                                <Button size="sm" onClick={onJumpToFlasher}>
                                  <span>Load in J2534</span>
                                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                                </Button>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-muted">
                                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  Superseded
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: Live Embedded Lemon Workshop Manual (lemon.dogeware.me) */}
              {detailTab === 'lemon' && (
                <LemonManualEmbed
                  key={`lib-${libraryData.vehicle.id}-${lemonSection}-${lemonJumpNonce}`}
                  make={libraryData.vehicle.make}
                  model={libraryData.vehicle.model}
                  year={libraryData.vehicle.year}
                  initialSection={lemonSection}
                  title="Live Lemon Workshop Manual (lemon.dogeware.me)"
                  subtitle={`Embedded repair manual for ${libraryData.vehicle.year} ${libraryData.vehicle.make} ${libraryData.vehicle.model} — navigate OEM wiring diagrams, component locations, DTC indexes, and procedures directly inside the workstation.`}
                  heightClassName="h-[640px]"
                />
              )}
            </>
          ) : (
            <p className="text-sm text-muted py-6">
              Select a vehicle module from the left catalog to inspect its wiring diagrams, chassis location guide, and calibration files.
            </p>
          )}
        </Surface>
      </div>
    </div>
  );
};
