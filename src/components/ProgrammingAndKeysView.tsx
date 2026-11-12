import React, { useEffect, useState } from 'react';
import {
  Cpu,
  KeyRound,
  ShieldCheck,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Library,
} from 'lucide-react';
import { Button, Field, Surface, StatusMark } from './ui';
import { VehicleModuleLibraryView } from './VehicleModuleLibraryView';
import type { TelemetryOverrides } from '../lib/telemetryEngine';
import type {
  CalibrationPackage,
  EcuModule,
  ImmobilizerKeySlot,
  VehicleProfile,
} from '../types/diagnostic';

export type ProgrammingSubMode = 'ecu_flash' | 'immobilizer' | 'library';

interface ProgrammingAndKeysViewProps {
  vehicle: VehicleProfile;
  modules: EcuModule[];
  keySlots: ImmobilizerKeySlot[];
  appliedCalibrations: string[];
  overrides: TelemetryOverrides;
  liveBatteryVolts: number;
  initialSubMode?: ProgrammingSubMode;
  initialFocusModuleId?: string | null;
  onUpdateOverrides: (patch: Partial<TelemetryOverrides>) => void;
  onCompleteFlash: (pkg: CalibrationPackage) => void;
  onUpdateKeySlots: (nextSlots: ImmobilizerKeySlot[]) => void;
}

const FLASH_STEPS = [
  'Entering UDS Programming Session (0x10 0x02) & locking CAN gateway…',
  'Exchanging 256-bit OEM Seed-Key Security Access (0x27 0x01 / 0x02)…',
  'Erasing non-volatile flash sectors (RoutineControl 0x31 0xFF 0x00)…',
  'Streaming calibration blocks via J2534-2 RequestDownload / TransferData (0x34 / 0x36)…',
  'Verifying CRC-32 block checksums & executing ECU Hard Reset (0x11 0x01)…',
];

