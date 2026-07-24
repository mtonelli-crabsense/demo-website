import styles from "./InsightCard.module.css";
import type { Insight, InsightSeverity, InsightWeight } from "@/lib/insights";

export type { Insight, InsightSeverity, InsightWeight };

const SEVERITY_CLASS: Record<InsightSeverity, string> = {
  positive: "pos",
  negative: "neg",
  warning: "neutral",
};

function badgeLabel(severity: InsightSeverity, weight: InsightWeight): string {
  if (weight === "peak") {
    if (severity === "positive") return "Pico ▲ detectado";
    if (severity === "negative") return "Pico ▼ detectado";
    return "Pico detectado";
  }
  if (severity === "positive") return "Positivo";
  if (severity === "negative") return "Negativo";
  return "Neutro";
}

export default function InsightCard({ text, severity, weight }: Insight) {
  const variantClass = styles[SEVERITY_CLASS[severity]];
  const peakClass = weight === "peak" ? styles.peak : "";

  return (
    <div className={`${styles.card} ${variantClass} ${peakClass}`}>
      <span className={styles.badge}>{badgeLabel(severity, weight)}</span>
      <span className={styles.text}>{text}</span>
    </div>
  );
}
