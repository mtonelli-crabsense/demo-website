"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./dashboard.module.css";
import MetricCard, {
  Aggregation,
  DailyPoint,
  Insight,
  MetricConfig,
  formatFullDate,
} from "@/components/MetricCard";

type Ga4Report = {
  startDate: string;
  endDate: string;
  totalViews: number;
  previousTotalViews: number;
  percentChange: number;
  daily: DailyPoint[];
  insights: Insight[];
};

const AGGREGATION_OPTIONS: { key: Aggregation; label: string }[] = [
  { key: "day", label: "Día" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
];

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

  function handleApply() {
    if (!isRangeValid) return;
    setAppliedStart(pendingStart);
    setAppliedEnd(pendingEnd);
  }

  // Config-driven: add a new entry here to add a new metric card.
  const metrics: MetricConfig[] = report
    ? [
        {
          key: "views",
          title: "Vistas",
          totalValue: report.totalViews,
          percentChange: report.percentChange,
          daily: report.daily,
          insights: report.insights,
        },
      ]
    : [];

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className={styles.subtitle}>
          Datos del {formatFullDate(appliedStart)} al{" "}
          {formatFullDate(appliedEnd)}
        </p>

        <div className={styles.controlsBar}>
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
        </div>

        {!isRangeValid && (
          <p className={styles.rangeError}>
            Revisá el rango: "Desde" no puede ser posterior a "Hasta" ni una
            fecha futura.
          </p>
        )}

        {!report && !error && (
          <div className={styles.stateCard}>
            <p className={styles.loading}>Cargando...</p>
          </div>
        )}

        {!report && error && (
          <div className={styles.stateCard}>
            <p className={styles.error}>{error}</p>
          </div>
        )}

        {report && (
          <>
            {error && <p className={styles.inlineError}>{error}</p>}

            <div className={styles.metricsRow}>
              {metrics.map((metric) => (
                <div key={metric.key} className={styles.metricCardWrap}>
                  <MetricCard
                    title={metric.title}
                    totalValue={metric.totalValue}
                    percentChange={metric.percentChange}
                    daily={metric.daily}
                    insights={metric.insights}
                    aggregation={aggregation}
                    isLoading={isLoading}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
