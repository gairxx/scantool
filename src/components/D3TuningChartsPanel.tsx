import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { SlidersHorizontal, TrendingUp } from 'lucide-react';
import { Button, StatusMark, Surface } from './ui';
import type { DynoPoint } from '../data/tuningMaps';
import type {
  TuningPresetSpec,
  TuningTableId,
  VehicleTuningProfile,
} from '../types/diagnostic';

interface D3TuningChartsPanelProps {
  stockProfile: VehicleTuningProfile;
  tuneProfile: VehicleTuningProfile;
  dynoPoints: DynoPoint[];
  peakStockHp: number;
  peakTunedHp: number;
  peakStockTq: number;
  peakTunedTq: number;
  liveRpm: number;
  liveMapKpa: number;
  displayAfrUnits: boolean;
  activePreset?: TuningPresetSpec;
  presetNonce?: number;
  onApplyQuickParameterOffsets: (offsets: {
    veHighLoadPct: number;
    lambdaHighLoadDelta: number;
    sparkHighLoadDeg: number;
    boostHighLoadKpa: number;
  }) => void;
  onSelectTableCell?: (tableId: TuningTableId, r: number, c: number) => void;
}

type VisualizerMapChoice = 'fuel_ve' | 'target_lambda' | 'spark_advance' | 'boost_target';

const MAP_OPTIONS: Array<{ id: VisualizerMapChoice; label: string }> = [
  { id: 'fuel_ve', label: 'Fuel VE (%)' },
  { id: 'target_lambda', label: 'Lambda / AFR' },
  { id: 'spark_advance', label: 'Spark advance (°)' },
  { id: 'boost_target', label: 'Boost / ETC target' },
];

