import { useEffect, useRef, useState } from "react";

export type Aggregation = "day" | "week" | "month";
export type SeriesPoint = { date: string; value: number };
export type NormalizedPoint = { t: number; value: number };

export const MONTH_NAMES = [
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

export function formatFullDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function formatDayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

export function parseIsoUTC(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIsoUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfWeekKey(isoDate: string): string {
  const date = parseIsoUTC(isoDate);
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diffToMonday);
  return toIsoUTC(date);
}

export function startOfMonthKey(isoDate: string): string {
  const [y, m] = isoDate.split("-");
  return `${y}-${m}-01`;
}

export function aggregateSeries(
  series: SeriesPoint[],
  aggregation: Aggregation
): SeriesPoint[] {
  if (aggregation === "day") return series;

  const keyFn = aggregation === "week" ? startOfWeekKey : startOfMonthKey;
  const order: string[] = [];
  const totals = new Map<string, number>();

  for (const point of series) {
    const key = keyFn(point.date);
    if (!totals.has(key)) {
      totals.set(key, 0);
      order.push(key);
    }
    totals.set(key, totals.get(key)! + point.value);
  }

  return order.map((key) => ({ date: key, value: totals.get(key)! }));
}

export function formatAxisLabel(isoDate: string, aggregation: Aggregation): string {
  if (aggregation === "month") {
    const [year, month] = isoDate.split("-");
    return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
  }
  return formatDayLabel(isoDate);
}

export function formatTooltipLabel(
  isoDate: string,
  aggregation: Aggregation
): string {
  if (aggregation === "month") return formatAxisLabel(isoDate, aggregation);
  if (aggregation === "week") return `Semana del ${formatFullDate(isoDate)}`;
  return formatFullDate(isoDate);
}

// Evenly spaced indices into a length-N series, capped at maxLabels — so an
// axis always fits without rotating or scrolling, regardless of point count.
export function pickLabelIndices(length: number, maxLabels: number): number[] {
  if (length <= 0) return [];
  if (length <= maxLabels) return Array.from({ length }, (_, i) => i);
  const indices = new Set<number>();
  for (let i = 0; i < maxLabels; i++) {
    indices.add(Math.round((i * (length - 1)) / (maxLabels - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

export function toNormalized(data: SeriesPoint[]): NormalizedPoint[] {
  if (data.length === 0) return [];
  if (data.length === 1) {
    // A single point can't draw a polyline: duplicate it into a flat line.
    return [
      { t: 0, value: data[0].value },
      { t: 1, value: data[0].value },
    ];
  }
  return data.map((d, i) => ({ t: i / (data.length - 1), value: d.value }));
}

export function sampleAt(points: NormalizedPoint[], t: number): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].value;
  if (t <= points[0].t) return points[0].value;
  if (t >= points[points.length - 1].t) return points[points.length - 1].value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.t && t <= b.t) {
      const frac = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return a.value + (b.value - a.value) * frac;
    }
  }
  return points[points.length - 1].value;
}

// Maps a pointer clientX (in screen space) to the nearest data-point index
// and its normalized t, shared by every hoverable chart (LineChart, Sparkline).
export function resolvePointerIndex(params: {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  viewBoxWidth: number;
  paddingX: number;
  pointCount: number;
}): { idx: number; t: number } {
  const { clientX, rectLeft, rectWidth, viewBoxWidth, paddingX, pointCount } = params;
  const xViewBox = ((clientX - rectLeft) / rectWidth) * viewBoxWidth;
  const t = Math.min(
    1,
    Math.max(0, (xViewBox - paddingX) / (viewBoxWidth - paddingX * 2))
  );
  const idx = pointCount <= 1 ? 0 : Math.round(t * (pointCount - 1));
  return { idx, t };
}

// Animates a series' displayed values between aggregation levels (day/week/
// month): resamples into `sampleCount` interpolated points during the
// transition (cubic ease-out), then settles back to the exact target points
// (one per data point) once done — shared by LineChart and Sparkline so both
// redraw in lockstep with the same easing/duration.
export function useAnimatedSeries(
  target: SeriesPoint[],
  options: { sampleCount?: number; durationMs?: number } = {}
): { points: NormalizedPoint[]; isAnimating: boolean } {
  const { sampleCount = 40, durationMs = 500 } = options;
  const [points, setPoints] = useState<NormalizedPoint[]>(() => toNormalized(target));
  const [isAnimating, setIsAnimating] = useState(false);
  const prevRef = useRef<NormalizedPoint[] | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const targetNormalized = toNormalized(target);

    if (!prevRef.current) {
      setPoints(targetNormalized);
      prevRef.current = targetNormalized;
      return;
    }

    const fromNormalized = prevRef.current;
    let startTime: number | null = null;
    setIsAnimating(true);

    function step(timestamp: number) {
      if (startTime === null) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      const frame: NormalizedPoint[] = Array.from({ length: sampleCount }, (_, i) => {
        const t = i / (sampleCount - 1);
        const fromValue = sampleAt(fromNormalized, t);
        const toValue = sampleAt(targetNormalized, t);
        return { t, value: fromValue + (toValue - fromValue) * eased };
      });

      if (progress < 1) {
        setPoints(frame);
        frameRef.current = requestAnimationFrame(step);
      } else {
        setPoints(targetNormalized);
        prevRef.current = targetNormalized;
        setIsAnimating(false);
      }
    }

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return { points, isAnimating };
}