export const ProgrammingAndKeysView: React.FC<ProgrammingAndKeysViewProps> = ({
  vehicle,
  modules,
  keySlots,
  appliedCalibrations,
  overrides,
  liveBatteryVolts,
  initialSubMode = 'ecu_flash',
  initialFocusModuleId = null,
  onUpdateOverrides,
  onCompleteFlash,
  onUpdateKeySlots,
}) => {
  const [subMode, setSubMode] = useState<ProgrammingSubMode>(initialSubMode);

  useEffect(() => {
    setSubMode(initialSubMode);
  }, [initialSubMode, initialFocusModuleId]);

  // ECU Flash state
  const [selectedCalId, setSelectedCalId] = useState<string>(
    vehicle.calibrations[0]?.id ?? ''
  );
  const [flashingPkgId, setFlashingPkgId] = useState<string | null>(null);
  const [flashPct, setFlashPct] = useState<number>(0);
  const [flashStepIndex, setFlashStepIndex] = useState<number>(0);
  const [flashStatusMsg, setFlashStatusMsg] = useState<string>('');

  // Immobilizer state
  const [securityUnlocked, setSecurityUnlocked] = useState<boolean>(false);
  const [enteredIncode, setEnteredIncode] = useState<string>(vehicle.computedIncode);
  const [newTransponderHex, setNewTransponderHex] = useState<string>('E4:71:9C:28');
  const [immoStatusMsg, setImmoStatusMsg] = useState<string>('');
  const [rfPacketLog, setRfPacketLog] = useState<
    Array<{ id: string; button: string; freq: string; rssi: number; rollingSync: string }>
  >([
    {
      id: 'rf-1',
      button: 'Lock (0x01)',
      freq: keySlots[0]?.modulation || '433.92 MHz FSK',
      rssi: -47,
      rollingSync: 'AES Counter +1 Valid',
    },
  ]);

  useEffect(() => {
    setSelectedCalId(vehicle.calibrations[0]?.id ?? '');
    setSecurityUnlocked(false);
    setEnteredIncode(vehicle.computedIncode);
    setFlashStatusMsg('');
    setImmoStatusMsg('');
  }, [vehicle.id, vehicle.calibrations, vehicle.computedIncode]);

  const activeCal =
    vehicle.calibrations.find((c) => c.id === selectedCalId) || vehicle.calibrations[0];

  // Progress timer for J2534 ECU Flash
  useEffect(() => {
    if (!flashingPkgId || !activeCal) return;
    const timer = window.setInterval(() => {
      setFlashPct((prev) => {
        const next = Math.min(100, prev + 5);
        const stepIdx = Math.min(
          FLASH_STEPS.length - 1,
          Math.floor((next / 100) * FLASH_STEPS.length)
        );
        setFlashStepIndex(stepIdx);
        if (next >= 100) {
          window.clearInterval(timer);
          setFlashingPkgId(null);
          onCompleteFlash(activeCal);
          setFlashStatusMsg(
            `Flashed ${activeCal.moduleId} to calibration ${activeCal.newCalId} (CRC ${activeCal.crc32Hex} verified).`
          );
        }
        return next;
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [flashingPkgId, activeCal, onCompleteFlash]);

  const maintainerVolts = overrides.maintainerVoltageSet ?? liveBatteryVolts;
  const minVoltsRequired = activeCal?.requiresMaintainerVolts ?? 12.4;
  const voltageOk = maintainerVolts >= minVoltsRequired;
  const koeoOk = overrides.ignitionState === 'KOEO';
  const alreadyApplied = activeCal ? appliedCalibrations.includes(activeCal.newCalId) : false;

  const handleStartFlash = () => {
    if (!activeCal || !voltageOk || !koeoOk) return;
    setFlashStatusMsg('');
    setFlashPct(0);
    setFlashStepIndex(0);
    setFlashingPkgId(activeCal.id);
  };

  const handleUnlockSecurity = () => {
    if (enteredIncode.trim().toUpperCase() === vehicle.computedIncode.toUpperCase()) {
      setSecurityUnlocked(true);
      setImmoStatusMsg(
        `Security Access Level 0x11 granted for ${vehicle.immobilizerSystem}. Transponder write routines enabled.`
      );
    } else {
      setSecurityUnlocked(false);
      setImmoStatusMsg(
        `Invalid Incode. Expected dealer response ${vehicle.computedIncode} for Outcode ${vehicle.securityPinOutcode}.`
      );
    }
  };

  const handleAddOrRepairKey = () => {
    if (!securityUnlocked) return;
    const updated = [...keySlots];
    const faultIdx = updated.findIndex((k) => k.status === 'Sync Fault');
    const emptyIdx = updated.findIndex((k) => k.status === 'Empty');

    if (faultIdx >= 0) {
      updated[faultIdx] = {
        ...updated[faultIdx],
        status: 'Authorized',
        batteryState: 'OK',
        lastRssiDbm: -48,
      };
      onUpdateKeySlots(updated);
      setImmoStatusMsg(
        `Re-synchronized Transponder Slot #${updated[faultIdx].slot} (${updated[faultIdx].transponderId}) into immobilizer EEPROM.`
      );
      return;
    }

    if (emptyIdx >= 0) {
      updated[emptyIdx] = {
        ...updated[emptyIdx],
        transponderId: `${newTransponderHex.toUpperCase()} (OEM Smart Fob)`,
        type: 'Dealer Replacement Fob',
        status: 'Authorized',
        lastRssiDbm: -46,
        batteryState: 'OK',
      };
      onUpdateKeySlots(updated);
      setImmoStatusMsg(
        `Programmed new smart key fob ${newTransponderHex.toUpperCase()} into Slot #${updated[emptyIdx].slot}.`
      );
      return;
    }

    const nextSlotNum = updated.length + 1;
    updated.push({
      slot: nextSlotNum,
      transponderId: `${newTransponderHex.toUpperCase()} (OEM Smart Fob)`,
      type: 'Dealer Replacement Fob',
      modulation: updated[0]?.modulation || '433.92 MHz FSK',
      encryption: updated[0]?.encryption || 'AES-128 Rolling',
      status: 'Authorized',
      lastRssiDbm: -46,
      batteryState: 'OK',
    });
    onUpdateKeySlots(updated);
    setImmoStatusMsg(
      `Allocated Slot #${nextSlotNum} and paired transponder ${newTransponderHex.toUpperCase()}.`
    );
  };

  const handleAllKeysLostRelearn = () => {
    if (!securityUnlocked) return;
    const baseMod = keySlots[0]?.modulation || '433.92 MHz FSK';
    const baseEnc = keySlots[0]?.encryption || 'AES-128 Rolling';
    const freshTwoKeys: ImmobilizerKeySlot[] = [
      {
        slot: 1,
        transponderId: 'B1:08:4F:19 (Master Relearned)',
        type: 'Dealer Replacement Fob',
        modulation: baseMod,
        encryption: baseEnc,
        status: 'Authorized',
        lastRssiDbm: -45,
        batteryState: 'OK',
      },
      {
        slot: 2,
        transponderId: `${newTransponderHex.toUpperCase()} (Secondary Relearned)`,
        type: 'Dealer Replacement Fob',
        modulation: baseMod,
        encryption: baseEnc,
        status: 'Authorized',
        lastRssiDbm: -48,
        batteryState: 'OK',
      },
      {
        slot: 3,
        transponderId: '00:00:00:00',
        type: 'Unassigned',
        modulation: baseMod,
        encryption: baseEnc,
        status: 'Empty',
        lastRssiDbm: null,
        batteryState: 'N/A',
      },
    ];
    onUpdateKeySlots(freshTwoKeys);
    setImmoStatusMsg(
      'Completed All-Keys-Lost parameter reset: erased prior lost fobs and registered 2 mandatory new transponders.'
    );
  };

  const handleSimulateRfPress = (btnLabel: string) => {
    const freq = keySlots[0]?.modulation || '433.92 MHz FSK';
    const rssi = -44 - Math.floor(Math.random() * 9);
    setRfPacketLog((prev) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        button: btnLabel,
        freq,
        rssi,
        rollingSync: 'Rolling Counter In-Window (OK)',
      },
      ...prev.slice(0, 4),
    ]);
  };

  return (
    <div className="space-y-5">
      {/* Header & Mode Switcher */}
      <Surface className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-display text-foreground">
              Module library, J2534 flashing &amp; immobilizer keys
            </h1>
            <p className="text-sm text-muted">
              Retrieve OEM wiring diagrams, chassis location guides, and calibration files, or execute J2534 ECU flashing and key fob relearning.
            </p>
          </div>

          <div
            className="flex flex-wrap items-center gap-2"
            role="tablist"
            aria-label="Programming and library mode"
          >
            <Button
              tone={subMode === 'library' ? 'primary' : 'quiet'}
              onClick={() => setSubMode('library')}
              role="tab"
              aria-selected={subMode === 'library'}
            >
              <Library className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Module library</span>
            </Button>
            <Button
              tone={subMode === 'ecu_flash' ? 'primary' : 'quiet'}
              onClick={() => setSubMode('ecu_flash')}
              role="tab"
              aria-selected={subMode === 'ecu_flash'}
            >
              <Cpu className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>J2534 ECU flash</span>
            </Button>
            <Button
              tone={subMode === 'immobilizer' ? 'primary' : 'quiet'}
              onClick={() => setSubMode('immobilizer')}
              role="tab"
              aria-selected={subMode === 'immobilizer'}
            >
              <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Immobilizer &amp; keys</span>
            </Button>
          </div>
        </div>
      </Surface>

      {subMode === 'library' ? (
        <VehicleModuleLibraryView
          activeVehicle={vehicle}
          initialFocusModuleId={initialFocusModuleId}
          onJumpToFlasher={() => setSubMode('ecu_flash')}
        />
      ) : subMode === 'ecu_flash' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left: Calibration Bulletins & Installed Versions */}
          <Surface className="lg:col-span-5 p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="text-title text-foreground">OEM calibration packages</h2>
              <p className="text-sm text-muted">
                Matched by VIN <span className="font-mono text-foreground">{vehicle.vin}</span>
              </p>
            </div>

            <div className="divide-y divide-border/40 border-t border-b border-border/40">
              {vehicle.calibrations.map((cal) => {
                const mod = modules.find((m) => m.id === cal.moduleId);
                const isApplied =
                  appliedCalibrations.includes(cal.newCalId) ||
                  mod?.calibrationId === cal.newCalId;
                const isSelected = activeCal?.id === cal.id;

                return (
                  <button
                    key={cal.id}
                    type="button"
                    onClick={() => setSelectedCalId(cal.id)}
                    className={`w-full text-left py-3.5 px-2 rounded-control transition-colors space-y-1 ${
                      isSelected ? 'bg-background' : 'hover:bg-background/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-foreground">
                        {cal.moduleId} · {cal.moduleName}
                      </span>
                      <StatusMark
                        kind={isApplied ? 'nominal' : 'advisory'}
                        label={isApplied ? 'Updated' : cal.tsbNumber}
                      />
                    </div>
                    <div className="font-mono text-xs text-muted">
                      {mod?.calibrationId || cal.currentCalId} →{' '}
                      <span className="text-primary font-medium">{cal.newCalId}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {cal.sizeKb.toLocaleString()} KB · CRC {cal.crc32Hex} · Released {cal.releaseDate}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Shop Battery Maintainer Supply Trim */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-sm">
                <label htmlFor="maintainer-volts" className="font-medium text-foreground">
                  Shop DC power supply maintainer
                </label>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    voltageOk ? 'text-nominal' : 'text-fault'
                  }`}
                >
                  {maintainerVolts.toFixed(2)} V
                </span>
              </div>
              <input
                id="maintainer-volts"
                type="range"
                min={11.8}
                max={14.2}
                step={0.1}
                value={Number(maintainerVolts.toFixed(1))}
                onChange={(e) =>
                  onUpdateOverrides({ maintainerVoltageSet: Number(e.target.value) })
                }
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted">
                J2534 flash interlock requires clean regulated supply &ge; {minVoltsRequired.toFixed(1)} V in KOEO mode.
              </p>
            </div>
          </Surface>

          {/* Right: Flash Pre-Flight Checklist & Block Programming Execution */}
          <Surface className="lg:col-span-7 p-4 sm:p-5 space-y-5">
            {activeCal ? (
              <>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-title text-foreground">
                      Reprogram {activeCal.moduleName} ({activeCal.moduleId})
                    </h2>
                    <span className="font-mono text-xs text-muted">{activeCal.tsbNumber}</span>
                  </div>
                  <p className="text-sm text-muted leading-relaxed">{activeCal.summary}</p>
                </div>

                {/* Pre-Flash Interlock Verification Rows */}
                <div className="divide-y divide-border/40 border-t border-b border-border/40 text-sm">
                  <div className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted">1. Ignition state (KOEO — Engine OFF)</span>
                    <div className="flex items-center gap-2">
                      <StatusMark
                        kind={koeoOk ? 'nominal' : 'fault'}
                        label={koeoOk ? 'KOEO verified' : 'Engine running (KOER)'}
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
                    </div>
                  </div>

                  <div className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted">
                      2. Terminal 30 supply voltage (&ge; {minVoltsRequired.toFixed(1)} V)
                    </span>
                    <div className="flex items-center gap-2">
                      <StatusMark
                        kind={voltageOk ? 'nominal' : 'fault'}
                        label={`${maintainerVolts.toFixed(2)} V`}
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

                  <div className="py-2.5 flex items-center justify-between gap-2">
                    <span className="text-muted">3. Target calibration &amp; CRC-32 image</span>
                    <span className="font-mono text-foreground">
                      {activeCal.newCalId} ({activeCal.crc32Hex})
                    </span>
                  </div>
                </div>

                {/* Progress Stage */}
                {flashingPkgId && (
                  <div className="space-y-2.5" role="status" aria-live="polite">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">
                        {FLASH_STEPS[flashStepIndex]}
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-primary">
                        {flashPct} %
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-control bg-surface-recessed overflow-hidden border border-border/40">
                      <div
                        className="h-full bg-primary transition-[width] duration-150 ease-out"
                        style={{ width: `${flashPct}%` }}
                      />
                    </div>
                    <div className="text-xs font-mono text-muted">
                      Transfer rate: 148.4 KB/s · Do not cycle ignition or disconnect J1962 DLC connector
                    </div>
                  </div>
                )}

                {flashStatusMsg && (
                  <div
                    role="status"
                    className="flex items-center gap-2.5 text-sm font-medium text-nominal"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{flashStatusMsg}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={handleStartFlash}
                    disabled={!koeoOk || !voltageOk || Boolean(flashingPkgId)}
                  >
                    <Cpu className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {flashingPkgId
                        ? 'Flashing ECU memory…'
                        : alreadyApplied
                          ? `Re-flash ${activeCal.newCalId}`
                          : `Execute J2534 flash (${activeCal.sizeKb.toLocaleString()} KB)`}
                    </span>
                  </Button>
                  {(!koeoOk || !voltageOk) && (
                    <span className="text-xs text-advisory flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Satisfy KOEO and battery maintainer voltage above before flashing.
                    </span>
                  )}
                </div>
              </>
            ) : null}
          </Surface>
        </div>
      ) : (
        /* Immobilizer & Smart Key Fob Relearning Workspace */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left: Registered Key Slots & Security Access */}
          <Surface className="lg:col-span-7 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <h2 className="text-title text-foreground">
                  Registered immobilizer transponder slots
                </h2>
                <p className="text-sm text-muted">{vehicle.immobilizerSystem}</p>
              </div>
              <StatusMark
                kind={securityUnlocked ? 'nominal' : 'advisory'}
                label={securityUnlocked ? 'Security 0x27 unlocked' : 'Security locked'}
              />
            </div>

            <div className="overflow-x-auto border-t border-b border-border/40">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/40 text-xs font-semibold uppercase tracking-wider text-muted">
                    <th className="py-2.5 pr-3">SLOT</th>
                    <th className="py-2.5 px-3">TRANSPONDER UID</th>
                    <th className="py-2.5 px-3">KEY TYPE</th>
                    <th className="py-2.5 px-3">RSSI / BATT</th>
                    <th className="py-2.5 pl-3">STATE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 text-sm">
                  {keySlots.map((slot) => (
                    <tr key={slot.slot}>
                      <td className="py-2.5 pr-3 font-mono font-semibold text-foreground">
                        #{slot.slot}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-foreground">
                        {slot.transponderId}
                      </td>
                      <td className="py-2.5 px-3 text-muted">{slot.type}</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-muted whitespace-nowrap">
                        {slot.lastRssiDbm !== null ? `${slot.lastRssiDbm} dBm · ${slot.batteryState}` : '—'}
                      </td>
                      <td className="py-2.5 pl-3 whitespace-nowrap">
                        <StatusMark
                          kind={
                            slot.status === 'Authorized'
                              ? 'nominal'
                              : slot.status === 'Sync Fault'
                                ? 'fault'
                                : 'neutral'
                          }
                          label={slot.status}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {immoStatusMsg && (
              <p role="status" className="text-sm font-medium text-primary">
                {immoStatusMsg}
              </p>
            )}

            {/* Guided Key Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-1">
              <Field
                id="new-fob-uid"
                label="LF backup pocket transponder UID"
                value={newTransponderHex}
                onChange={(e) => setNewTransponderHex(e.target.value)}
                className="sm:col-span-5 font-mono"
              />
              <div className="sm:col-span-7 flex flex-wrap gap-2">
                <Button onClick={handleAddOrRepairKey} disabled={!securityUnlocked}>
                  <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {keySlots.some((k) => k.status === 'Sync Fault')
                      ? 'Repair & sync faulted fob'
                      : 'Add spare smart key'}
                  </span>
                </Button>
                <Button
                  tone="quiet"
                  onClick={handleAllKeysLostRelearn}
                  disabled={!securityUnlocked}
                >
                  All-keys-lost reset (2-key)
                </Button>
              </div>
            </div>
          </Surface>

          {/* Right: Outcode/Incode Security Calculator & RKE RF Tester */}
          <Surface className="lg:col-span-5 p-4 sm:p-5 space-y-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                <h2 className="text-title text-foreground">Seed-key / Outcode security gateway</h2>
              </div>

              <div className="divide-y divide-border/40 border-t border-b border-border/40 text-sm">
                <div className="py-2 flex items-center justify-between">
                  <span className="text-muted">Vehicle challenge outcode</span>
                  <span className="font-mono font-medium text-foreground">
                    {vehicle.securityPinOutcode}
                  </span>
                </div>
                <div className="py-2 flex items-center justify-between">
                  <span className="text-muted">Calculated dealer token</span>
                  <span className="font-mono text-primary">{vehicle.computedIncode}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-end">
                <Field
                  id="security-incode-input"
                  label="Security access incode / PIN"
                  value={enteredIncode}
                  onChange={(e) => setEnteredIncode(e.target.value)}
                  className="flex-1 font-mono"
                />
                <Button onClick={handleUnlockSecurity}>
                  {securityUnlocked ? 'Re-verify token' : 'Unlock immobilizer'}
                </Button>
              </div>
            </div>

            {/* RKE Keyless RF Receiver Test */}
            <div className="pt-4 border-t border-border/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-primary" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-foreground">
                    RKE fob UHF packet &amp; rolling-code tester
                  </h3>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {['Lock (0x01)', 'Unlock (0x02)', 'Remote Start (0x08)', 'Panic (0x0F)'].map(
                  (btn) => (
                    <Button
                      key={btn}
                      size="sm"
                      tone="quiet"
                      onClick={() => handleSimulateRfPress(btn)}
                    >
                      Test {btn.split(' ')[0]}
                    </Button>
                  )
                )}
              </div>

              <Surface inset className="p-3 font-mono text-xs space-y-1.5">
                {rfPacketLog.map((pkt) => (
                  <div
                    key={pkt.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border/25 last:border-b-0 pb-1 last:pb-0"
                  >
                    <span className="text-foreground font-semibold">{pkt.button}</span>
                    <span className="text-muted">
                      {pkt.freq} · {pkt.rssi} dBm
                    </span>
                    <span className="text-nominal">{pkt.rollingSync}</span>
                  </div>
                ))}
              </Surface>
            </div>
          </Surface>
        </div>
      )}
    </div>
  );
};
