import type { HardwareConnectionMode, ObdProtocolId, VehicleProfile } from '../types/diagnostic';
import { decodeSaeJ1979Pid, encodeCanResponseFrame, PROTOCOL_OPTIONS } from './obdProtocol';

export interface AdapterLogLine {
  id: string;
  timestamp: string;
  direction: 'TX' | 'RX' | 'INFO';
  frame: string;
}

const BLE_OBD_SERVICES = [
  '0000fff0-0000-1000-8000-00805f9b34fb', // Standard ELM327 / VLinker BLE
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / Viecar BLE OBD-II
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Vgate iCar Pro / IOS-Vlink
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART OBDLink CX
];

export class DiagnosticHardwareManager {
  private mode: HardwareConnectionMode = 'simulated';
  private deviceName = 'TorqueLink J2534-2 Virtual Bus';
  private bleDevice: BluetoothDevice | null = null;
  private bleWriteChar: BluetoothRemoteGATTCharacteristic | null = null;
  private serialPort: SerialPort | null = null;
  private rxBuffer = '';
  private pendingResolver: ((response: string) => void) | null = null;

  public getStatus(): {
    mode: HardwareConnectionMode;
    deviceName: string;
    bluetoothSupported: boolean;
    serialSupported: boolean;
  } {
    return {
      mode: this.mode,
      deviceName: this.deviceName,
      bluetoothSupported: typeof navigator !== 'undefined' && Boolean(navigator.bluetooth),
      serialSupported: typeof navigator !== 'undefined' && Boolean(navigator.serial),
    };
  }