export const D3TuningChartsPanel: React.FC<D3TuningChartsPanelProps> = ({
  stockProfile,
  tuneProfile,
  dynoPoints,
  peakStockHp,
  peakTunedHp,
  peakStockTq,
  peakTunedTq,
  liveRpm,
  liveMapKpa,
  displayAfrUnits,
  activePreset,
  presetNonce = 0,
  onApplyQuickParameterOffsets,
  onSelectTableCell,
}) => {
  const [chartMapId, setChartMapId] = useState<VisualizerMapChoice>('fuel_ve');
  const [selectedLoadRowIdx, setSelectedLoadRowIdx] = useState<number>(6);
  const [hoverDynoRpm, setHoverDynoRpm] = useState<number | null>(null);
  const [hoverHeatmapInfo, setHoverHeatmapInfo] = useState<{
    rpm: number;
    kpa: number;
    val: string;
    stockVal: string;
    delta: string;
  } | null>(null);

  // Quick interactive high-load parameter sliders
  const [veTrimPct, setVeTrimPct] = useState<number>(0);
  const [lambdaTrim, setLambdaTrim] = useState<number>(0);
  const [sparkTrimDeg, setSparkTrimDeg] = useState<number>(0);
  const [boostTrimKpa, setBoostTrimKpa] = useState<number>(0);

  // Sync slider thumbs when vehicle or preset changes
  useEffect(() => {
    setVeTrimPct(activePreset?.veMultiplierPct ?? 0);
    setLambdaTrim(activePreset?.lambdaBoostOffset ?? 0);
    setSparkTrimDeg(activePreset?.sparkOffsetHighLoad ?? 0);
    setBoostTrimKpa(activePreset?.boostKpaDelta ?? 0);
    setSelectedLoadRowIdx(Math.max(0, stockProfile.tables.fuel_ve.yBreakpoints.length - 2));
  }, [
    stockProfile.vehicleId,
    stockProfile.tables.fuel_ve.yBreakpoints.length,
    presetNonce,
    activePreset,
  ]);

  const heatmapSvgRef = useRef<SVGSVGElement | null>(null);
  const sliceSvgRef = useRef<SVGSVGElement | null>(null);
  const dynoSvgRef = useRef<SVGSVGElement | null>(null);

  const stoichAfr =
    tuneProfile.scalars.find((s) => s.id === 'stoich_afr')?.value ?? 14.68;
  const isTurbo = stockProfile.aspiration.includes('Turbo');

  const activeMap = tuneProfile.tables[chartMapId];
  const stockMap = stockProfile.tables[chartMapId];

  const safeRowIdx = Math.min(selectedLoadRowIdx, activeMap.yBreakpoints.length - 1);

  const formatVal = (val: number, mapId: VisualizerMapChoice, decimals: number) => {
    if (mapId === 'target_lambda' && displayAfrUnits) {
      return `${(val * stoichAfr).toFixed(2)} AFR`;
    }
    const suffix =
      mapId === 'fuel_ve'
        ? '% VE'
        : mapId === 'target_lambda'
          ? ' λ'
          : mapId === 'spark_advance'
            ? '°'
            : isTurbo
              ? ' kPa'
              : '%';
    return `${val.toFixed(decimals)}${suffix}`;
  };

  // 1. D3 Calibration Map Heatmap & Contour Surface
  useEffect(() => {
    const svgEl = heatmapSvgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 620;
    const height = 290;
    const margin = { top: 22, right: 24, bottom: 42, left: 66 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xCols = activeMap.xBreakpoints.map(String);
    const yRows = activeMap.yBreakpoints.map(String);

    const xScale = d3.scaleBand<string>().domain(xCols).range([0, innerW]).padding(0.06);
    const yScale = d3
      .scaleBand<string>()
      .domain([...yRows].reverse())
      .range([0, innerH])
      .padding(0.06);

    const flatVals = activeMap.values.flat();
    const minVal = d3.min(flatVals) ?? 0;
    const maxVal = d3.max(flatVals) ?? 100;

    // Color scale tuned for crisp dark-ink readability
    const colorScale =
      chartMapId === 'target_lambda'
        ? d3.scaleLinear<string>().domain([minVal, (minVal + maxVal) / 2, maxVal]).range(['#FECACA', '#FEF3C7', '#CCFBF1'])
        : chartMapId === 'spark_advance'
          ? d3.scaleLinear<string>().domain([minVal, (minVal + maxVal) / 2, maxVal]).range(['#DBEAFE', '#D1FAE5', '#FDE68A'])
          : d3.scaleLinear<string>().domain([minVal, (minVal + maxVal) / 2, maxVal]).range(['#E0F2FE', '#D1FAE5', '#FECACA']);

    const cells: Array<{ r: number; c: number; x: string; y: string; val: number; stock: number }> = [];
    for (let r = 0; r < activeMap.yBreakpoints.length; r++) {
      for (let c = 0; c < activeMap.xBreakpoints.length; c++) {
        cells.push({
          r,
          c,
          x: String(activeMap.xBreakpoints[c]),
          y: String(activeMap.yBreakpoints[r]),
          val: activeMap.values[r][c],
          stock: stockMap.values[r][c],
        });
      }
    }

    const cellGroups = g
      .selectAll('g.heat-cell')
      .data(cells)
      .enter()
      .append('g')
      .attr('class', 'heat-cell')
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => {
        const diff = d.val - d.stock;
        const diffDisplay =
          chartMapId === 'target_lambda' && displayAfrUnits
            ? `${diff >= 0 ? '+' : ''}${(diff * stoichAfr).toFixed(2)}`
            : `${diff >= 0 ? '+' : ''}${diff.toFixed(activeMap.decimals)}`;
        setHoverHeatmapInfo({
          rpm: Number(d.x),
          kpa: Number(d.y),
          val: formatVal(d.val, chartMapId, activeMap.decimals),
          stockVal: formatVal(d.stock, chartMapId, activeMap.decimals),
          delta: diffDisplay,
        });
      })
      .on('click', (_event, d) => {
        setSelectedLoadRowIdx(d.r);
        onSelectTableCell?.(chartMapId, d.r, d.c);
      });

    cellGroups
      .append('rect')
      .attr('x', (d) => xScale(d.x) ?? 0)
      .attr('y', (d) => yScale(d.y) ?? 0)
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('rx', 3)
      .attr('fill', (d) => colorScale(d.val))
      .attr('stroke', (d) =>
        d.r === safeRowIdx ? 'var(--color-primary)' : 'rgba(15, 23, 42, 0.14)'
      )
      .attr('stroke-width', (d) => (d.r === safeRowIdx ? 1.8 : 0.75));

    cellGroups
      .append('text')
      .attr('x', (d) => (xScale(d.x) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', (d) => (yScale(d.y) ?? 0) + yScale.bandwidth() / 2 + 3.5)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'var(--font-mono)')
      .attr('font-size', '9.5px')
      .attr('font-weight', '600')
      .attr('fill', '#14181F')
      .text((d) =>
        chartMapId === 'target_lambda' && displayAfrUnits
          ? (d.val * stoichAfr).toFixed(1)
          : d.val.toFixed(chartMapId === 'target_lambda' ? 2 : activeMap.decimals)
      );

    // D3 Axes
    const xAxis = d3.axisBottom(xScale).tickSizeOuter(0);
    const yAxis = d3.axisLeft(yScale).tickFormat((v) => `${v} kPa`).tickSizeOuter(0);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call((ax) => ax.selectAll('text').attr('fill', 'var(--color-muted)').attr('font-size', '10px').attr('font-family', 'var(--font-mono)'))
      .call((ax) => ax.selectAll('path,line').attr('stroke', 'var(--color-border)'));

    g.append('g')
      .call(yAxis)
      .call((ax) => ax.selectAll('text').attr('fill', 'var(--color-muted)').attr('font-size', '10px').attr('font-family', 'var(--font-mono)'))
      .call((ax) => ax.selectAll('path,line').attr('stroke', 'var(--color-border)'));

    // X-axis label
    g.append('text')
      .attr('x', innerW / 2)
      .attr('y', innerH + 34)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10.5px')
      .attr('fill', 'var(--color-muted)')
      .text('Engine Speed (RPM) — Click any row to inspect load slice');

    // Live operating crosshair mapped into heatmap coordinates
    const xMin = activeMap.xBreakpoints[0];
    const xMax = activeMap.xBreakpoints[activeMap.xBreakpoints.length - 1];
    const yMin = activeMap.yBreakpoints[0];
    const yMax = activeMap.yBreakpoints[activeMap.yBreakpoints.length - 1];

    const cx =
      ((Math.min(xMax, Math.max(xMin, liveRpm)) - xMin) / Math.max(1, xMax - xMin)) *
      innerW;
    const cy =
      innerH -
      ((Math.min(yMax, Math.max(yMin, liveMapKpa)) - yMin) / Math.max(1, yMax - yMin)) *
        innerH;

    const tracer = g.append('g').style('pointer-events', 'none');
    tracer
      .append('line')
      .attr('x1', cx)
      .attr('y1', 0)
      .attr('x2', cx)
      .attr('y2', innerH)
      .attr('stroke', 'var(--color-primary)')
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '3 3');
    tracer
      .append('line')
      .attr('x1', 0)
      .attr('y1', cy)
      .attr('x2', innerW)
      .attr('y2', cy)
      .attr('stroke', 'var(--color-primary)')
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '3 3');
    tracer
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', 5.5)
      .attr('fill', 'var(--color-primary)')
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 1.8);
  }, [
    activeMap,
    stockMap,
    chartMapId,
    safeRowIdx,
    liveRpm,
    liveMapKpa,
    displayAfrUnits,
    stoichAfr,
    onSelectTableCell,
  ]);

  // 2. D3 Load-Slice Line Chart (Stock vs Tuned across RPM for selected MAP kPa row)
  useEffect(() => {
    const svgEl = sliceSvgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 560;
    const height = 290;
    const margin = { top: 22, right: 20, bottom: 42, left: 54 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const rpms = activeMap.xBreakpoints;
    const tunedSlice = activeMap.values[safeRowIdx] ?? [];
    const stockSlice = stockMap.values[safeRowIdx] ?? [];

    const toDisplay = (v: number) =>
      chartMapId === 'target_lambda' && displayAfrUnits ? v * stoichAfr : v;

    const dataPts = rpms.map((rpm, i) => ({
      rpm,
      stock: toDisplay(stockSlice[i] ?? 0),
      tuned: toDisplay(tunedSlice[i] ?? 0),
    }));

    const xScale = d3
      .scaleLinear()
      .domain([rpms[0], rpms[rpms.length - 1]])
      .range([0, innerW]);

    const allY = dataPts.flatMap((d) => [d.stock, d.tuned]);
    const yMin = (d3.min(allY) ?? 0) * 0.94;
    const yMax = (d3.max(allY) ?? 100) * 1.06;
    const yScale = d3.scaleLinear().domain([yMin, yMax]).nice().range([innerH, 0]);

    // Grid
    g.append('g')
      .selectAll('line')
      .data(yScale.ticks(5))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', 'var(--color-border)')
      .attr('stroke-opacity', 0.35)
      .attr('stroke-dasharray', '3 3');

    // Delta area between stock & tuned
    const areaGen = d3
      .area<(typeof dataPts)[number]>()
      .x((d) => xScale(d.rpm))
      .y0((d) => yScale(d.stock))
      .y1((d) => yScale(d.tuned))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(dataPts)
      .attr('d', areaGen)
      .attr('fill', 'var(--color-primary)')
      .attr('fill-opacity', 0.14);

    // Stock line (dashed)
    const stockLine = d3
      .line<(typeof dataPts)[number]>()
      .x((d) => xScale(d.rpm))
      .y((d) => yScale(d.stock))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(dataPts)
      .attr('d', stockLine)
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-muted)')
      .attr('stroke-width', 1.8)
      .attr('stroke-dasharray', '5 4');

    // Tuned line (solid)
    const tunedLine = d3
      .line<(typeof dataPts)[number]>()
      .x((d) => xScale(d.rpm))
      .y((d) => yScale(d.tuned))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(dataPts)
      .attr('d', tunedLine)
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-primary)')
      .attr('stroke-width', 2.5);

    // Data point dots
    g.selectAll('circle.tuned-dot')
      .data(dataPts)
      .enter()
      .append('circle')
      .attr('cx', (d) => xScale(d.rpm))
      .attr('cy', (d) => yScale(d.tuned))
      .attr('r', 3.4)
      .attr('fill', 'var(--color-primary)')
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 1);

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).ticks(6).tickFormat((d) => `${d}`))
      .call((ax) => ax.selectAll('text').attr('fill', 'var(--color-muted)').attr('font-size', '10px').attr('font-family', 'var(--font-mono)'))
      .call((ax) => ax.selectAll('path,line').attr('stroke', 'var(--color-border)'));

    g.append('g')
      .call(d3.axisLeft(yScale).ticks(5))
      .call((ax) => ax.selectAll('text').attr('fill', 'var(--color-muted)').attr('font-size', '10px').attr('font-family', 'var(--font-mono)'))
      .call((ax) => ax.selectAll('path,line').attr('stroke', 'var(--color-border)'));

    g.append('text')
      .attr('x', innerW / 2)
      .attr('y', innerH + 34)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10.5px')
      .attr('fill', 'var(--color-muted)')
      .text(
        `Load Slice @ ${activeMap.yBreakpoints[safeRowIdx]} kPa — Solid: Tuned · Dashed: Stock OEM`
      );
  }, [activeMap, stockMap, safeRowIdx, chartMapId, displayAfrUnits, stoichAfr]);

  // 3. D3 Dual-Axis Dyno Power, Torque & AFR Output Chart
  useEffect(() => {
    const svgEl = dynoSvgRef.current;
    if (!svgEl || dynoPoints.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 760;
    const height = 270;
    const margin = { top: 20, right: 54, bottom: 38, left: 52 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleLinear()
      .domain([dynoPoints[0].rpm, dynoPoints[dynoPoints.length - 1].rpm])
      .range([0, innerW]);

    const maxPowerTq =
      d3.max(dynoPoints, (d) => Math.max(d.stockHp, d.tunedHp, d.stockTqNm, d.tunedTqNm)) ??
      500;
    const yLeft = d3
      .scaleLinear()
      .domain([0, maxPowerTq * 1.12])
      .nice()
      .range([innerH, 0]);

    const yRight = d3.scaleLinear().domain([9.5, 16.0]).range([innerH, 0]);

    // Grid
    g.append('g')
      .selectAll('line')
      .data(yLeft.ticks(5))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yLeft(d))
      .attr('y2', (d) => yLeft(d))
      .attr('stroke', 'var(--color-border)')
      .attr('stroke-opacity', 0.35)
      .attr('stroke-dasharray', '3 3');

    // Shaded HP gain area between stockHp and tunedHp
    const hpGainArea = d3
      .area<DynoPoint>()
      .x((d) => xScale(d.rpm))
      .y0((d) => yLeft(d.stockHp))
      .y1((d) => yLeft(d.tunedHp))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(dynoPoints)
      .attr('d', hpGainArea)
      .attr('fill', 'var(--color-primary)')
      .attr('fill-opacity', 0.12);

    const makeLine = (getter: (d: DynoPoint) => number, scaleY: d3.ScaleLinear<number, number>) =>
      d3
        .line<DynoPoint>()
        .x((d) => xScale(d.rpm))
        .y((d) => scaleY(getter(d)))
        .curve(d3.curveMonotoneX);

    // Stock dashed curves
    g.append('path')
      .datum(dynoPoints)
      .attr('d', makeLine((d) => d.stockTqNm, yLeft))
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-muted)')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4');

    g.append('path')
      .datum(dynoPoints)
      .attr('d', makeLine((d) => d.stockHp, yLeft))
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-muted)')
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '2 3');

    // Tuned solid curves: Torque (Nominal green), HP (Primary blue), Target AFR (Advisory amber on right axis)
    g.append('path')
      .datum(dynoPoints)
      .attr('d', makeLine((d) => d.tunedTqNm, yLeft))
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-nominal)')
      .attr('stroke-width', 2.4);

    g.append('path')
      .datum(dynoPoints)
      .attr('d', makeLine((d) => d.tunedHp, yLeft))
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-primary)')
      .attr('stroke-width', 2.6);

    g.append('path')
      .datum(dynoPoints)
      .attr('d', makeLine((d) => d.tunedAfr, yRight))
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-advisory)')
      .attr('stroke-width', 1.8)
      .attr('stroke-dasharray', '6 2');

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).ticks(7).tickFormat((d) => `${d} rpm`))
      .call((ax) => ax.selectAll('text').attr('fill', 'var(--color-muted)').attr('font-size', '10px').attr('font-family', 'var(--font-mono)'))
      .call((ax) => ax.selectAll('path,line').attr('stroke', 'var(--color-border)'));

    g.append('g')
      .call(d3.axisLeft(yLeft).ticks(5))
      .call((ax) => ax.selectAll('text').attr('fill', 'var(--color-muted)').attr('font-size', '10px').attr('font-family', 'var(--font-mono)'))
      .call((ax) => ax.selectAll('path,line').attr('stroke', 'var(--color-border)'));

    g.append('g')
      .attr('transform', `translate(${innerW},0)`)
      .call(d3.axisRight(yRight).ticks(5).tickFormat((d) => `${Number(d).toFixed(1)}`))
      .call((ax) => ax.selectAll('text').attr('fill', 'var(--color-advisory)').attr('font-size', '10px').attr('font-family', 'var(--font-mono)'))
      .call((ax) => ax.selectAll('path,line').attr('stroke', 'var(--color-border)'));

    // Right axis title
    g.append('text')
      .attr('x', innerW + 38)
      .attr('y', innerH / 2)
      .attr('text-anchor', 'middle')
      .attr('transform', `rotate(90, ${innerW + 38}, ${innerH / 2})`)
      .attr('font-size', '10px')
      .attr('fill', 'var(--color-advisory)')
      .text('Target AFR (:1)');

    // Left axis title
    g.append('text')
      .attr('x', -38)
      .attr('y', innerH / 2)
      .attr('text-anchor', 'middle')
      .attr('transform', `rotate(-90, -38, ${innerH / 2})`)
      .attr('font-size', '10px')
      .attr('fill', 'var(--color-muted)')
      .text('Power (HP) / Torque (Nm)');

    // Hover crosshair overlay
    const bisectRpm = d3.bisector<DynoPoint, number>((d) => d.rpm).center;
    if (hoverDynoRpm !== null) {
      const idx = bisectRpm(dynoPoints, hoverDynoRpm);
      const pt = dynoPoints[idx];
      if (pt) {
        const px = xScale(pt.rpm);
        g.append('line')
          .attr('x1', px)
          .attr('x2', px)
          .attr('y1', 0)
          .attr('y2', innerH)
          .attr('stroke', 'var(--color-foreground)')
          .attr('stroke-opacity', 0.4)
          .attr('stroke-width', 1);
        g.append('circle')
          .attr('cx', px)
          .attr('cy', yLeft(pt.tunedHp))
          .attr('r', 4)
          .attr('fill', 'var(--color-primary)');
        g.append('circle')
          .attr('cx', px)
          .attr('cy', yLeft(pt.tunedTqNm))
          .attr('r', 4)
          .attr('fill', 'var(--color-nominal)');
      }
    }

    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const rpmAtMouse = xScale.invert(mx);
        setHoverDynoRpm(rpmAtMouse);
      })
      .on('mouseleave', () => setHoverDynoRpm(null));
  }, [dynoPoints, hoverDynoRpm]);

  const hoveredDynoPoint = useMemo(() => {
    if (hoverDynoRpm === null || dynoPoints.length === 0) return null;
    const bisect = d3.bisector<DynoPoint, number>((d) => d.rpm).center;
    return dynoPoints[bisect(dynoPoints, hoverDynoRpm)] || null;
  }, [hoverDynoRpm, dynoPoints]);

  const handleApplySliders = (next: {
    ve: number;
    lam: number;
    spk: number;
    bst: number;
  }) => {
    setVeTrimPct(next.ve);
    setLambdaTrim(next.lam);
    setSparkTrimDeg(next.spk);
    setBoostTrimKpa(next.bst);
    onApplyQuickParameterOffsets({
      veHighLoadPct: next.ve,
      lambdaHighLoadDelta: next.lam,
      sparkHighLoadDeg: next.spk,
      boostHighLoadKpa: next.bst,
    });
  };

  return (
    <Surface className="p-4 sm:p-5 space-y-5">
      {/* Header & Map Selector */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-border/40 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <TrendingUp className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
            <h2 className="text-title text-foreground">
              D3 calibration surface, parameter tuner &amp; dyno output visualizer
            </h2>
            <StatusMark kind="nominal" label="D3.js live sync" />
          </div>
          <p className="text-sm text-muted">
            Inspect Fuel VE, Target Lambda/AFR, Spark Advance, and Boost/ETC maps in D3, adjust high-load tuning parameters below, and observe live torque, horsepower, and AFR response.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="D3 calibration surface map selector">
          {MAP_OPTIONS.map((opt) => {
            const active = chartMapId === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setChartMapId(opt.id)}
                className={`min-h-9 px-3 rounded-control text-xs font-medium border whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-surface text-foreground border-border/55 hover:bg-background'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Interactive High-Load Parameter Adjustment Sliders */}
      <div className="space-y-3 border-b border-border/40 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <SlidersHorizontal className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
            <span>Interactive high-load tuning trims (updates tables &amp; D3 output live)</span>
          </div>
          <Button
            size="sm"
            tone="quiet"
            onClick={() => handleApplySliders({ ve: 0, lam: 0, spk: 0, bst: 0 })}
          >
            Zero trim sliders
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="d3-ve-trim" className="font-medium text-foreground">
                Fuel VE trim (high load)
              </label>
              <span className="font-mono font-semibold text-primary">
                {veTrimPct >= 0 ? `+${veTrimPct.toFixed(1)}%` : `${veTrimPct.toFixed(1)}%`}
              </span>
            </div>
            <input
              id="d3-ve-trim"
              type="range"
              min={-15}
              max={30}
              step={0.5}
              value={veTrimPct}
              onChange={(e) =>
                handleApplySliders({
                  ve: Number(e.target.value),
                  lam: lambdaTrim,
                  spk: sparkTrimDeg,
                  bst: boostTrimKpa,
                })
              }
              className="w-full accent-primary"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="d3-lambda-trim" className="font-medium text-foreground">
                Target Lambda / AFR trim
              </label>
              <span className="font-mono font-semibold text-primary">
                {lambdaTrim >= 0 ? `+${lambdaTrim.toFixed(3)} λ` : `${lambdaTrim.toFixed(3)} λ`}
              </span>
            </div>
            <input
              id="d3-lambda-trim"
              type="range"
              min={-0.08}
              max={0.06}
              step={0.005}
              value={lambdaTrim}
              onChange={(e) =>
                handleApplySliders({
                  ve: veTrimPct,
                  lam: Number(e.target.value),
                  spk: sparkTrimDeg,
                  bst: boostTrimKpa,
                })
              }
              className="w-full accent-primary"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="d3-spark-trim" className="font-medium text-foreground">
                Spark advance trim (WOT)
              </label>
              <span className="font-mono font-semibold text-primary">
                {sparkTrimDeg >= 0 ? `+${sparkTrimDeg.toFixed(1)}°` : `${sparkTrimDeg.toFixed(1)}°`}
              </span>
            </div>
            <input
              id="d3-spark-trim"
              type="range"
              min={-5}
              max={6}
              step={0.5}
              value={sparkTrimDeg}
              onChange={(e) =>
                handleApplySliders({
                  ve: veTrimPct,
                  lam: lambdaTrim,
                  spk: Number(e.target.value),
                  bst: boostTrimKpa,
                })
              }
              className="w-full accent-primary"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="d3-boost-trim" className="font-medium text-foreground">
                {isTurbo ? 'Boost target delta' : 'ETC throttle ramp delta'}
              </label>
              <span className="font-mono font-semibold text-primary">
                {boostTrimKpa >= 0 ? `+${boostTrimKpa}` : boostTrimKpa}{' '}
                {isTurbo ? 'kPa' : '%'}
              </span>
            </div>
            <input
              id="d3-boost-trim"
              type="range"
              min={-20}
              max={isTurbo ? 45 : 15}
              step={1}
              value={boostTrimKpa}
              onChange={(e) =>
                handleApplySliders({
                  ve: veTrimPct,
                  lam: lambdaTrim,
                  spk: sparkTrimDeg,
                  bst: Number(e.target.value),
                })
              }
              className="w-full accent-primary"
            />
          </div>
        </div>
      </div>

      {/* Top D3 Row: 2D Calibration Surface Heatmap + Load-Slice Curve */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-7 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-foreground">{activeMap.name}</span>
            <span className="font-mono text-muted">
              {hoverHeatmapInfo
                ? `${hoverHeatmapInfo.rpm} rpm · ${hoverHeatmapInfo.kpa} kPa → ${hoverHeatmapInfo.val} (Stock ${hoverHeatmapInfo.stockVal}, Δ ${hoverHeatmapInfo.delta})`
                : `Live trace: ${Math.round(liveRpm)} rpm · ${Math.round(liveMapKpa)} kPa`}
            </span>
          </div>
          <Surface inset className="p-2">
            <svg
              ref={heatmapSvgRef}
              className="w-full h-auto"
              role="img"
              aria-label={`D3 heatmap visualization for ${activeMap.name}`}
            />
          </Surface>
        </div>

        <div className="xl:col-span-5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-foreground">
              RPM curve @ {activeMap.yBreakpoints[safeRowIdx]} kPa load
            </span>
            <div className="flex items-center gap-1.5">
              <label htmlFor="d3-load-row-select" className="text-muted">
                Load row:
              </label>
              <select
                id="d3-load-row-select"
                value={safeRowIdx}
                onChange={(e) => setSelectedLoadRowIdx(Number(e.target.value))}
                className="min-h-7 rounded-control border border-border/55 bg-surface px-2 font-mono text-xs text-foreground"
              >
                {activeMap.yBreakpoints.map((kpa, idx) => (
                  <option key={kpa} value={idx}>
                    {kpa} kPa
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Surface inset className="p-2">
            <svg
              ref={sliceSvgRef}
              className="w-full h-auto"
              role="img"
              aria-label={`D3 RPM slice line chart for ${activeMap.name}`}
            />
          </Surface>
        </div>
      </div>

      {/* Bottom D3 Chart: Dual-Axis Dyno Power, Torque & AFR Output */}
      <div className="space-y-2 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-sm text-foreground">
              D3 dyno horsepower, torque &amp; target AFR output
            </span>
            <span className="font-mono text-primary font-semibold">
              Peak: {peakTunedHp} hp ({peakTunedHp - peakStockHp >= 0 ? `+${peakTunedHp - peakStockHp}` : peakTunedHp - peakStockHp}) ·{' '}
              {peakTunedTq} Nm ({peakTunedTq - peakStockTq >= 0 ? `+${peakTunedTq - peakStockTq}` : peakTunedTq - peakStockTq})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono">
            {hoveredDynoPoint ? (
              <span className="text-foreground">
                @ {hoveredDynoPoint.rpm} rpm: {hoveredDynoPoint.tunedHp} hp (stock{' '}
                {hoveredDynoPoint.stockHp}) · {hoveredDynoPoint.tunedTqNm} Nm ·{' '}
                {hoveredDynoPoint.tunedAfr}:1 AFR
              </span>
            ) : (
              <>
                <span className="text-primary">— Tuned HP</span>
                <span className="text-nominal">— Tuned Nm</span>
                <span className="text-advisory">-- Target AFR</span>
                <span className="text-muted">--- Stock OEM</span>
              </>
            )}
          </div>
        </div>

        <Surface inset className="p-2">
          <svg
            ref={dynoSvgRef}
            className="w-full h-auto"
            role="img"
            aria-label="D3 dual-axis dyno horsepower, torque, and air-fuel ratio output chart"
          />
        </Surface>
      </div>
    </Surface>
  );
};
