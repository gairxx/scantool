import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Globe, RotateCcw } from 'lucide-react';
import { Button, SelectField, Surface } from './ui';
import { LemonManualEmbed } from './LemonManualEmbed';
import { VEHICLE_PROFILES } from '../data/vehicles';
import { LEMON_BASE_URL } from '../lib/lemonManual';
import type { LemonManualSection, VehicleProfile } from '../types/diagnostic';

interface RepairManualViewProps {
  activeVehicle: VehicleProfile;
  initialSection?: LemonManualSection['id'];
  forcedUrl?: string | null;
  forcedNonce?: number;
}

export const RepairManualView: React.FC<RepairManualViewProps> = ({
  activeVehicle,
  initialSection = 'repair',
  forcedUrl = null,
  forcedNonce = 0,
}) => {
  const [manualMake, setManualMake] = useState<string>(activeVehicle.make);
  const [manualModel, setManualModel] = useState<string>(activeVehicle.model);
  const [manualYear, setManualYear] = useState<number>(activeVehicle.year);
  const [customUrl, setCustomUrl] = useState<string | null>(forcedUrl);
  const [customNonce, setCustomNonce] = useState<number>(forcedNonce);
  const [section, setSection] = useState<LemonManualSection['id']>(initialSection);

  useEffect(() => {
    setManualMake(activeVehicle.make);
    setManualModel(activeVehicle.model);
    setManualYear(activeVehicle.year);
  }, [activeVehicle.id, activeVehicle.make, activeVehicle.model, activeVehicle.year]);

  useEffect(() => {
    if (forcedUrl) {
      setCustomUrl(forcedUrl);
      setCustomNonce(forcedNonce);
    }
    setSection(initialSection);
  }, [forcedUrl, forcedNonce, initialSection]);

  const uniqueMakes = useMemo(
    () => Array.from(new Set(VEHICLE_PROFILES.map((v) => v.make))),
    []
  );
  const modelsForMake = useMemo(
    () => VEHICLE_PROFILES.filter((v) => v.make === manualMake),
    [manualMake]
  );

  const handleSyncActive = () => {
    setManualMake(activeVehicle.make);
    setManualModel(activeVehicle.model);
    setManualYear(activeVehicle.year);
    setCustomUrl(null);
    setSection('repair');
    setCustomNonce((n) => n + 1);
  };

  const handleBrowseAll = () => {
    setCustomUrl(`${LEMON_BASE_URL}/`);
    setSection('home');
    setCustomNonce((n) => n + 1);
  };

  return (
    <div className="space-y-4">
      <Surface className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
              <h1 className="text-display text-foreground">
                OEM repair manuals (lemon.dogeware.me)
              </h1>
            </div>
            <p className="text-sm text-muted">
              Live embedded workshop repair documentation, DTC index charts, Technical Service Bulletins, wiring diagrams, and component locations sourced from{' '}
              <span className="font-mono text-foreground">{LEMON_BASE_URL}</span>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" tone="quiet" onClick={handleSyncActive}>
              <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Sync active vehicle</span>
            </Button>
            <Button size="sm" onClick={handleBrowseAll}>
              <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Browse full Lemon index</span>
            </Button>
          </div>
        </div>

        <div className="pt-3 border-t border-border/40 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <SelectField
            id="manual-year-select"
            label="Model year"
            value={String(manualYear)}
            onChange={(e) => {
              setManualYear(Number(e.target.value));
              setCustomUrl(null);
            }}
            className="sm:col-span-2"
          >
            {[2024, 2023, 2022, 2021, 2020, 2019, 2018, 2016].map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </SelectField>

          <SelectField
            id="manual-make-select"
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
              setCustomUrl(null);
            }}
            className="sm:col-span-3"
          >
            {uniqueMakes.map((mk) => (
              <option key={mk} value={mk}>
                {mk}
              </option>
            ))}
          </SelectField>

          <SelectField
            id="manual-model-select"
            label="Vehicle platform"
            value={manualModel}
            onChange={(e) => {
              setManualModel(e.target.value);
              setCustomUrl(null);
            }}
            className="sm:col-span-7"
          >
            {modelsForMake.map((v) => (
              <option key={v.id} value={v.model}>
                {v.model} ({v.trimEngine})
              </option>
            ))}
          </SelectField>
        </div>
      </Surface>

      <Surface className="p-4 sm:p-5">
        <LemonManualEmbed
          make={manualMake}
          model={manualModel}
          year={manualYear}
          initialSection={section}
          forcedUrl={customUrl}
          forcedNonce={customNonce}
          title={`${manualYear} ${manualMake} ${manualModel} — Workshop Manual`}
          heightClassName="h-[calc(100dvh-310px)] min-h-[620px]"
        />
      </Surface>
    </div>
  );
};
