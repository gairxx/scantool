import React, { useEffect, useRef, useState } from 'react';
import { Bluetooth, Usb, X, Send, Cpu } from 'lucide-react';
import { Button, Field, SelectField, Surface, StatusMark } from './ui';
import { PROTOCOL_OPTIONS } from '../lib/obdProtocol';
import { hardwareManager } from '../lib/hardwareAdapter';
import type { AdapterLogLine } from '../lib/hardwareAdapter';
import type {
  HardwareConnectionMode,
  ObdProtocolId,
  VehicleProfile,
} from '../types/diagnostic';

interface HardwareConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  vehicle: VehicleProfile;
  protocol: ObdProtocolId;
  onChangeProtocol: (next: ObdProtocolId) => void;
  connectionMode: HardwareConnectionMode;
  deviceName: string;
  onConnectionChanged: (mode: HardwareConnectionMode, deviceName: string) => void;
  liveValues: Record<string, number>;
}

export const HardwareConnectionDialog: React.FC<HardwareConnectionDialogProps> = ({
  open,
  onClose,
  vehicle,
  protocol,
  onChangeProtocol,
  connectionMode,
  deviceName,
  onConnectionChanged,
  liveValues,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [rawCommand, setRawCommand] = useState<string>('09 02');
  const [busy, setBusy] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [logs, setLogs] = useState<AdapterLogLine[]>([
    {
      id: 'boot-1',
      timestamp: '15:00:01.020',
      direction: 'INFO',
      frame: 'TorqueLink J2534-2 / ELM327 Protocol Stack Initialized',
    },
  ]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const pushLog = (entry: AdapterLogLine) => {
    setLogs((prev) => [entry, ...prev.slice(0, 14)]);
  };

  const handlePairBluetooth = async () => {
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await hardwareManager.connectBluetoothBle(protocol, pushLog);
      onConnectionChanged('bluetooth_ble', res.deviceName);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Bluetooth BLE pairing cancelled or unavailable.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConnectSerial = async () => {
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await hardwareManager.connectUsbSerial(baudRate, protocol, pushLog);
      onConnectionChanged('usb_serial', res.deviceName);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'USB Serial port selection cancelled.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUseSimulatedVci = async () => {
    await hardwareManager.disconnect(pushLog);
    onConnectionChanged('simulated', 'TorqueLink J2534-2 Virtual Bus');
    setErrorMsg('');
  };

  const handleSendRawCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawCommand.trim()) return;
    setBusy(true);
    try {
      await hardwareManager.sendCommand(rawCommand, pushLog, vehicle, liveValues);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to transmit frame.');
    } finally {
      setBusy(false);
    }
  };

  const hwCaps = hardwareManager.getStatus();

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="vci-dialog-title"
      className="m-auto w-[min(94vw,46rem)] rounded-card border border-border/60 bg-surface p-0 text-foreground shadow-lg backdrop:bg-foreground/35"
    >
      <div className="p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 border-b border-border/40 pb-4">
          <div className="space-y-1">
            <h2 id="vci-dialog-title" className="text-title text-foreground">
              OBD-II &amp; Bluetooth J2534 VCI hardware interface
            </h2>
            <p className="text-sm text-muted">
              Pair a Bluetooth BLE OBD-II dongle (ELM327, OBDLink CX, Vgate vLinker), connect a USB Pass-Thru cable, or run on the deterministic J2534-2 virtual bus.
            </p>
          </div>
          <Button size="sm" tone="quiet" onClick={onClose} aria-label="Close hardware dialog">
            <X className="h-4 w-4" aria-hidden="true" />
            <span>Close</span>
          </Button>
        </div>

        {/* Active Adapter Status & Protocol Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <SelectField
            id="vci-protocol-select"
            label="OBD-II / UDS transport protocol"
            value={protocol}
            onChange={(e) => onChangeProtocol(e.target.value as ObdProtocolId)}
          >
            {PROTOCOL_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.baudLabel})
              </option>
            ))}
          </SelectField>

          <SelectField
            id="vci-baud-select"
            label="USB Serial UART baud rate"
            value={String(baudRate)}
            onChange={(e) => setBaudRate(Number(e.target.value))}
          >
            <option value="38400">38,400 bps (Classic ELM327)</option>
            <option value="115200">115,200 bps (High-Speed OBDLink)</option>
            <option value="500000">500,000 bps (STN2120 / J2534 Bridge)</option>
          </SelectField>
        </div>

        {/* Adapter Connection Actions */}
        <div className="border-t border-b border-border/40 py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">Active hardware interface:</span>
            <StatusMark
              kind={connectionMode === 'simulated' ? 'advisory' : 'nominal'}
              label={`${deviceName} (${
                connectionMode === 'bluetooth_ble'
                  ? 'Bluetooth GATT'
                  : connectionMode === 'usb_serial'
                    ? 'Web Serial'
                    : 'Simulated Bus'
              })`}
            />
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Button onClick={handlePairBluetooth} disabled={busy}>
              <Bluetooth className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Pair Bluetooth OBD-II adapter</span>
            </Button>

            <Button tone="quiet" onClick={handleConnectSerial} disabled={busy}>
              <Usb className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Connect USB Serial VCI</span>
            </Button>

            {connectionMode !== 'simulated' && (
              <Button tone="quiet" onClick={handleUseSimulatedVci} disabled={busy}>
                <Cpu className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Switch to Simulated VCI</span>
              </Button>
            )}
          </div>

          {!hwCaps.bluetoothSupported && (
            <p className="text-xs text-muted">
              Note: Browser Web Bluetooth requires Chromium over HTTPS with Bluetooth permissions enabled; Simulated VCI bus remains active.
            </p>
          )}

          {errorMsg && (
            <p role="alert" className="text-xs font-medium text-fault">
              {errorMsg}
            </p>
          )}
        </div>

        {/* Raw OBD-II / AT / UDS Hex Command Console */}
        <form onSubmit={handleSendRawCommand} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-end">
            <Field
              id="raw-obd-cmd"
              label="Direct AT / SAE J1979 / UDS hex command"
              value={rawCommand}
              onChange={(e) => setRawCommand(e.target.value)}
              placeholder="e.g. AT RV, 01 0C, 09 02, 27 01"
              className="flex-1 font-mono"
            />
            <Button type="submit" disabled={busy}>
              <Send className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Transmit</span>
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {['AT RV', 'AT DP', '01 0C', '01 05', '09 02', '03', '27 01'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setRawCommand(preset)}
                className="min-h-7 px-2 rounded-control border border-border/50 bg-surface text-xs font-mono text-foreground hover:bg-background"
              >
                {preset}
              </button>
            ))}
          </div>

          <Surface inset className="p-3 font-mono text-xs space-y-1">
            {logs.map((line) => (
              <div key={line.id} className="flex items-start gap-2.5">
                <span className="text-muted tabular-nums shrink-0">{line.timestamp}</span>
                <span
                  className={`font-semibold shrink-0 ${
                    line.direction === 'TX'
                      ? 'text-primary'
                      : line.direction === 'RX'
                        ? 'text-nominal'
                        : 'text-muted'
                  }`}
                >
                  {line.direction}
                </span>
                <span className="text-foreground break-all">{line.frame}</span>
              </div>
            ))}
          </Surface>
        </form>
      </div>
    </dialog>
  );
};
