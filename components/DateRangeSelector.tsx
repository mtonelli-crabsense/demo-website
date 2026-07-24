"use client";

import { useState } from "react";
import styles from "./DateRangeSelector.module.css";

export type DateRange = { start: string; end: string };
export type PresetKey = "7d" | "30d" | "90d" | "month" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "7d", label: "Últimos 7 días" },
  { key: "30d", label: "Últimos 30 días" },
  { key: "90d", label: "Últimos 90 días" },
  { key: "month", label: "Mes actual" },
  { key: "custom", label: "Personalizado" },
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

export function rangeForPreset(preset: Exclude<PresetKey, "custom">): DateRange {
  const today = new Date();
  const todayIso = toIso(today);
  switch (preset) {
    case "7d":
      return { start: toIso(addDaysLocal(today, -6)), end: todayIso };
    case "30d":
      return { start: toIso(addDaysLocal(today, -29)), end: todayIso };
    case "90d":
      return { start: toIso(addDaysLocal(today, -89)), end: todayIso };
    case "month": {
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: toIso(firstOfMonth), end: todayIso };
    }
  }
}

type DateRangeSelectorProps = {
  onApply: (range: DateRange) => void;
};

export default function DateRangeSelector({ onApply }: DateRangeSelectorProps) {
  const todayStr = toIso(new Date());
  const [preset, setPreset] = useState<PresetKey>("7d");
  const initialCustom = rangeForPreset("7d");
  const [customStart, setCustomStart] = useState(initialCustom.start);
  const [customEnd, setCustomEnd] = useState(initialCustom.end);

  function handlePresetClick(key: PresetKey) {
    setPreset(key);
    if (key === "custom") return;
    onApply(rangeForPreset(key));
  }

  const isCustomValid =
    customStart.length === 10 &&
    customEnd.length === 10 &&
    customStart <= customEnd &&
    customEnd <= todayStr;

  function handleApplyCustom() {
    if (!isCustomValid) return;
    onApply({ start: customStart, end: customEnd });
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.presetRow}>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={`${styles.presetButton} ${
              preset === p.key ? styles.presetButtonActive : ""
            }`}
            onClick={() => handlePresetClick(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className={styles.customRow}>
          <div className={styles.dateField}>
            <label htmlFor="customStart" className={styles.dateLabel}>
              Desde
            </label>
            <input
              id="customStart"
              type="date"
              className={styles.dateInput}
              value={customStart}
              max={customEnd < todayStr ? customEnd : todayStr}
              onChange={(e) => setCustomStart(e.target.value)}
            />
          </div>
          <div className={styles.dateField}>
            <label htmlFor="customEnd" className={styles.dateLabel}>
              Hasta
            </label>
            <input
              id="customEnd"
              type="date"
              className={styles.dateInput}
              value={customEnd}
              min={customStart}
              max={todayStr}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </div>
          <button
            className={styles.applyButton}
            onClick={handleApplyCustom}
            disabled={!isCustomValid}
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}
