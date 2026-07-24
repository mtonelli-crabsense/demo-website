"use client";

import styles from "./UsersBlock.module.css";
import ScoreCard, { ScoreCardData } from "./ScoreCard";
import InsightCard from "./InsightCard";
import InsightCompactRow from "./InsightCompactRow";
import type { Insight, InsightSeverity } from "@/lib/insights";
import { Aggregation } from "@/lib/chart-math";

// Display order for the grouped insights box: good news first, then neutral,
// then what needs attention.
const GROUP_ORDER: InsightSeverity[] = ["positive", "warning", "negative"];
const GROUP_LABELS: Record<InsightSeverity, string> = {
  positive: "Positivo",
  warning: "Neutro",
  negative: "Negativo",
};
const GROUP_LABEL_CLASS: Record<InsightSeverity, string> = {
  positive: "groupLabelPos",
  warning: "groupLabelNeutral",
  negative: "groupLabelNeg",
};

type UsersBlockProps = {
  segments: ScoreCardData[];
  aggregation: Aggregation;
  audienceCreatedDate?: string | null;
  insights: Insight[];
  isLoading?: boolean;
};

export default function UsersBlock({
  segments,
  aggregation,
  audienceCreatedDate,
  insights,
  isLoading = false,
}: UsersBlockProps) {
  const groups = GROUP_ORDER.map((severity) => ({
    severity,
    items: insights.filter((insight) => insight.severity === severity),
  })).filter((group) => group.items.length > 0);

  return (
    <div className={styles.wrap}>
      <div className={`${styles.scorecardRow} ${isLoading ? styles.dimmed : ""}`}>
        {segments.map((segment) => (
          <ScoreCard
            key={segment.key}
            data={segment}
            aggregation={aggregation}
            audienceCreatedDate={audienceCreatedDate}
          />
        ))}
      </div>

      <div className={styles.insightsHead}>
        <h2>Insights</h2>
        <span className={styles.insightsDesc}>
          generado a partir de las métricas de arriba
        </span>
      </div>

      {insights.length === 0 ? (
        <p className={styles.insightsEmpty}>
          Sin variaciones destacables en este período
        </p>
      ) : (
        <div className={styles.insightsBox}>
          {groups.map((group, i) => (
            <div key={group.severity} className={styles.insightsGroup}>
              {i > 0 && <hr className={styles.divider} />}
              <div
                className={`${styles.groupLabel} ${
                  styles[GROUP_LABEL_CLASS[group.severity]]
                }`}
              >
                {GROUP_LABELS[group.severity]}
              </div>
              {group.items.map((insight, idx) =>
                insight.weight === "peak" ? (
                  <InsightCard key={idx} {...insight} />
                ) : (
                  <InsightCompactRow key={idx} insight={insight} />
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
