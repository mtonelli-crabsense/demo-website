import { NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

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

    return NextResponse.json({
      startDate,
      endDate,
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
