import { NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { resolveDateRange, formatGaDate } from "@/lib/ga4-dates";
import {
  Anomaly,
  SeriesPoint,
  detectAnomalies,
  getTopChannelForDate,
} from "@/lib/ga4-anomalies";
import { generateInsights } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = resolveDateRange(
    searchParams.get("startDate"),
    searchParams.get("endDate")
  );
  if ("error" in range) {
    return NextResponse.json({ error: range.error }, { status: 400 });
  }
  const { startDate, endDate, previousStartDate, previousEndDate } = range;

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

    const [response] = await analyticsDataClient.runReport({
      property,
      dateRanges: [
        { startDate, endDate, name: "current" },
        { startDate: previousStartDate, endDate: previousEndDate, name: "previous" },
      ],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    });

    const daily: SeriesPoint[] = [];
    let previousTotalViews = 0;

    for (const row of response.rows ?? []) {
      const dimensionValues = row.dimensionValues ?? [];
      const rangeName = dimensionValues[dimensionValues.length - 1]?.value;
      const date = formatGaDate(dimensionValues[0]?.value ?? "");
      const views = Number(row.metricValues?.[0]?.value ?? 0);
      // GA4 pads rows to the union of dates across both ranges (a date
      // outside a given range still gets a 0-value row for it) — only keep
      // rows whose date actually falls inside the range they're labeled as.
      if (rangeName === "current" && date >= startDate && date <= endDate) {
        daily.push({ date, value: views });
      } else if (
        rangeName === "previous" &&
        date >= previousStartDate &&
        date <= previousEndDate
      ) {
        previousTotalViews += views;
      }
    }

    daily.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const totalViews = daily.reduce((sum, day) => sum + day.value, 0);
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
      startDate,
      endDate,
      blocks: [
        {
          name: "Vistas",
          totalValue: totalViews,
          percentChange: roundedPercentChange,
          anomalies,
        },
      ],
    });

    return NextResponse.json({
      startDate,
      endDate,
      totalViews,
      previousTotalViews,
      percentChange: roundedPercentChange,
      daily: daily.map((d) => ({ date: d.date, views: d.value })),
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
