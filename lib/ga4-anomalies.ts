import { BetaAnalyticsDataClient } from "@google-analytics/data";

export type SeriesPoint = { date: string; value: number };

export type Anomaly = {
  date: string;
  value: number;
  kind: "peak" | "valley";
  deviationScore: number;
  channel: string | null;
};

// Flags at most a couple of days that stand out from the rest of the period:
// either far from the period average (>1.5 std dev) or far from their local
// neighborhood (>40% above/below a windowed moving average). Either signal
// alone can catch a real anomaly the other misses (a sustained plateau shift
// vs. a single-day spike), so a day qualifies on either one.
export function detectAnomalies(
  series: SeriesPoint[]
): Omit<Anomaly, "channel">[] {
  const n = series.length;
  if (n < 5) return [];

  const values = series.map((d) => d.value);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return [];

  const window = Math.min(7, Math.max(3, Math.floor(n / 4)));
  const candidates: Omit<Anomaly, "channel">[] = [];

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(n, i + window + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      if (j === i) continue;
      sum += values[j];
      count++;
    }
    if (count === 0) continue;
    const movingAvg = sum / count;
    const value = values[i];
    const zScore = (value - mean) / stddev;

    const isPeak = zScore > 1.5 || (movingAvg > 0 && value > movingAvg * 1.4);
    const isValley =
      zScore < -1.5 || (movingAvg > 0 && value < movingAvg * 0.6);

    if (isPeak) {
      const maRatio = movingAvg > 0 ? (value - movingAvg) / movingAvg : 0;
      candidates.push({
        date: series[i].date,
        value,
        kind: "peak",
        deviationScore: Math.max(zScore, maRatio),
      });
    } else if (isValley) {
      const maRatio = movingAvg > 0 ? (movingAvg - value) / movingAvg : 0;
      candidates.push({
        date: series[i].date,
        value,
        kind: "valley",
        deviationScore: Math.max(-zScore, maRatio),
      });
    }
  }

  candidates.sort((a, b) => b.deviationScore - a.deviationScore);
  return candidates.slice(0, 2);
}

export async function getTopChannelForDate(
  client: BetaAnalyticsDataClient,
  property: string,
  date: string
): Promise<string | null> {
  try {
    const [response] = await client.runReport({
      property,
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 1,
    });
    return response.rows?.[0]?.dimensionValues?.[0]?.value ?? null;
  } catch (error) {
    console.error("Error fetching channel breakdown for", date, error);
    return null;
  }
}
