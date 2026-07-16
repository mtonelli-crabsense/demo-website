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

const SAMPLE_COUNT = 40;
const ANIMATION_DURATION = 500;

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

function toNormalized(data: DailyPoint[]): NormalizedPoint[] {
  if (data.length <= 1) {
    return data.map((d) => ({ t: 0, views: d.views }));
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

function LineChart({ points }: { points: NormalizedPoint[] }) {
  if (points.length === 0) {
    return null;
  }

  const width = 600;
  const height = 160;
  const paddingX = 8;
  const paddingY = 12;

  const viewsArr = points.map((p) => p.views);
  const max = Math.max(...viewsArr);
  const min = Math.min(...viewsArr);
  const range = max - min || 1;

  const linePoints = points
    .map((p) => {
      const x = paddingX + p.t * (width - paddingX * 2);
      const y =
        height - paddingY - ((p.views - min) / range) * (height - paddingY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPoints = `${paddingX},${height - paddingY} ${linePoints} ${
    width - paddingX
  },${height - paddingY}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={styles.chart}
    >
      <polygon points={areaPoints} className={styles.chartArea} />
      <polyline points={linePoints} className={styles.chartLine} />
    </svg>
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
    const targetNormalized = toNormalized(report.daily);

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
  }, [report]);

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
              <LineChart points={displayPoints} />
              {report.daily.length > 0 && (
                <div className={styles.chartLabels}>
                  <span>{formatDayLabel(report.daily[0].date)}</span>
                  <span>
                    {formatDayLabel(
                      report.daily[report.daily.length - 1].date
                    )}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
