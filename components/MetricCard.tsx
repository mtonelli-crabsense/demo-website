"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./MetricCard.module.css";

export type DailyPoint = {
  date: string;
  views: number;
};

export type Aggregation = "day" | "week" | "month";

export type InsightSeverity = "positive" | "warning" | "negative";

export type Insight = {
  text: string;
  severity: InsightSeverity;
};

export type MetricConfig = {
  key: string;
  title: string;
  totalValue: number;
  percentChange: number;
  daily: DailyPoint[];
  insights: Insight[];
};

type NormalizedPoint = {
  t: number;
  views: number;
};

const MONTH_NAMES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const SAMPLE_COUNT = 40;
const ANIMATION_DURATION = 500;
const MAX_LABELS = 6;

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const CHART_PADDING_X = 8;
const CHART_PADDING_Y = 12;
const Y_TICK_COUNT = 5;

export function formatFullDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function formatDayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function parseIsoUTC(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIsoUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfWeekKey(isoDate: string): string {
  const date = parseIsoUTC(isoDate);
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diffToMonday);
  return toIsoUTC(date);
}

function startOfMonthKey(isoDate: string): string {
  const [y, m] = isoDate.split("-");
  return `${y}-${m}-01`;
}

function aggregateDaily(
  daily: DailyPoint[],
  aggregation: Aggregation
): DailyPoint[] {
  if (aggregation === "day") return daily;

  const keyFn = aggregation === "week" ? startOfWeekKey : startOfMonthKey;
  const order: string[] = [];
  const totals = new Map<string, number>();

  for (const point of daily) {
    const key = keyFn(point.date);
    if (!totals.has(key)) {
      totals.set(key, 0);
      order.push(key);
    }
    totals.set(key, totals.get(key)! + point.views);
  }

  return order.map((key) => ({ date: key, views: totals.get(key)! }));
}

function formatAxisLabel(isoDate: string, aggregation: Aggregation): string {
  if (aggregation === "month") {
    const [year, month] = isoDate.split("-");
    return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
  }
  return formatDayLabel(isoDate);
}

function formatTooltipLabel(isoDate: string, aggregation: Aggregation): string {
  if (aggregation === "month") return formatAxisLabel(isoDate, aggregation);
  if (aggregation === "week") return `Semana del ${formatFullDate(isoDate)}`;
  return formatFullDate(isoDate);
}

// Evenly spaced indices into a length-N series, capped at maxLabels — so the
// axis always fits without rotating or scrolling, regardless of how many
// points (days, weeks, months) are actually plotted.
function pickLabelIndices(length: number, maxLabels: number): number[] {
  if (length <= 0) return [];
  if (length <= maxLabels) return Array.from({ length }, (_, i) => i);
  const indices = new Set<number>();
  for (let i = 0; i < maxLabels; i++) {
    indices.add(Math.round((i * (length - 1)) / (maxLabels - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

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

function getNiceTicks(
  rawMin: number,
  rawMax: number,
  tickCount: number
): number[] {
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

// Evenly spaced (not "nice") ticks: used only while the domain is mid-animation,
// so gridlines glide smoothly instead of jumping to new nice-rounded steps
// every frame. The real nice ticks are restored once the animation settles.
function evenTicks(domain: Domain, count: number): number[] {
  if (domain.min === domain.max) return [Math.round(domain.min)];
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push(Math.round(domain.min + ((domain.max - domain.min) * i) / (count - 1)));
  }
  return ticks;
}

function toNormalized(data: DailyPoint[]): NormalizedPoint[] {
  if (data.length === 0) return [];
  if (data.length === 1) {
    // A single point can't draw a polyline: duplicate it into a flat line.
    return [
      { t: 0, views: data[0].views },
      { t: 1, views: data[0].views },
    ];
  }
  return data.map((d, i) => ({ t: i / (data.length - 1), views: d.views }));
}

function sampleAt(points: NormalizedPoint[], t: number): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].views;
  if (t <= points[0].t) return points[0].views;
  if (t >= points[points.length - 1].t) return points[points.length - 1].views;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.t && t <= b.t) {
      const frac = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return a.views + (b.views - a.views) * frac;
    }
  }
  return points[points.length - 1].views;
}

type LineChartProps = {
  points: NormalizedPoint[];
  dataPoints: DailyPoint[];
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
      return `${x.toFixed(1)},${yFor(p.views).toFixed(1)}`;
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

    const xViewBox = ((e.clientX - rect.left) / rect.width) * width;
    const t = Math.min(
      1,
      Math.max(0, (xViewBox - paddingX) / (width - paddingX * 2))
    );
    const idx = n <= 1 ? 0 : Math.round(t * (n - 1));

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
            {activePoint.views.toLocaleString("es-AR")}
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

const INSIGHT_EMOJI: Record<InsightSeverity, string> = {
  positive: "🙂",
  warning: "😐",
  negative: "🙁",
};

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
  const aggregatedDaily = useMemo(
    () => aggregateDaily(daily, aggregation),
    [daily, aggregation]
  );

  const [display, setDisplay] = useState<{
    points: NormalizedPoint[];
    yTicks: number[];
  }>(() => {
    const points = toNormalized(aggregatedDaily);
    const domain = domainFromValues(points.map((p) => p.views));
    return { points, yTicks: getNiceTicks(domain.min, domain.max, Y_TICK_COUNT) };
  });
  const prevNormalizedRef = useRef<NormalizedPoint[] | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const targetNormalized = toNormalized(aggregatedDaily);

    if (!prevNormalizedRef.current) {
      const domain = domainFromValues(targetNormalized.map((p) => p.views));
      setDisplay({
        points: targetNormalized,
        yTicks: getNiceTicks(domain.min, domain.max, Y_TICK_COUNT),
      });
      prevNormalizedRef.current = targetNormalized;
      return;
    }

    const fromNormalized = prevNormalizedRef.current;
    const fromDomain = domainFromValues(fromNormalized.map((p) => p.views));
    const toDomain = domainFromValues(targetNormalized.map((p) => p.views));
    let startTime: number | null = null;

    function step(timestamp: number) {
      if (startTime === null) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      const frame: NormalizedPoint[] = Array.from(
        { length: SAMPLE_COUNT },
        (_, i) => {
          const t = i / (SAMPLE_COUNT - 1);
          const fromValue = sampleAt(fromNormalized, t);
          const toValue = sampleAt(targetNormalized, t);
          return { t, views: fromValue + (toValue - fromValue) * eased };
        }
      );

      if (progress < 1) {
        const domain: Domain = {
          min: fromDomain.min + (toDomain.min - fromDomain.min) * eased,
          max: fromDomain.max + (toDomain.max - fromDomain.max) * eased,
        };
        setDisplay({ points: frame, yTicks: evenTicks(domain, Y_TICK_COUNT) });
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay({
          points: targetNormalized,
          yTicks: getNiceTicks(toDomain.min, toDomain.max, Y_TICK_COUNT),
        });
        prevNormalizedRef.current = targetNormalized;
      }
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregatedDaily]);

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

  const { points: displayPoints, yTicks } = display;
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
          <div className={`${styles.insightRow} ${styles.insightNeutral}`}>
            <span>Sin variaciones destacables en este período</span>
          </div>
        ) : (
          insights.map((insight, i) => (
            <div
              key={i}
              className={`${styles.insightRow} ${styles[insight.severity]}`}
            >
              <span className={styles.insightEmoji}>
                {INSIGHT_EMOJI[insight.severity]}
              </span>
              <span>{insight.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
