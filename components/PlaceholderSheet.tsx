import styles from "./PlaceholderSheet.module.css";

type StatTile = { label: string; value: string };

type PlaceholderSheetProps = {
  eyebrow: string;
  title: string;
  description: string;
  stats?: StatTile[];
};

export default function PlaceholderSheet({
  eyebrow,
  title,
  description,
  stats = [],
}: PlaceholderSheetProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.role}>{eyebrow}</div>
        <h1>{title}</h1>
        <p className={styles.desc}>{description}</p>
      </div>

      <div className={styles.note}>
        Próximamente — esta hoja todavía no está conectada a datos reales de GA4.
      </div>

      {stats.length > 0 && (
        <div className={styles.statsRow}>
          {stats.map((stat) => (
            <div key={stat.label} className={styles.statTile}>
              <div className={styles.statLabel}>{stat.label}</div>
              <div className={styles.statValue}>{stat.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