  public async connectBluetoothBle(
    protocol: ObdProtocolId,
    onLog: (entry: AdapterLogLine) => void
  ): Promise<{ deviceName: string }> {
    if (!navigator.bluetooth) {
      throw new Error(
        'Web Bluetooth API is unavailable in this browser context. Use Chrome/Edge over HTTPS or run in Simulated VCI mode.'
      );
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [BLE_OBD_SERVICES[0]] },
        { services: [BLE_OBD_SERVICES[1]] },
        { namePrefix: 'OBD' },
        { namePrefix: 'V-LINK' },
        { namePrefix: 'IOS-Vlink' },
        { namePrefix: 'ELM327' },
      ],
      optionalServices: BLE_OBD_SERVICES,
    });

    if (!device.gatt) {
      throw new Error('Selected Bluetooth adapter does not expose a GATT server.');
    }

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    if (services.length === 0) {
      throw new Error('No OBD-II GATT UART services discovered on Bluetooth adapter.');
    }

    let notifyChar: BluetoothRemoteGATTCharacteristic | null = null;
    let writeChar: BluetoothRemoteGATTCharacteristic | null = null;

    for (const svc of services) {
      const chars = await svc.getCharacteristics();
      for (const ch of chars) {
        if (!notifyChar) {
          try {
            await ch.startNotifications();
            notifyChar = ch;
          } catch {
            // characteristic does not support notifications
          }
        }
        if (!writeChar) {
          writeChar = ch;
        }
      }
    }

    if (!writeChar) {
      throw new Error('Could not bind writable OBD-II GATT characteristic.');
    }

    if (notifyChar) {
      notifyChar.addEventListener('characteristicvaluechanged', (ev: Event) => {
        const target = ev.target as BluetoothRemoteGATTCharacteristic;
        if (!target.value) return;
        const chunk = new TextDecoder().decode(target.value.buffer);
        this.handleIncomingChunk(chunk, onLog);
      });
    }

    this.bleDevice = device;
    this.bleWriteChar = writeChar;
    this.mode = 'bluetooth_ble';
    this.deviceName = device.name || 'Bluetooth BLE OBD-II Adapter';

    onLog(this.makeLog('INFO', `Paired Bluetooth BLE adapter: ${this.deviceName}`));

    const protoSpec = PROTOCOL_OPTIONS.find((p) => p.id === protocol) || PROTOCOL_OPTIONS[0];
    await this.sendCommand('ATZ', onLog);
    await this.sendCommand('ATE0', onLog);
    await this.sendCommand('ATH1', onLog);
    await this.sendCommand(protoSpec.elmAtsp, onLog);

    return { deviceName: this.deviceName };
  }

  public async connectUsbSerial(
    baudRate: number,
    protocol: ObdProtocolId,
    onLog: (entry: AdapterLogLine) => void
  ): Promise<{ deviceName: string }> {
    if (!navigator.serial) {
      throw new Error(
        'Web Serial API is unavailable in this browser. Use Chrome/Edge desktop or Simulated VCI mode.'
      );
    }

    const port = await navigator.serial.requestPort();
    await port.open({ baudRate });
    this.serialPort = port;
    this.mode = 'usb_serial';
    const info = port.getInfo();
    this.deviceName = info.usbVendorId
      ? `USB J2534/ELM Serial (VID 0x${info.usbVendorId.toString(16).toUpperCase()})`
      : `USB Serial OBD Adapter (${baudRate} bps)`;

    onLog(this.makeLog('INFO', `Opened ${this.deviceName}`));
    this.pumpSerialReader(port, onLog);

    const protoSpec = PROTOCOL_OPTIONS.find((p) => p.id === protocol) || PROTOCOL_OPTIONS[0];
    await this.sendCommand('ATZ', onLog);
    await this.sendCommand('ATE0', onLog);
    await this.sendCommand(protoSpec.elmAtsp, onLog);

    return { deviceName: this.deviceName };
  }

  public async disconnect(onLog?: (entry: AdapterLogLine) => void): Promise<void> {
    if (this.bleDevice?.gatt?.connected) {
      this.bleDevice.gatt.disconnect();
    }
    if (this.serialPort) {
      try {
        await this.serialPort.close();
      } catch {
        // ignore close errors
      }
    }
    this.bleDevice = null;
    this.bleWriteChar = null;
    this.serialPort = null;
    this.mode = 'simulated';
    this.deviceName = 'TorqueLink J2534-2 Virtual Bus';
    if (onLog) {
      onLog(this.makeLog('INFO', 'Switched to TorqueLink J2534-2 Simulated Vehicle Bus'));
    }
  }

  private async pumpSerialReader(
    port: SerialPort,
    onLog: (entry: AdapterLogLine) => void
  ): Promise<void> {
    if (!port.readable) return;
    const reader = port.readable.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          this.handleIncomingChunk(decoder.decode(value), onLog);
        }
      }
    } catch {
      // stream closed
    } finally {
      reader.releaseLock();
    }
  }

  private handleIncomingChunk(chunk: string, onLog: (entry: AdapterLogLine) => void): void {
    this.rxBuffer += chunk;
    if (this.rxBuffer.includes('>')) {
      const cleaned = this.rxBuffer.replace(/>/g, '').trim();
      this.rxBuffer = '';
      if (cleaned) {
        onLog(this.makeLog('RX', cleaned));
      }
      if (this.pendingResolver) {
        const resolve = this.pendingResolver;
        this.pendingResolver = null;
        resolve(cleaned);
      }
    }
  }

  public async sendCommand(
    rawCmd: string,
    onLog: (entry: AdapterLogLine) => void,
    vehicleContext?: VehicleProfile,
    liveValues?: Record<string, number>
  ): Promise<string> {
    const cmd = rawCmd.trim().toUpperCase();
    if (!cmd) return '';
    onLog(this.makeLog('TX', cmd));

    if (this.mode === 'bluetooth_ble' && this.bleWriteChar) {
      const bytes = new TextEncoder().encode(`${cmd}\r`);
      const responsePromise = new Promise<string>((resolve) => {
        this.pendingResolver = resolve;
        setTimeout(() => {
          if (this.pendingResolver === resolve) {
            this.pendingResolver = null;
            resolve('TIMEOUT');
          }
        }, 1800);
      });
      await this.bleWriteChar.writeValue(bytes);
      return responsePromise;
    }

    if (this.mode === 'usb_serial' && this.serialPort?.writable) {
      const writer = this.serialPort.writable.getWriter();
      const responsePromise = new Promise<string>((resolve) => {
        this.pendingResolver = resolve;
        setTimeout(() => {
          if (this.pendingResolver === resolve) {
            this.pendingResolver = null;
            resolve('TIMEOUT');
          }
        }, 1800);
      });
      try {
        await writer.write(new TextEncoder().encode(`${cmd}\r`));
      } finally {
        writer.releaseLock();
      }
      return responsePromise;
    }

    // Deterministic Simulated J2534 / ELM327 responder for instant shop bench operation
    const compact = cmd.replace(/\s+/g, '');
    let reply = '7F 00 11 (Service Not Supported)';

    if (compact === 'ATZ') {
      reply = 'ELM327 v2.3 / TorqueLink J2534-2 Bridge Ready';
    } else if (compact === 'ATE0' || compact === 'ATH1' || compact.startsWith('ATSP')) {
      reply = 'OK';
    } else if (compact === 'ATRV') {
      const v = liveValues?.vpwr ?? 14.18;
      reply = `${v.toFixed(2)}V`;
    } else if (compact === 'ATDP') {
      reply = vehicleContext?.protocolLabel || 'ISO 15765-4 (CAN 11/500)';
    } else if (compact === '0100') {
      reply = '7E8  06 41 00 BE 3F A8 13 00';
    } else if (compact === '0902' || compact === '22F190') {
      const vin = vehicleContext?.vin || '1FTFW1ED6PFA48219';
      const hexChars = vin
        .split('')
        .map((c) => c.charCodeAt(0).toString(16).toUpperCase())
        .join(' ');
      reply = `7E8  49 02 01 ${hexChars} (${vin})`;
    } else if (compact === '03') {
      const codes = vehicleContext?.initialDtcs.map((d) => d.code).join(', ') || 'None';
      reply = `7E8  43 0${vehicleContext?.initialDtcs.length ?? 0} [${codes}]`;
    } else if (compact === '04' || compact === '14FFFFFF') {
      reply = '7E8  01 44 00 00 00 00 00 00 (Fault Memory Cleared)';
    } else if (compact === '010C') {
      reply = encodeCanResponseFrame('7E8', '010C', liveValues?.rpm ?? 684);
    } else if (compact === '0105') {
      reply = encodeCanResponseFrame('7E8', '0105', liveValues?.ect ?? 89);
    } else if (compact === '0106') {
      reply = encodeCanResponseFrame('7E8', '0106', liveValues?.stft1 ?? 4.2);
    } else if (compact === '0142') {
      reply = encodeCanResponseFrame('7E8', '0142', liveValues?.vpwr ?? 14.15);
    } else if (compact.startsWith('2701')) {
      reply = '7E8  06 67 01 9A 4C E1 08 (Security Seed Issued)';
    } else if (compact.startsWith('2702')) {
      reply = '7E8  02 67 02 00 00 00 00 00 (Security Access Granted)';
    } else if (compact.startsWith('1002') || compact.startsWith('1003')) {
      reply = `7E8  06 50 ${compact.slice(2, 4)} 00 32 01 F4 00`;
    } else {
      reply = `7E8  03 62 ${compact.slice(0, 2) || '01'} ${compact.slice(2, 4) || '00'} A4 1C`;
    }

    onLog(this.makeLog('RX', reply));
    return reply;
  }

  public parseLiveHexPid(pidHex: string, response: string): number | null {
    const tokens = response
      .trim()
      .split(/[\s:]+/)
      .filter((t) => /^[0-9A-Fa-f]{2}$/.test(t))
      .map((t) => parseInt(t, 16));
    const idx41 = tokens.indexOf(0x41);
    if (idx41 >= 0 && tokens.length >= idx41 + 3) {
      const dataBytes = tokens.slice(idx41 + 2);
      return decodeSaeJ1979Pid(pidHex, dataBytes);
    }
    return null;
  }

  private makeLog(direction: 'TX' | 'RX' | 'INFO', frame: string): AdapterLogLine {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
      2,
      '0'
    )}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(
      3,
      '0'
    )}`;
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: ts,
      direction,
      frame,
    };
  }
}

export const hardwareManager = new DiagnosticHardwareManager();
