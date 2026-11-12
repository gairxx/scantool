// Minimal W3C Web Bluetooth & Web Serial global type declarations for hardware OBD-II / J2534 adapters

declare global {
  interface BluetoothRemoteGATTCharacteristic extends EventTarget {
    readonly value?: DataView;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    writeValue(value: BufferSource): Promise<void>;
    writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  }

  interface BluetoothRemoteGATTService {
    getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
    getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
  }

  interface BluetoothRemoteGATTServer {
    readonly connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
    getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
  }

  interface BluetoothDevice extends EventTarget {
    readonly id: string;
    readonly name?: string;
    readonly gatt?: BluetoothRemoteGATTServer;
  }

  interface BluetoothRequestDeviceOptions {
    filters?: Array<{
      services?: Array<string | number>;
      namePrefix?: string;
    }>;
    optionalServices?: Array<string | number>;
    acceptAllDevices?: boolean;
  }

  interface WebBluetooth {
    requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
  }

  interface SerialPortInfo {
    usbVendorId?: number;
    usbProductId?: number;
  }

  interface SerialPort {
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
    getInfo(): SerialPortInfo;
  }

  interface WebSerial {
    requestPort(): Promise<SerialPort>;
  }

  interface Navigator {
    bluetooth?: WebBluetooth;
    serial?: WebSerial;
  }
}

export {};
