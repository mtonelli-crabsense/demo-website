import { NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

export const dynamic = "force-dynamic";

function formatGaDate(rawDate: string): string {
  return `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
}

export async function GET() {
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

    const [dailyResponse, previousResponse] = await Promise.all([
      analyticsDataClient.runReport({
        property,
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ dimension: { dimensionName: "date" } }],
      }),
      analyticsDataClient.runReport({
        property,
        dateRanges: [{ startDate: "60daysAgo", endDate: "31daysAgo" }],
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
