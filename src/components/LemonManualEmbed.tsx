import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BookOpen, ExternalLink, RotateCcw } from 'lucide-react';
import { Button, StatusMark, Surface } from './ui';
import { buildFallbackLemonResolve } from '../lib/lemonManual';
import type { LemonManualSection, LemonResolveResult } from '../types/diagnostic';

interface LemonManualEmbedProps {
  make: string;
  model: string;
  year: number;
  initialSection?: LemonManualSection['id'];
  forcedUrl?: string | null;
  forcedNonce?: number;
  title?: string;
  subtitle?: string;
  heightClassName?: string;
}

export const LemonManualEmbed: React.FC<LemonManualEmbedProps> = ({
  make,
  model,
  year,
  initialSection = 'repair',
  forcedUrl = null,
  forcedNonce = 0,
  title = 'Embedded OEM repair manual (lemon.dogeware.me)',
  subtitle,
  heightClassName = 'h-[620px]',
}) => {
  const quickSelectId = useId();
  const [resolved, setResolved] = useState<LemonResolveResult>(() =>
    buildFallbackLemonResolve(make, model, year)
  );
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [selectedSectionId, setSelectedSectionId] =
    useState<LemonManualSection['id']>(initialSection);
  const [activeUrl, setActiveUrl] = useState<string>(() => {
    const initial = buildFallbackLemonResolve(make, model, year);
    return (
      forcedUrl ||
      initial.sections.find((s) => s.id === initialSection)?.url ||
      initial.repairUrl
    );
  });
  const [iframeKey, setIframeKey] = useState<number>(1);
  const forcedUrlRef = useRef<string | null>(forcedUrl);
  forcedUrlRef.current = forcedUrl;

  useEffect(() => {
    setSelectedSectionId(initialSection);
  }, [initialSection]);

  useEffect(() => {
    let cancelled = false;
    const fallback = buildFallbackLemonResolve(make, model, year);
    setResolved(fallback);

    const fallbackSectionUrl =
      fallback.sections.find((s) => s.id === initialSection)?.url || fallback.repairUrl;
    if (!forcedUrlRef.current) {
      setActiveUrl(fallbackSectionUrl);
      setIframeKey((k) => k + 1);
    }

    const fetchLiveResolve = async () => {
      setIsResolving(true);
      try {
        const qs = new URLSearchParams({
          make,
          model,
          year: String(year),
        });
        const res = await fetch(`/api/lemon/resolve?${qs.toString()}`);
        if (!res.ok) throw new Error('Lemon resolve HTTP error');
        const data = (await res.json()) as LemonResolveResult;
        if (cancelled) return;
        setResolved(data);
        if (!forcedUrlRef.current) {
          const targetSection =
            data.sections.find((s) => s.id === initialSection)?.url || data.repairUrl;
          setActiveUrl(targetSection);
          setIframeKey((k) => k + 1);
        }
      } catch {
        // Keep deterministic verified fallback URLs
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    };

    void fetchLiveResolve();
    return () => {
      cancelled = true;
    };
  }, [make, model, year, initialSection]);

  useEffect(() => {
    if (forcedUrl) {
      setActiveUrl(forcedUrl);
      setIframeKey((k) => k + 1);
    }
  }, [forcedUrl, forcedNonce]);

  const quickSelectValue = useMemo(() => {
    const match = resolved.allQuickLinks.find((q) => q.url === activeUrl);
    return match ? match.url : '';
  }, [resolved.allQuickLinks, activeUrl]);

  const handleSelectSection = (sec: LemonManualSection) => {
    setSelectedSectionId(sec.id);
    setActiveUrl(sec.url);
    setIframeKey((k) => k + 1);
  };

  const handleQuickLinkChange = (url: string) => {
    if (!url) return;
    setActiveUrl(url);
    setIframeKey((k) => k + 1);
  };

  const handleReloadFrame = () => {
    setIframeKey((k) => k + 1);
  };

  return (
    <div className="space-y-3">
      {/* Header & Source Metadata */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <BookOpen className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <StatusMark
              kind={resolved.source === 'live-lemon-mirror' ? 'nominal' : 'neutral'}
              label={
                isResolving
                  ? 'Resolving manual…'
                  : resolved.source === 'live-lemon-mirror'
                    ? 'Live mirror'
                    : 'Verified path'
              }
            />
          </div>
          <p className="text-xs text-muted">
            {subtitle ||
              `Resolved directory: ${resolved.vehicleLabel} · Click any manual folder or diagram link inside the viewer below.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" tone="quiet" onClick={handleReloadFrame}>
            <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Reload frame</span>
          </Button>
          <a
            href={activeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-border/55 bg-surface px-3 text-sm font-medium text-foreground hover:bg-background whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span>Open in new tab</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Section Navigation & Live Quick Lookups */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between border-t border-border/40 pt-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Lemon repair manual sections"
        >
          {resolved.sections.map((sec) => {
            const isActive =
              activeUrl === sec.url ||
              (selectedSectionId === sec.id &&
                !resolved.sections.some((other) => other.id !== sec.id && other.url === activeUrl));
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => handleSelectSection(sec)}
                className={`min-h-9 px-3 rounded-control text-xs font-medium border whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-surface text-foreground border-border/55 hover:bg-background'
                }`}
              >
                {sec.label}
              </button>
            );
          })}
        </div>

        {resolved.allQuickLinks.length > 0 && (
          <div className="flex items-center gap-2 min-w-0">
            <label
              htmlFor={quickSelectId}
              className="text-xs font-medium text-muted whitespace-nowrap"
            >
              Quick index:
            </label>
            <select
              id={quickSelectId}
              value={quickSelectValue}
              onChange={(e) => handleQuickLinkChange(e.target.value)}
              className="min-h-9 max-w-full sm:w-64 rounded-control border border-border/55 bg-surface px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              <option value="">Jump to OEM manual folder…</option>
              {resolved.allQuickLinks.map((q) => (
                <option key={q.url} value={q.url}>
                  {q.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Active Source URL Readout */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="font-mono truncate" title={activeUrl}>
          Source: {activeUrl}
        </span>
      </div>

      {/* Embedded Repair Manual Frame inside Recessed Well */}
      <Surface inset className="p-1.5">
        <iframe
          key={`${iframeKey}-${activeUrl}`}
          src={activeUrl}
          title={`Repair manual viewer for ${year} ${make} ${model}`}
          className={`w-full ${heightClassName} border-0 rounded-control bg-white`}
          referrerPolicy="no-referrer"
        />
      </Surface>
    </div>
  );
};
