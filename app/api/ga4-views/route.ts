import { NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

export const dynamic = "force-dynamic";

type RangeKey = "week" | "month" | "year";

const VALID_RANGES: RangeKey[] = ["week", "month", "year"];

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

function getDateWindow(range: RangeKey) {
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  let start: Date;
  if (range === "week") {
    const dayOfWeek = today.getUTCDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    start = addDays(today, -diffToMonday);
  } else if (range === "month") {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  } else {
    start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  }

  const periodLengthDays =
    Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(periodLengthDays - 1));

  return {
    startDate: formatDate(start),
    endDate: formatDate(today),
    previousStartDate: formatDate(previousStart),
    previousEndDate: formatDate(previousEnd),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rangeParam = searchParams.get("range");
  const range: RangeKey = VALID_RANGES.includes(rangeParam as RangeKey)
    ? (rangeParam as RangeKey)
    : "week";

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

  try {
    const analyticsDataClient = new BetaAnalyticsDataClient({ credentials });
    const property = `properties/${propertyId}`;
    const { startDate, endDate, previousStartDate, previousEndDate } =
      getDateWindow(range);

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

    return NextResponse.json({
      range,
      totalViews,
      previousTotalViews,
      percentChange: Math.round(percentChange * 10) / 10,
      daily,
    });
  } catch (error) {
    console.error("Error fetching GA4 report:", error);
    return NextResponse.json(
      { error: "No se pudo obtener el reporte de Google Analytics" },
      { status: 500 }
    );
  }
}
