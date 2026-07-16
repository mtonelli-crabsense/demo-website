"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./dashboard.module.css";

type DailyPoint = {
  date: string;
  views: number;
};

type NormalizedPoint = {
  t: number;
  views: number;
};

type Ga4Report = {
  startDate: string;
  endDate: string;
  totalViews: number;
  previousTotalViews: number;
  percentChange: number;
  daily: DailyPoint[];
};

type Aggregation = "day" | "week" | "month";

const AGGREGATION_OPTIONS: { key: Aggregation; label: string }[] = [
  { key: "day", label: "Día" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
];

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

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const CHART_PADDING_X = 8;
const CHART_PADDING_Y = 12;
const Y_TICK_COUNT = 5;

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysLocal(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function formatFullDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
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

export default function DashboardPage() {
  const defaultRange = useMemo(() => {
    const today = new Date();
    return {
      start: toIso(addDaysLocal(today, -29)),
      end: toIso(today),
    };
  }, []);
  const todayStr = useMemo(() => toIso(new Date()), []);

  const [pendingStart, setPendingStart] = useState(defaultRange.start);
  const [pendingEnd, setPendingEnd] = useState(defaultRange.end);
  const [appliedStart, setAppliedStart] = useState(defaultRange.start);
  const [appliedEnd, setAppliedEnd] = useState(defaultRange.end);

  const [report, setReport] = useState<Ga4Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [aggregation, setAggregation] = useState<Aggregation>("day");

  const aggregatedDaily = useMemo(
    () => aggregateDaily(report?.daily ?? [], aggregation),
    [report, aggregation]
  );

  const [displayPoints, setDisplayPoints] = useState<NormalizedPoint[]>([]);
  const prevNormalizedRef = useRef<NormalizedPoint[] | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const isRangeValid =
    pendingStart.length === 10 &&
    pendingEnd.length === 10 &&
    pendingStart <= pendingEnd &&
    pendingEnd <= todayStr;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    fetch(
      `/api/ga4-views?startDate=${appliedStart}&endDate=${appliedEnd}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setError(null);
          setReport(data);
        }
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("No se pudo conectar con la API de Analytics");
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appliedStart, appliedEnd]);

  useEffect(() => {
    if (!report) return;
    const targetNormalized = toNormalized(aggregatedDaily);

    if (!prevNormalizedRef.current) {
      setDisplayPoints(targetNormalized);
      prevNormalizedRef.current = targetNormalized;
      return;
    }

    const fromNormalized = prevNormalizedRef.current;
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
      setDisplayPoints(frame);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        setDisplayPoints(targetNormalized);
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
  }, [aggregatedDaily]);

  function handleApply() {
    if (!isRangeValid) return;
    setAppliedStart(pendingStart);
    setAppliedEnd(pendingEnd);
  }

  const changeDirection =
    report && report.percentChange > 0
      ? "up"
      : report && report.percentChange < 0
      ? "down"
      : "flat";

  const changeClass =
    changeDirection === "up"
      ? styles.up
      : changeDirection === "down"
      ? styles.down
      : styles.flat;

  const arrow =
    changeDirection === "up" ? "▲" : changeDirection === "down" ? "▼" : "—";

  const shouldRotateLabels = aggregatedDaily.length > 12;
  const PX_PER_ROTATED_LABEL = 34;
  const chartMinWidth = shouldRotateLabels
    ? Math.max(600, aggregatedDaily.length * PX_PER_ROTATED_LABEL)
    : undefined;

  const displayViews = displayPoints.map((p) => p.views);
  const yTicks = getNiceTicks(
    displayViews.length ? Math.min(...displayViews) : 0,
    displayViews.length ? Math.max(...displayViews) : 1,
    Y_TICK_COUNT
  );
  const yDomainMin = yTicks[0];
  const yDomainMax = yTicks[yTicks.length - 1];

  return (
    <div className={styles.page}>
      <div className={styles.filterBar}>
        <div className={styles.filterRow}>
          <div className={styles.dateField}>
            <label htmlFor="startDate" className={styles.dateLabel}>
              Desde
            </label>
            <input
              id="startDate"
              type="date"
              className={styles.dateInput}
              value={pendingStart}
              max={pendingEnd < todayStr ? pendingEnd : todayStr}
              onChange={(e) => setPendingStart(e.target.value)}
            />
          </div>
          <div className={styles.dateField}>
            <label htmlFor="endDate" className={styles.dateLabel}>
              Hasta
            </label>
            <input
              id="endDate"
              type="date"
              className={styles.dateInput}
              value={pendingEnd}
              min={pendingStart}
              max={todayStr}
              onChange={(e) => setPendingEnd(e.target.value)}
            />
          </div>
          <button
            className={styles.applyButton}
            onClick={handleApply}
            disabled={!isRangeValid}
          >
            Aplicar
          </button>
        </div>
        {!isRangeValid && (
          <p className={styles.rangeError}>
            Revisá el rango: "Desde" no puede ser posterior a "Hasta" ni una
            fecha futura.
          </p>
        )}
      </div>

      <main className={styles.main}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className={styles.subtitle}>
          Vistas de página del {formatFullDate(appliedStart)} al{" "}
          {formatFullDate(appliedEnd)}
        </p>

        {!report && !error && (
          <div className={styles.card}>
            <p className={styles.loading}>Cargando...</p>
          </div>
        )}

        {!report && error && (
          <div className={styles.card}>
            <p className={styles.error}>{error}</p>
          </div>
        )}

        {report && (
          <>
            {error && <p className={styles.inlineError}>{error}</p>}

            <div
              className={`${styles.card} ${
                isLoading ? styles.dimmed : ""
              }`}
            >
              <span className={styles.count}>
                {report.totalViews.toLocaleString("es-AR")}
              </span>
              <div className={`${styles.change} ${changeClass}`}>
                <span className={styles.arrow}>{arrow}</span>
                <span>
                  {Math.abs(report.percentChange).toLocaleString("es-AR")}%
                  vs. período anterior
                </span>
              </div>
            </div>

            <div
              className={`${styles.chartCard} ${
                isLoading ? styles.dimmed : ""
              }`}
            >
              <div className={styles.aggregationRow}>
                {AGGREGATION_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    className={`${styles.aggregationButton} ${
                      aggregation === option.key
                        ? styles.aggregationButtonActive
                        : ""
                    }`}
                    onClick={() => setAggregation(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className={styles.chartRow}>
                <YAxis
                  yTicks={yTicks}
                  yDomainMin={yDomainMin}
                  yDomainMax={yDomainMax}
                />
                <div className={styles.chartScrollArea}>
                  <div
                    className={styles.chartInner}
                    style={
                      chartMinWidth ? { minWidth: `${chartMinWidth}px` } : undefined
                    }
                  >
                    <LineChart
                      points={displayPoints}
                      dataPoints={aggregatedDaily}
                      aggregation={aggregation}
                      yDomainMin={yDomainMin}
                      yDomainMax={yDomainMax}
                      yTicks={yTicks}
                    />
                    {aggregatedDaily.length > 0 && (
                      <div
                        className={`${styles.chartLabels} ${
                          shouldRotateLabels ? styles.chartLabelsRotated : ""
                        }`}
                      >
                        {aggregatedDaily.map((point, i) => {
                          const t =
                            aggregatedDaily.length <= 1
                              ? 0
                              : i / (aggregatedDaily.length - 1);
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
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
