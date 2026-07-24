"use client";

import styles from "./ScoreCard.module.css";
import Sparkline from "./Sparkline";
import { Aggregation, SeriesPoint, aggregateSeries } from "@/lib/chart-math";

export type DataStatus = "ok" | "unavailable" | "backfilling";

export type ScoreCardData = {
  key: string;
  label: string;
  value: number;
  percentChange: number;
  daily: SeriesPoint[];
  dataStatus: DataStatus;
  conversion: { value: number; percentChange: number; status: DataStatus };
};

function formatCompactNumber(n: number): string {
  if (Math.abs(n) >= 1000) {
    return `${(n / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })}K`;
  }
  return n.toLocaleString("es-AR");
}

function DeltaBadge({
  percentChange,
  className,
}: {
  percentChange: number;
  className: string;
}) {
  const dir = percentChange > 0 ? "up" : percentChange < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";
  const dirClass = dir === "up" ? styles.up : dir === "down" ? styles.down : styles.flat;
  return (
    <span className={`${className} ${dirClass}`}>
      {arrow} {Math.abs(percentChange).toLocaleString("es-AR")}%
    </span>
  );
}

type ScoreCardProps = {
  data: ScoreCardData;
  aggregation: Aggregation;
  audienceCreatedDate?: string | null;
};

export default function ScoreCard({
  data,
  aggregation,
  audienceCreatedDate,
}: ScoreCardProps) {
  if (data.dataStatus === "unavailable") {
    return (
      <div className={styles.col}>
        <div className={styles.label}>{data.label}</div>
        <div className={styles.unavailable}>
          Audiencia de GA4 no configurada todavía.
        </div>
      </div>
    );
  }

  const aggregatedDaily = aggregateSeries(data.daily, aggregation);
  const isBackfilling = data.dataStatus === "backfilling";

  return (
    <div className={styles.col}>
      <div className={styles.label}>{data.label}</div>
      <div className={styles.value}>{formatCompactNumber(data.value)}</div>
      {isBackfilling ? (
        <div className={styles.backfillBadge}>
          Datos desde el {audienceCreatedDate}
        </div>
      ) : (
        <DeltaBadge percentChange={data.percentChange} className={styles.delta} />
      )}
      <Sparkline series={aggregatedDaily} aggregation={aggregation} />
      <div className={styles.convRow}>
        <div className={styles.convLabel}>Conv. · Newsletter</div>
        <div className={styles.convValueRow}>
          <span className={styles.convValue}>
            {data.conversion.value.toLocaleString("es-AR")}
          </span>
          {data.conversion.status === "ok" && (
            <DeltaBadge
              percentChange={data.conversion.percentChange}
              className={styles.convDelta}
            />
          )}
        </div>
      </div>
    </div>
  );
}
