"use client";

import { useMemo, useRef, useState } from "react";
import styles from "./Sparkline.module.css";
import {
  Aggregation,
  SeriesPoint,
  formatTooltipLabel,
  resolvePointerIndex,
  sampleAt,
  useAnimatedSeries,
} from "@/lib/chart-math";

const WIDTH = 200;
const HEIGHT = 56;
const PADDING = 4;
const SAMPLE_COUNT = 40;
const ANIMATION_DURATION = 500;

type SparklineProps = {
  series: SeriesPoint[];
  aggregation: Aggregation;
};

export default function Sparkline({ series, aggregation }: SparklineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });

  const { points } = useAnimatedSeries(series, {
    sampleCount: SAMPLE_COUNT,
    durationMs: ANIMATION_DURATION,
  });

  // Raw min/max domain (no "nice" rounding) — matches the mock's compact
  // sparkline, which deliberately skips a Y-axis.
  const domain = useMemo(() => {
    const values = points.map((p) => p.value);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    return min === max ? { min: min - 1 || 0, max: max + 1 || 1 } : { min, max };
  }, [points]);

  if (series.length === 0 || points.length === 0) {
    return <div className={styles.wrap} />;
  }

  const domainRange = domain.max - domain.min || 1;
  function yFor(value: number): number {
    return HEIGHT - PADDING - ((value - domain.min) / domainRange) * (HEIGHT - PADDING * 2);
  }

  const linePoints = points
    .map((p) => `${(PADDING + p.t * (WIDTH - PADDING * 2)).toFixed(1)},${yFor(p.value).toFixed(1)}`)
    .join(" ");
  const areaPoints = `${PADDING},${HEIGHT - PADDING} ${linePoints} ${WIDTH - PADDING},${HEIGHT - PADDING}`;

  const n = series.length;

  function handlePointerActivity(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const { idx } = resolvePointerIndex({
      clientX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
      viewBoxWidth: WIDTH,
      paddingX: PADDING,
      pointCount: n,
    });

    const tExact = n > 1 ? idx / (n - 1) : 0;
    const x = PADDING + tExact * (WIDTH - PADDING * 2);
    const y = yFor(sampleAt(points, tExact));

    setHoverIndex(idx);
    setTooltipPos({
      left: rect.left + (x / WIDTH) * rect.width,
      top: rect.top + (y / HEIGHT) * rect.height,
    });
  }

  function clearHover() {
    setHoverIndex(null);
  }

  const activePoint = hoverIndex !== null ? series[hoverIndex] : null;
  const tExact = activePoint && n > 1 ? (hoverIndex as number) / (n - 1) : 0;
  const hoverX = PADDING + tExact * (WIDTH - PADDING * 2);
  const hoverY = activePoint ? yFor(sampleAt(points, tExact)) : 0;

  return (
    <div className={styles.wrap}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className={styles.svg}
        onPointerMove={handlePointerActivity}
        onPointerDown={handlePointerActivity}
        onPointerCancel={clearHover}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") clearHover();
        }}
      >
        <polygon points={areaPoints} className={styles.area} />
        <polyline points={linePoints} className={styles.line} />
        <circle
          cx={hoverX}
          cy={hoverY}
          r={3.4}
          className={`${styles.hoverDot} ${activePoint ? styles.hoverDotVisible : ""}`}
        />
      </svg>
      {activePoint && (
        <div
          className={`${styles.tooltip} ${activePoint ? styles.tooltipVisible : ""}`}
          style={{ left: `${tooltipPos.left}px`, top: `${tooltipPos.top}px` }}
        >
          {formatTooltipLabel(activePoint.date, aggregation)}:{" "}
          {activePoint.value.toLocaleString("es-AR")}
        </div>
      )}
    </div>
  );
}
