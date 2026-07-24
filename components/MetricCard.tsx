"use client";

import { useMemo, useRef, useState } from "react";
import styles from "./MetricCard.module.css";
import InsightCard, { Insight } from "./InsightCard";
import {
  Aggregation,
  NormalizedPoint,
  SeriesPoint,
  aggregateSeries,
  formatAxisLabel,
  formatFullDate,
  formatTooltipLabel,
  pickLabelIndices,
  resolvePointerIndex,
  sampleAt,
  useAnimatedSeries,
} from "@/lib/chart-math";

export type DailyPoint = { date: string; views: number };
export type { Aggregation, Insight };
export { formatFullDate };

export type MetricConfig = {
  key: string;
  title: string;
  totalValue: number;
  percentChange: number;
  daily: DailyPoint[];
  insights: Insight[];
};

const ANIMATION_DURATION = 500;
const SAMPLE_COUNT = 40;
const MAX_LABELS = 6;

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const CHART_PADDING_X = 8;
const CHART_PADDING_Y = 12;
const Y_TICK_COUNT = 5;

// "Nice numbers" tick algorithm (Heckbert): rounds the domain out to clean,
// evenly spaced steps instead of splitting the raw min/max.
function niceNumber(range: number, round: boolean): number {
  if (range === 0) return 0;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

function getNiceTicks(rawMin: number, rawMax: number, tickCount: number): number[] {
  let min = rawMin;
  let max = rawMax;
  if (min === max) {
    min = min === 0 ? 0 : min - 1;
    max = max === 0 ? 1 : max + 1;
  }

  const step = niceNumber(niceNumber(max - min, false) / (tickCount - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    const rounded = Math.round(v);
    if (ticks.length === 0 || ticks[ticks.length - 1] !== rounded) {
      ticks.push(rounded);
    }
  }
  return ticks;
}

type Domain = { min: number; max: number };

function domainFromValues(values: number[]): Domain {
  const ticks = getNiceTicks(
    values.length ? Math.min(...values) : 0,
    values.length ? Math.max(...values) : 1,
    Y_TICK_COUNT
  );
  return { min: ticks[0], max: ticks[ticks.length - 1] };
}

type LineChartProps = {
  points: NormalizedPoint[];
  dataPoints: SeriesPoint[];
  aggregation: Aggregation;
  yDomainMin: number;
  yDomainMax: number;
  yTicks: number[];
};

function LineChart({
  points,
  dataPoints,
  aggregation,
  yDomainMin,
  yDomainMax,
  yTicks,
}: LineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tooltipScreenPos, setTooltipScreenPos] = useState({ left: 0, top: 0 });
  const lastHoverIndexRef = useRef<number | null>(null);

  if (points.length === 0) {
    return null;
  }

  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const paddingX = CHART_PADDING_X;
  const paddingY = CHART_PADDING_Y;
  const domainRange = yDomainMax - yDomainMin || 1;

  function yFor(value: number): number {
    return (
      height - paddingY - ((value - yDomainMin) / domainRange) * (height - paddingY * 2)
    );
  }

  const linePoints = points
    .map((p) => {
      const x = paddingX + p.t * (width - paddingX * 2);
      return `${x.toFixed(1)},${yFor(p.value).toFixed(1)}`;
    })
    .join(" ");

  const areaPoints = `${paddingX},${height - paddingY} ${linePoints} ${
    width - paddingX
  },${height - paddingY}`;

  const n = dataPoints.length;

  function handlePointerActivity(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const { idx } = resolvePointerIndex({
      clientX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
      viewBoxWidth: width,
      paddingX,
      pointCount: n,
    });

    const tExactForIdx = n > 1 ? idx / (n - 1) : 0;
    const idxXViewBox = paddingX + tExactForIdx * (width - paddingX * 2);
    const idxYViewBox = yFor(sampleAt(points, tExactForIdx));

    lastHoverIndexRef.current = idx;
    setHoverIndex(idx);
    setTooltipScreenPos({
      left: rect.left + (idxXViewBox / width) * rect.width,
      top: rect.top + (idxYViewBox / height) * rect.height,
    });
  }

  function clearHover() {
    setHoverIndex(null);
  }

  const displayIndex = hoverIndex ?? lastHoverIndexRef.current ?? (n > 0 ? 0 : null);
  const activePoint = displayIndex !== null ? dataPoints[displayIndex] : null;
  const isHoverVisible = hoverIndex !== null && activePoint !== null;
  const tExact = activePoint && n > 1 ? (displayIndex as number) / (n - 1) : 0;
  const hoverX = paddingX + tExact * (width - paddingX * 2);
  const hoverValue = activePoint ? sampleAt(points, tExact) : 0;
  const hoverY = yFor(hoverValue);

  return (
    <div className={styles.chartPlot}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={styles.chart}
        onPointerMove={handlePointerActivity}
        onPointerDown={handlePointerActivity}
        onPointerCancel={clearHover}
        onPointerLeave={(e) => {
          // Touch has no hover concept: a tap fires leave right after up,
          // which would hide the tooltip before it's readable. Keep it
          // sticky on touch until the next tap; only mouse clears on leave.
          if (e.pointerType === "mouse") clearHover();
        }}
      >
        {yTicks.map((tick, i) => (
          <line
            key={i}
            x1={paddingX}
            x2={width - paddingX}
            y1={yFor(tick)}
            y2={yFor(tick)}
            className={styles.gridLine}
          />
        ))}
        <polygon points={areaPoints} className={styles.chartArea} />
        <polyline points={linePoints} className={styles.chartLine} />
        <line
          x1={hoverX}
          x2={hoverX}
          y1={paddingY}
          y2={height - paddingY}
          className={`${styles.crosshair} ${
            isHoverVisible ? styles.crosshairVisible : ""
          }`}
        />
        <circle
          cx={hoverX}
          cy={hoverY}
          r={5}
          className={`${styles.hoverDot} ${
            isHoverVisible ? styles.hoverDotVisible : ""
          }`}
        />
      </svg>
      {activePoint && (
        <div
          className={`${styles.tooltip} ${
            isHoverVisible ? styles.tooltipVisible : ""
          }`}
          style={{
            left: `${tooltipScreenPos.left}px`,
            top: `${tooltipScreenPos.top}px`,
          }}
        >
          <div className={styles.tooltipLabel}>
            {formatTooltipLabel(activePoint.date, aggregation)}
          </div>
          <div className={styles.tooltipValue}>
            {activePoint.value.toLocaleString("es-AR")}
          </div>
        </div>
      )}
    </div>
  );
}

function YAxis({
  yTicks,
  yDomainMin,
  yDomainMax,
}: {
  yTicks: number[];
  yDomainMin: number;
  yDomainMax: number;
}) {
  const domainRange = yDomainMax - yDomainMin || 1;
  function yFor(value: number): number {
    return (
      CHART_HEIGHT -
      CHART_PADDING_Y -
      ((value - yDomainMin) / domainRange) * (CHART_HEIGHT - CHART_PADDING_Y * 2)
    );
  }

  return (
    <div className={styles.yAxis}>
      {yTicks.map((tick, i) => (
        <span
          key={i}
          className={styles.yAxisLabel}
          style={{ top: `${yFor(tick)}px` }}
        >
          {tick.toLocaleString("es-AR")}
        </span>
      ))}
    </div>
  );
}

type MetricCardProps = {
  title: string;
  totalValue: number;
  percentChange: number;
  daily: DailyPoint[];
  insights: Insight[];
  aggregation: Aggregation;
  isLoading?: boolean;
};

export default function MetricCard({
  title,
  totalValue,
  percentChange,
  insights,
  daily,
  aggregation,
  isLoading = false,
}: MetricCardProps) {
  const seriesPoints: SeriesPoint[] = useMemo(
    () => daily.map((d) => ({ date: d.date, value: d.views })),
    [daily]
  );
  const aggregatedDaily = useMemo(
    () => aggregateSeries(seriesPoints, aggregation),
    [seriesPoints, aggregation]
  );

  const { points: displayPoints } = useAnimatedSeries(aggregatedDaily, {
    sampleCount: SAMPLE_COUNT,
    durationMs: ANIMATION_DURATION,
  });

  const domain = useMemo(
    () => domainFromValues(displayPoints.map((p) => p.value)),
    [displayPoints]
  );
  const yTicks = useMemo(
    () => getNiceTicks(domain.min, domain.max, Y_TICK_COUNT),
    [domain]
  );

  const changeDirection =
    percentChange > 0 ? "up" : percentChange < 0 ? "down" : "flat";

  const changeClass =
    changeDirection === "up"
      ? styles.up
      : changeDirection === "down"
      ? styles.down
      : styles.flat;

  const arrow =
    changeDirection === "up" ? "▲" : changeDirection === "down" ? "▼" : "—";

  // However many days/weeks/months are plotted, only label a handful of
  // them, evenly spaced — the line itself always carries full resolution
  // (and the tooltip), so the axis never needs to cram or scroll.
  const labelIndices = useMemo(
    () => pickLabelIndices(aggregatedDaily.length, MAX_LABELS),
    [aggregatedDaily.length]
  );

  const yDomainMin = yTicks[0];
  const yDomainMax = yTicks[yTicks.length - 1];

  return (
    <div className={`${styles.card} ${isLoading ? styles.dimmed : ""}`}>
      <div className={styles.header}>
        <span className={styles.metricTitle}>{title}</span>
        <div className={styles.valueRow}>
          <span className={styles.value}>
            {totalValue.toLocaleString("es-AR")}
          </span>
          <span className={`${styles.badge} ${changeClass}`}>
            <span className={styles.arrow}>{arrow}</span>
            {Math.abs(percentChange).toLocaleString("es-AR")}%
          </span>
        </div>
      </div>

      <div className={styles.chartRow}>
        <YAxis yTicks={yTicks} yDomainMin={yDomainMin} yDomainMax={yDomainMax} />
        <div className={styles.chartInner}>
          <LineChart
            points={displayPoints}
            dataPoints={aggregatedDaily}
            aggregation={aggregation}
            yDomainMin={yDomainMin}
            yDomainMax={yDomainMax}
            yTicks={yTicks}
          />
          {aggregatedDaily.length > 0 && (
            <div className={styles.chartLabels}>
              {labelIndices.map((i) => {
                const point = aggregatedDaily[i];
                const t =
                  aggregatedDaily.length <= 1 ? 0 : i / (aggregatedDaily.length - 1);
                return (
                  <span
                    key={point.date}
                    className={styles.chartLabel}
                    style={{ left: `${t * 100}%` }}
                  >
                    {formatAxisLabel(point.date, aggregation)}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className={styles.insights}>
        {insights.length === 0 ? (
          <div className={styles.insightEmpty}>
            <span>Sin variaciones destacables en este período</span>
          </div>
        ) : (
          insights.map((insight, i) => <InsightCard key={i} {...insight} />)
        )}
      </div>
    </div>
  );
}
