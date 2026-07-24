import styles from "./InsightCompactRow.module.css";
import type { Insight, InsightSeverity } from "@/lib/insights";

const DOT_CLASS: Record<InsightSeverity, string> = {
  positive: "dotPos",
  negative: "dotNeg",
  warning: "dotNeutral",
};

export default function InsightCompactRow({ insight }: { insight: Insight }) {
  return (
    <div className={styles.row}>
      <span className={`${styles.dot} ${styles[DOT_CLASS[insight.severity]]}`} />
      <span className={styles.text}>{insight.shortText}</span>
    </div>
  );
}
