"use client";

import { useEffect, useState } from "react";
import styles from "../dashboard.module.css";
import { Aggregation, formatFullDate } from "@/components/MetricCard";
import UsersBlock from "@/components/UsersBlock";
import { ScoreCardData } from "@/components/ScoreCard";
import { Insight } from "@/components/InsightCard";
import DateRangeSelector, {
  DateRange,
  rangeForPreset,
} from "@/components/DateRangeSelector";

type Ga4UsersReport = {
  startDate: string;
  endDate: string;
  audienceCreatedDate: string | null;
  segments: ScoreCardData[];
  insights: Insight[];
};

const AGGREGATION_OPTIONS: { key: Aggregation; label: string }[] = [
  { key: "day", label: "Día" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
];

export default function AudienciaPage() {
  const defaultRange = rangeForPreset("7d");

  const [appliedRange, setAppliedRange] = useState<DateRange>(defaultRange);
  const [usersReport, setUsersReport] = useState<Ga4UsersReport | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [aggregation, setAggregation] = useState<Aggregation>("day");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    fetch(
      `/api/ga4-users?startDate=${appliedRange.start}&endDate=${appliedRange.end}`
    )
      .then((r) => r.json())
      .then((users) => {
        if (cancelled) return;
        if (users.error) {
          setUsersError(users.error);
        } else {
          setUsersError(null);
          setUsersReport(users);
        }
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setUsersError("No se pudo conectar con la API de Analytics");
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appliedRange]);

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Audiencia</h1>
      <p className={styles.subtitle}>
        Datos del {formatFullDate(appliedRange.start)} al{" "}
        {formatFullDate(appliedRange.end)}
      </p>

      <div className={styles.controlsBar}>
        <DateRangeSelector onApply={setAppliedRange} />

        <div className={styles.aggregationRow}>
          {AGGREGATION_OPTIONS.map((option) => (
            <button
              key={option.key}
              className={`${styles.aggregationButton} ${
                aggregation === option.key ? styles.aggregationButtonActive : ""
              }`}
              onClick={() => setAggregation(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {!usersReport && !usersError && (
        <div className={styles.stateCard}>
          <p className={styles.loading}>Cargando...</p>
        </div>
      )}

      {usersError && !usersReport && (
        <div className={styles.stateCard}>
          <p className={styles.error}>{usersError}</p>
        </div>
      )}

      {usersReport && (
        <div className={styles.sectionGap}>
          {usersError && <p className={styles.inlineError}>{usersError}</p>}
          <div className={styles.sectionHead}>
            <div className={styles.sectionRole}>Tráfico &amp; Comportamiento (GA4)</div>
            <h2>Usuarios</h2>
            <p className={styles.sectionDesc}>
              Conversión objetivo: suscripción al newsletter. Variación vs. período
              anterior equivalente.
            </p>
          </div>
          <UsersBlock
            segments={usersReport.segments}
            aggregation={aggregation}
            audienceCreatedDate={usersReport.audienceCreatedDate}
            insights={usersReport.insights}
            isLoading={isLoading}
          />
        </div>
      )}
    </main>
  );
}
