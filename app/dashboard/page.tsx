"use client";

import { useEffect, useState } from "react";
import styles from "./dashboard.module.css";

type RangeKey = "week" | "month" | "year";

type DailyPoint = {
  date: string;
  views: number;
};

type Ga4Report = {
  totalViews: number;
  previousTotalViews: number;
  percentChange: number;
  daily: DailyPoint[];
};

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "week", label: "Esta semana" },
  { key: "month", label: "Este Mes" },
  { key: "year", label: "Este año" },
];

const SUBTITLE_BY_RANGE: Record<RangeKey, string> = {
  week: "Vistas de página de esta semana",
  month: "Vistas de página de este mes",
  year: "Vistas de página de este año",
};

function formatDayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function LineChart({ data }: { data: DailyPoint[] }) {
  if (data.length === 0) {
    return null;
  }

  const width = 600;
  const height = 160;
  const paddingX = 8;
  const paddingY = 12;

  const views = data.map((d) => d.views);
  const max = Math.max(...views);
  const min = Math.min(...views);
  const range = max - min || 1;

  const linePoints = data
    .map((d, i) => {
      const x =
        data.length === 1
          ? width / 2
          : paddingX + (i * (width - paddingX * 2)) / (data.length - 1);
      const y =
        height -
        paddingY -
        ((d.views - min) / range) * (height - paddingY * 2);
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
  const [range, setRange] = useState<RangeKey>("week");
  const [report, setReport] = useState<Ga4Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    fetch(`/api/ga4-views?range=${range}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setReport(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("No se pudo conectar con la API de Analytics");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

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
      <div className={styles.filters}>
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.key}
            className={`${styles.filterButton} ${
              range === option.key ? styles.filterButtonActive : ""
            }`}
            onClick={() => setRange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <main className={styles.main}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className={styles.subtitle}>{SUBTITLE_BY_RANGE[range]}</p>

        {error ? (
          <div className={styles.card}>
            <p className={styles.error}>{error}</p>
          </div>
        ) : !report ? (
          <div className={styles.card}>
            <p className={styles.loading}>Cargando...</p>
          </div>
        ) : (
          <>
            <div className={styles.card}>
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

            {report.daily.length > 0 && (
              <div className={styles.chartCard}>
                <LineChart data={report.daily} />
                <div className={styles.chartLabels}>
                  <span>{formatDayLabel(report.daily[0].date)}</span>
                  <span>
                    {formatDayLabel(
                      report.daily[report.daily.length - 1].date
                    )}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
