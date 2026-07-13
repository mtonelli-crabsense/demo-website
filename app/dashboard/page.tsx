"use client";

import { useEffect, useState } from "react";
import styles from "./dashboard.module.css";

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
  const [report, setReport] = useState<Ga4Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ga4-views")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setReport(data);
        }
      })
      .catch(() => setError("No se pudo conectar con la API de Analytics"));
  }, []);

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
    <main className={styles.main}>
      <h1 className={styles.title}>Dashboard</h1>
      <p className={styles.subtitle}>
        Vistas de página de los últimos 30 días
      </p>

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
                {Math.abs(report.percentChange).toLocaleString("es-AR")}% vs.
                período anterior
              </span>
            </div>
          </div>

          {report.daily.length > 0 && (
            <div className={styles.chartCard}>
              <LineChart data={report.daily} />
              <div className={styles.chartLabels}>
                <span>{formatDayLabel(report.daily[0].date)}</span>
                <span>
                  {formatDayLabel(report.daily[report.daily.length - 1].date)}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
