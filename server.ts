import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { analyzeDtcForVehicle, lookupModuleLibrary } from './src/data/knowledgeBase.ts';
import { LEMON_BASE_URL, buildFallbackLemonResolve } from './src/lib/lemonManual.ts';
import type { LemonManualSection, LemonResolveResult } from './src/types/diagnostic.ts';

const lemonCache = new Map<string, { expiresAt: number; data: LemonResolveResult }>();

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractAnchors(html: string): Array<{ href: string; text: string }> {
  const results: Array<{ href: string; text: string }> = [];
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const text = decodeHtmlEntities(match[2].trim());
    if (!href || href.includes('cdn-cgi') || href === '/about.html' || href === '/style.css') {
      continue;
    }
    results.push({ href, text });
  }
  return results;
}

async function resolveLiveLemonManual(
  make: string,
  model: string,
  year: number
): Promise<LemonResolveResult> {
  const cacheKey = `${make.toLowerCase()}|${year}|${model.toLowerCase()}`;
  const cached = lemonCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const fallback = buildFallbackLemonResolve(make, model, year);

  try {
    const yearUrl = `${LEMON_BASE_URL}/${encodeURIComponent(make)}/${encodeURIComponent(
      String(year)
    )}/`;
    const yearRes = await fetch(yearUrl, { signal: AbortSignal.timeout(4500) });
    if (!yearRes.ok) return fallback;
    const yearHtml = await yearRes.text();
    const candidates = extractAnchors(yearHtml).filter(
      (a) => a.href.startsWith(`/${make}/`) && a.href.split('/').filter(Boolean).length >= 3
    );

    if (candidates.length === 0) return fallback;

    const tokens = model
      .toLowerCase()
      .replace(/[(),]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    let best = candidates[0];
    let bestScore = -1;
    for (const c of candidates) {
      const hay = `${c.text} ${decodeURIComponent(c.href)}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) score += tok.length;
      }
      if (hay.includes('vin d') && model.toLowerCase().includes('powerboost')) score += 6;
      if (hay.includes('8l90') && model.toLowerCase().includes('silverado')) score += 4;
      if (hay.includes('4wd')) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    const vehicleUrl = new URL(best.href, LEMON_BASE_URL).toString();
    const repairUrl = `${vehicleUrl.replace(/\/?$/, '/')}Repair%20and%20Diagnosis/`;
    const repairRes = await fetch(repairUrl, { signal: AbortSignal.timeout(4500) });
    if (!repairRes.ok) return fallback;
    const repairHtml = await repairRes.text();

    const quickLinks = extractAnchors(repairHtml)
      .filter(
        (a) =>
          a.href.includes('Quick%20Lookups') ||
          a.href.includes('Quick Lookups') ||
          (!a.href.startsWith('/') && !a.href.startsWith('..') && !a.href.startsWith('http'))
      )
      .map((a) => ({
        label: a.text || a.href,
        url: new URL(a.href, repairUrl).toString(),
      }));

    const findUrl = (pred: (label: string) => boolean, defaultUrl: string) =>
      quickLinks.find((q) => pred(q.label.toLowerCase()))?.url || defaultUrl;

    const fallbackSections = fallback.sections;
    const dtcUrl = findUrl(
      (l) => l.includes('dtc index'),
      fallbackSections.find((s) => s.id === 'dtc_index')?.url || repairUrl
    );
    const tsbUrl = findUrl(
      (l) => l.includes('technical service bulletins'),
      fallbackSections.find((s) => s.id === 'tsbs')?.url || repairUrl
    );
    const wiringUrl = findUrl(
      (l) =>
        l.includes('system wiring diagrams') ||
        l.includes('oem component harness location views') ||
        l.includes('wiring diagrams'),
      fallbackSections.find((s) => s.id === 'wiring')?.url || repairUrl
    );
    const locUrl = findUrl(
      (l) => l.includes('component locations') || l.includes('fuse and relay location'),
      fallbackSections.find((s) => s.id === 'locations')?.url || repairUrl
    );

    const sections: LemonManualSection[] = [
      { id: 'repair', label: 'Repair & Diagnosis', url: repairUrl },
      { id: 'dtc_index', label: 'DTC Index', url: dtcUrl },
      { id: 'tsbs', label: 'TSBs', url: tsbUrl },
      { id: 'wiring', label: 'Wiring Diagrams', url: wiringUrl },
      { id: 'locations', label: 'Component Locations', url: locUrl },
      { id: 'home', label: 'All Manuals', url: `${LEMON_BASE_URL}/` },
    ];

    const resolved: LemonResolveResult = {
      source: 'live-lemon-mirror',
      baseUrl: LEMON_BASE_URL,
      vehicleLabel: `${year} ${make} ${best.text}`,
      vehicleUrl,
      repairUrl,
      sections,
      allQuickLinks: quickLinks.slice(0, 24),
    };

    lemonCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60 * 1000, data: resolved });
    return resolved;
  } catch {
    return fallback;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface StoredDtcItem {
  code: string;
  moduleId: string;
  moduleName: string;
  status: 'Confirmed' | 'Pending' | 'History' | 'Permanent';
  description: string;
  freezeFrameSummary?: string;
}

interface StoredCloudReport {
  id: string;
  reportNumber: string;
  createdAtIso: string;
  scanType: 'Pre-Scan' | 'Post-Scan' | 'Flash & Calibration' | 'Immobilizer Audit';
  vin: string;
  year: number;
  make: string;
  model: string;
  engine: string;
  odometerKm: number;
  protocol: string;
  technicianBay: string;
  batteryVoltage: number;
  modulesScanned: number;
  modulesWithFaults: number;
  dtcs: StoredDtcItem[];
  calibrationsApplied: string[];
  keysProgrammedCount: number;
  notes: string;
  telemetrySnapshot: Array<{
    pid: string;
    label: string;
    value: number;
    unit: string;
  }>;
}

const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_FILE = path.join(DATA_DIR, 'cloud-reports.json');

const SEED_REPORTS: StoredCloudReport[] = [
  {
    id: 'rep-20261112-01',
    reportNumber: 'RO-88412-PRE',
    createdAtIso: '2026-11-12T09:18:00-08:00',
    scanType: 'Pre-Scan',
    vin: '1FTFW1ED6PFA48219',
    year: 2023,
    make: 'Ford',
    model: 'F-150 Lariat PowerBoost',
    engine: '3.5L EcoBoost Hybrid V6',
    odometerKm: 46820,
    protocol: 'ISO 15765-4 CAN FD (500k / 2M bps)',
    technicianBay: 'Bay 4 · Master Diag',
    batteryVoltage: 12.42,
    modulesScanned: 8,
    modulesWithFaults: 3,
    dtcs: [
      {
        code: 'P0304',
        moduleId: 'PCM',
        moduleName: 'Powertrain Control Module',
        status: 'Confirmed',
        description: 'Cylinder 4 Misfire Detected under load transition',
        freezeFrameSummary: '2,480 rpm · 142 kPa MAP · 91 °C ECT · +9.4 % STFT1',
      },
      {
        code: 'P0012',
        moduleId: 'PCM',
        moduleName: 'Powertrain Control Module',
        status: 'Pending',
        description: 'Intake Camshaft Position Timing - Over-Retarded (Bank 1)',
        freezeFrameSummary: '1,820 rpm · Actual 18.5 °CA vs Target 26.0 °CA',
      },
      {
        code: 'U0155',
        moduleId: 'GWM',
        moduleName: 'Gateway Module A',
        status: 'History',
        description: 'Lost Communication With Instrument Panel Cluster Control Module',
      },
      {
        code: 'B10D7:94',
        moduleId: 'BCM',
        moduleName: 'Body Control / PATS Immobilizer',
        status: 'Pending',
        description: 'PATS Key Transponder Slot #3 Unexpected Component Operation',
      },
    ],
    calibrationsApplied: [],
    keysProgrammedCount: 2,
    notes: 'Customer states intermittent rough idle warm and spare smart fob fails start authorization. Initial full-network pre-scan captured prior to coil/injector balance and VCT solenoid actuation.',
    telemetrySnapshot: [
      { pid: '010C', label: 'Engine speed', value: 684, unit: 'rpm' },
      { pid: '0105', label: 'Coolant temp', value: 89, unit: '°C' },
      { pid: '0106', label: 'Short fuel trim B1', value: 6.2, unit: '%' },
      { pid: '0142', label: 'Control module voltage', value: 14.18, unit: 'V' },
    ],
  },
  {
    id: 'rep-20261111-04',
    reportNumber: 'RO-88397-POST',
    createdAtIso: '2026-11-11T16:42:00-08:00',
    scanType: 'Post-Scan',
    vin: '3MW5R7J04M8B91402',
    year: 2021,
    make: 'BMW',
    model: '330i xDrive (G20)',
    engine: '2.0L TwinPower Turbo B46D',
    odometerKm: 61390,
    protocol: 'DoIP ISO 13400 / HS-CAN 500 kbps',
    technicianBay: 'Bay 2 · Euro Programming',
    batteryVoltage: 13.84,
    modulesScanned: 7,
    modulesWithFaults: 0,
    dtcs: [],
    calibrationsApplied: ['DME-8694512-04 (I-Step S18A-26-07-530)'],
    keysProgrammedCount: 2,
    notes: 'Completed J2534/DoIP DME calibration update for cold-start wastegate rattle TSB, reset Valvetronic end-stops, cleared all shadow fault memory, and verified zero faults on road test.',
    telemetrySnapshot: [
      { pid: '010C', label: 'Engine speed', value: 710, unit: 'rpm' },
      { pid: '0105', label: 'Coolant temp', value: 96, unit: '°C' },
      { pid: '010B', label: 'Intake manifold pressure', value: 36, unit: 'kPa' },
      { pid: '0142', label: 'Control module voltage', value: 14.42, unit: 'V' },
    ],
  },
  {
    id: 'rep-20261110-09',
    reportNumber: 'RO-88365-PRE',
    createdAtIso: '2026-11-10T11:05:00-08:00',
    scanType: 'Pre-Scan',
    vin: '3MW5R7J04M8B91402',
    year: 2021,
    make: 'BMW',
    model: '330i xDrive (G20)',
    engine: '2.0L TwinPower Turbo B46D',
    odometerKm: 61378,
    protocol: 'DoIP ISO 13400 / HS-CAN 500 kbps',
    technicianBay: 'Bay 2 · Euro Programming',
    batteryVoltage: 12.56,
    modulesScanned: 7,
    modulesWithFaults: 1,
    dtcs: [
      {
        code: 'P12A9',
        moduleId: 'DME',
        moduleName: 'Digital Motor Electronics',
        status: 'Confirmed',
        description: 'Boost Pressure Control Wastegate Actuator Position Drift Cold Start',
        freezeFrameSummary: '1,240 rpm · 18 °C ECT · 101 kPa BARO',
      },
    ],
    calibrationsApplied: [],
    keysProgrammedCount: 2,
    notes: 'Pre-programming baseline report before applying I-Step S18A-26-07-530 DME software update.',
    telemetrySnapshot: [
      { pid: '010C', label: 'Engine speed', value: 1120, unit: 'rpm' },
      { pid: '0105', label: 'Coolant temp', value: 24, unit: '°C' },
      { pid: '010B', label: 'Intake manifold pressure', value: 48, unit: 'kPa' },
      { pid: '0142', label: 'Control module voltage', value: 14.35, unit: 'V' },
    ],
  },
  {
    id: 'rep-20261109-02',
    reportNumber: 'RO-88319-KEY',
    createdAtIso: '2026-11-09T14:22:00-08:00',
    scanType: 'Immobilizer Audit',
    vin: '5TFCZ5AN8LX219084',
    year: 2020,
    make: 'Toyota',
    model: 'Tacoma TRD Off-Road',
    engine: '3.5L V6 2GR-FKS',
    odometerKm: 84215,
    protocol: 'ISO 15765-4 CAN 11-bit 500 kbps',
    technicianBay: 'Bay 1 · Locksmith & Elec',
    batteryVoltage: 13.45,
    modulesScanned: 6,
    modulesWithFaults: 0,
    dtcs: [],
    calibrationsApplied: ['89663-04B73-A0 (2GR-FKS Shift Logic Calibration)'],
    keysProgrammedCount: 3,
    notes: 'Registered additional OEM HYQ14FBB DST-AES 128-bit smart fob into Certification ECU slot #3 and flashed updated transmission shift calibration.',
    telemetrySnapshot: [
      { pid: '010C', label: 'Engine speed', value: 650, unit: 'rpm' },
      { pid: '0105', label: 'Coolant temp', value: 86, unit: '°C' },
      { pid: '0142', label: 'Control module voltage', value: 13.92, unit: 'V' },
    ],
  },
];

function readReports(): StoredCloudReport[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(REPORTS_FILE)) {
      fs.writeFileSync(REPORTS_FILE, JSON.stringify(SEED_REPORTS, null, 2), 'utf8');
      return structuredClone(SEED_REPORTS);
    }
    const raw = fs.readFileSync(REPORTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return structuredClone(SEED_REPORTS);
    }
    return parsed as StoredCloudReport[];
  } catch {
    return structuredClone(SEED_REPORTS);
  }
}

function writeReports(reports: StoredCloudReport[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2), 'utf8');
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'torquelink-cloud-archive', timestamp: new Date().toISOString() });
  });

  app.get('/api/dtc-analysis', (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    const make = typeof req.query.make === 'string' ? req.query.make.trim() : 'Ford';
    const model = typeof req.query.model === 'string' ? req.query.model.trim() : 'F-150';
    const year = Number(req.query.year) || 2023;

    if (!code) {
      res.status(400).json({ error: 'Query parameter "code" (e.g. P0304) is required.' });
      return;
    }

    const analysis = analyzeDtcForVehicle(code, make, model, year);
    res.json({ analysis });
  });

  app.get('/api/module-library/lookup', (req: Request, res: Response) => {
    const vin = typeof req.query.vin === 'string' ? req.query.vin.trim() : '';
    const make = typeof req.query.make === 'string' ? req.query.make.trim() : '';
    const model = typeof req.query.model === 'string' ? req.query.model.trim() : '';
    const year = req.query.year ? Number(req.query.year) : undefined;

    const result = lookupModuleLibrary({ vin, make, model, year });
    res.json(result);
  });

  app.get('/api/lemon/resolve', async (req: Request, res: Response) => {
    const make = typeof req.query.make === 'string' ? req.query.make.trim() : 'Ford';
    const model = typeof req.query.model === 'string' ? req.query.model.trim() : 'F-150';
    const year = Number(req.query.year) || 2023;
    const result = await resolveLiveLemonManual(make, model, year);
    res.json(result);
  });

  app.get('/api/reports', (req: Request, res: Response) => {
    const reports = readReports();
    const vinFilter = typeof req.query.vin === 'string' ? req.query.vin.trim().toUpperCase() : '';
    const filtered = vinFilter
      ? reports.filter((r) => r.vin.toUpperCase().includes(vinFilter))
      : reports;
    filtered.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
    res.json({ reports: filtered });
  });

  app.post('/api/reports', (req: Request, res: Response) => {
    const body = req.body as Partial<StoredCloudReport>;
    if (!body || typeof body.vin !== 'string' || typeof body.make !== 'string') {
      res.status(400).json({ error: 'Report payload requires valid VIN and vehicle metadata.' });
      return;
    }

    const reports = readReports();
    const newReport: StoredCloudReport = {
      id: body.id || `rep-${Date.now()}`,
      reportNumber:
        body.reportNumber ||
        `RO-${Math.floor(88420 + reports.length * 3)}-${(body.scanType || 'SCAN').slice(0, 4).toUpperCase()}`,
      createdAtIso: body.createdAtIso || new Date().toISOString(),
      scanType: body.scanType || 'Pre-Scan',
      vin: body.vin,
      year: Number(body.year) || 2023,
      make: body.make,
      model: body.model || 'Unknown Model',
      engine: body.engine || 'Standard Powertrain',
      odometerKm: Number(body.odometerKm) || 0,
      protocol: body.protocol || 'ISO 15765-4 CAN',
      technicianBay: body.technicianBay || 'Bay 4 · Master Diag',
      batteryVoltage: Number(body.batteryVoltage) || 12.6,
      modulesScanned: Number(body.modulesScanned) || 1,
      modulesWithFaults: Number(body.modulesWithFaults) || 0,
      dtcs: Array.isArray(body.dtcs) ? body.dtcs : [],
      calibrationsApplied: Array.isArray(body.calibrationsApplied) ? body.calibrationsApplied : [],
      keysProgrammedCount: Number(body.keysProgrammedCount) || 0,
      notes: typeof body.notes === 'string' ? body.notes : '',
      telemetrySnapshot: Array.isArray(body.telemetrySnapshot) ? body.telemetrySnapshot : [],
    };

    const next = [newReport, ...reports.filter((r) => r.id !== newReport.id)];
    writeReports(next);
    res.status(201).json({ report: newReport });
  });

  app.delete('/api/reports/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    const reports = readReports();
    const next = reports.filter((r) => r.id !== id);
    writeReports(next);
    res.json({ deletedId: id, count: next.length });
  });

  app.post('/api/reports/reset', (_req: Request, res: Response) => {
    const fresh = structuredClone(SEED_REPORTS);
    writeReports(fresh);
    res.json({ reports: fresh });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TorqueLink J2534 workstation listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
