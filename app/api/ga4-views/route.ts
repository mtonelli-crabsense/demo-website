import { NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

function formatGaDate(rawDate: string): string {
  return `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
}

function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

type DailyPoint = { date: string; views: number };

type Anomaly = {
  date: string;
  views: number;
  kind: "peak" | "valley";
  deviationScore: number;
  channel: string | null;
};

// Flags at most a couple of days that stand out from the rest of the period:
// either far from the period average (>1.5 std dev) or far from their local
// neighborhood (>40% above/below a windowed moving average). Either signal
// alone can catch a real anomaly the other misses (a sustained plateau shift
// vs. a single-day spike), so a day qualifies on either one.
function detectAnomalies(daily: DailyPoint[]): Omit<Anomaly, "channel">[] {
  const n = daily.length;
  if (n < 5) return [];

  const values = daily.map((d) => d.views);
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
        date: daily[i].date,
        views: value,
        kind: "peak",
        deviationScore: Math.max(zScore, maRatio),
      });
    } else if (isValley) {
      const maRatio = movingAvg > 0 ? (movingAvg - value) / movingAvg : 0;
      candidates.push({
        date: daily[i].date,
        views: value,
        kind: "valley",
        deviationScore: Math.max(-zScore, maRatio),
      });
    }
  }

  candidates.sort((a, b) => b.deviationScore - a.deviationScore);
  return candidates.slice(0, 2);
}

async function getTopChannelForDate(
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

type Insight = { text: string; severity: "positive" | "warning" | "negative" };

const INSIGHTS_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          severity: {
            type: "string",
            enum: ["positive", "warning", "negative"],
          },
        },
        required: ["text", "severity"],
        additionalProperties: false,
      },
    },
  },
  required: ["insights"],
  additionalProperties: false,
} as const;

function buildInsightsPrompt(input: {
  metricName: string;
  startDate: string;
  endDate: string;
  totalViews: number;
  percentChange: number;
  anomalies: Anomaly[];
}): string {
  const anomaliesText = input.anomalies.length
    ? input.anomalies
        .map((a) => {
          const label = a.kind === "peak" ? "Pico" : "Valle";
          const channelText = a.channel
            ? `, explicado principalmente por el canal "${a.channel}"`
            : "";
          return `- ${label} el ${a.date}: ${a.views.toLocaleString(
            "es-AR"
          )} vistas${channelText}`;
        })
        .join("\n")
    : "No se detectaron picos ni valles significativos en este período.";

  return `Sos un analista de datos web. Analizá el desempeño de la métrica "${input.metricName}" del sitio para el período del ${input.startDate} al ${input.endDate}.

Datos del período:
- Total de vistas: ${input.totalViews.toLocaleString("es-AR")}
- Variación vs. período anterior: ${input.percentChange > 0 ? "+" : ""}${input.percentChange}%
- Eventos destacados:
${anomaliesText}

Generá entre 2 y 4 insights breves en español sobre el desempeño de esta métrica en el período. Cada insight debe ser una oración corta y concreta que mencione un dato específico (el total, la variación porcentual, o un pico/valle puntual) y, si aplica, el canal de adquisición responsable de ese pico o valle. Clasificá cada insight como "positive" (buena noticia), "warning" (algo para monitorear sin ser grave) o "negative" (mala noticia o caída relevante). Si el período es muy corto o no hay variaciones destacables, devolvé un array vacío en "insights".`;
}

async function generateInsights(input: {
  metricName: string;
  startDate: string;
  endDate: string;
  totalViews: number;
  percentChange: number;
  anomalies: Anomaly[];
}): Promise<Insight[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      thinking: { type: "disabled" },
      output_config: {
        format: { type: "json_schema", schema: INSIGHTS_SCHEMA },
      },
      messages: [{ role: "user", content: buildInsightsPrompt(input) }],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") return [];

    const parsed = JSON.parse(textBlock.text) as { insights?: Insight[] };
    return Array.isArray(parsed.insights) ? parsed.insights : [];
  } catch (error) {
    console.error("Error generating insights with Claude:", error);
    return [];
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startParam = searchParams.get("startDate");
  const endParam = searchParams.get("endDate");

  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  let start = startParam ? parseIsoDate(startParam) : null;
  let end = endParam ? parseIsoDate(endParam) : null;

  if (!start || !end) {
    // Sin parámetros válidos: por defecto, los últimos 30 días.
    end = today;
    start = addDays(today, -29);
  }

  if (end.getTime() > today.getTime()) {
    end = today;
  }

  if (start.getTime() > end.getTime()) {
    return NextResponse.json(
      { error: "La fecha 'Desde' no puede ser posterior a la fecha 'Hasta'" },
      { status: 400 }
    );
  }

  const propertyId = process.env.GA4_PROPERTY_ID;
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!propertyId || !serviceAccountKey) {
    return NextResponse.json(
      {
        error:
          "Faltan las variables de entorno GA4_PROPERTY_ID o GOOGLE_SERVICE_ACCOUNT_KEY",
      },
      { status: 500 }
    );
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(serviceAccountKey);
  } catch {
    return NextResponse.json(
      { error: "GOOGLE_SERVICE_ACCOUNT_KEY no contiene un JSON válido" },
      { status: 500 }
    );
  }

  const startDate = formatDate(start);
  const endDate = formatDate(end);

  const periodLengthDays =
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(periodLengthDays - 1));
  const previousStartDate = formatDate(previousStart);
  const previousEndDate = formatDate(previousEnd);

  try {
    const analyticsDataClient = new BetaAnalyticsDataClient({ credentials });
    const property = `properties/${propertyId}`;

    const [dailyResponse, previousResponse] = await Promise.all([
      analyticsDataClient.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ dimension: { dimensionName: "date" } }],
      }),
      analyticsDataClient.runReport({
        property,
        dateRanges: [
          { startDate: previousStartDate, endDate: previousEndDate },
        ],
        metrics: [{ name: "screenPageViews" }],
      }),
    ]);

    const daily = (dailyResponse[0].rows ?? []).map((row) => ({
      date: formatGaDate(row.dimensionValues?.[0]?.value ?? ""),
      views: Number(row.metricValues?.[0]?.value ?? 0),
    }));

    const totalViews = daily.reduce((sum, day) => sum + day.views, 0);
    const previousTotalViews = Number(
      previousResponse[0].rows?.[0]?.metricValues?.[0]?.value ?? 0
    );

    const percentChange =
      previousTotalViews === 0
        ? 0
        : ((totalViews - previousTotalViews) / previousTotalViews) * 100;
    const roundedPercentChange = Math.round(percentChange * 10) / 10;

    const anomalyCandidates = detectAnomalies(daily);
    const anomalies: Anomaly[] = await Promise.all(
      anomalyCandidates.map(async (candidate) => ({
        ...candidate,
        channel: await getTopChannelForDate(
          analyticsDataClient,
          property,
          candidate.date
        ),
      }))
    );

    const insights = await generateInsights({
      metricName: "Vistas",
      startDate,
      endDate,
      totalViews,
      percentChange: roundedPercentChange,
      anomalies,
    });

    return NextResponse.json({
      startDate,
      endDate,
      totalViews,
      previousTotalViews,
      percentChange: roundedPercentChange,
      daily,
      insights,
    });
  } catch (error) {
    console.error("Error fetching GA4 report:", error);
    return NextResponse.json(
      { error: "No se pudo obtener el reporte de Google Analytics" },
      { status: 500 }
    );
  }
}
