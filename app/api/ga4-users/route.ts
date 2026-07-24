import { NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { resolveDateRange, formatGaDate, parseIsoDate } from "@/lib/ga4-dates";
import {
  Anomaly,
  SeriesPoint,
  detectAnomalies,
  getTopChannelForDate,
} from "@/lib/ga4-anomalies";
import { generateInsights, MetricBlock } from "@/lib/insights";

export const dynamic = "force-dynamic";

type SegmentKey = "total" | "nuevos" | "recurrentes" | "s1" | "s25" | "s6";
type DataStatus = "ok" | "unavailable" | "backfilling";

type Segment = {
  key: SegmentKey;
  label: string;
  value: number;
  percentChange: number;
  daily: SeriesPoint[];
  dataStatus: DataStatus;
  conversion: {
    value: number;
    percentChange: number;
    status: DataStatus;
  };
};

const SEGMENT_LABELS: Record<SegmentKey, string> = {
  total: "Total Usuarios",
  nuevos: "Usuarios Nuevos",
  recurrentes: "Usuarios Recurrentes",
  s1: "Usuarios — 1 sesión",
  s25: "Usuarios — 2 a 5 sesiones",
  s6: "Usuarios — 6+ sesiones",
};

function pctChange(current: number, previous: number): number {
  const raw = previous === 0 ? 0 : ((current - previous) / previous) * 100;
  return Math.round(raw * 10) / 10;
}

function sumSeries(series: SeriesPoint[]): number {
  return series.reduce((sum, p) => sum + p.value, 0);
}

// GA4 appends a "dateRange" dimension as the last value in each row when
// multiple named dateRanges are requested — this reads it back out.
function rangeNameOf(row: { dimensionValues?: ({ value?: string | null } | null)[] | null }): string | undefined {
  const values = row.dimensionValues ?? [];
  return values[values.length - 1]?.value ?? undefined;
}

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

  const audienceEnv = {
    s1: process.env.GA4_AUDIENCE_1_SESSION,
    s25: process.env.GA4_AUDIENCE_2_5_SESSIONS,
    s6: process.env.GA4_AUDIENCE_6_PLUS_SESSIONS,
  };
  const audiencesConfigured =
    !!audienceEnv.s1 && !!audienceEnv.s25 && !!audienceEnv.s6;
  const audienceNameByKey: Record<"s1" | "s25" | "s6", string> = {
    s1: audienceEnv.s1 ?? "",
    s25: audienceEnv.s25 ?? "",
    s6: audienceEnv.s6 ?? "",
  };
  const audienceKeyByName = new Map<string, "s1" | "s25" | "s6">(
    audiencesConfigured
      ? [
          [audienceNameByKey.s1, "s1"],
          [audienceNameByKey.s25, "s25"],
          [audienceNameByKey.s6, "s6"],
        ]
      : []
  );

  const audienceCreatedDate = process.env.GA4_AUDIENCE_CREATED_DATE ?? null;
  const audienceCreatedParsed = audienceCreatedDate
    ? parseIsoDate(audienceCreatedDate)
    : null;
  // If the previous-period comparison window predates when the audiences
  // were created in GA4, membership data for it doesn't exist — GA4
  // audiences aren't retroactive, so a raw previous=0 would misleadingly
  // read as "0% change" instead of "no historical data yet".
  const audienceBackfilling =
    audiencesConfigured &&
    audienceCreatedParsed !== null &&
    (parseIsoDate(previousEndDate)?.getTime() ?? 0) <
      audienceCreatedParsed.getTime();

  try {
    const analyticsDataClient = new BetaAnalyticsDataClient({ credentials });
    const property = `properties/${propertyId}`;
    const dateRanges = [
      { startDate, endDate, name: "current" },
      { startDate: previousStartDate, endDate: previousEndDate, name: "previous" },
    ];

    // Call 1: Total / Nuevos daily trend (Recurrentes derived by subtraction).
    const usersReportPromise = analyticsDataClient.runReport({
      property,
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "totalUsers" }, { name: "newUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    });

    // Call 2: session-frequency buckets via GA4 Audiences (skipped if not configured).
    const audienceReportPromise = audiencesConfigured
      ? analyticsDataClient.runReport({
          property,
          dateRanges,
          dimensions: [{ name: "date" }, { name: "audienceName" }],
          metrics: [{ name: "totalUsers" }],
          dimensionFilter: {
            filter: {
              fieldName: "audienceName",
              inListFilter: {
                values: [
                  audienceNameByKey.s1,
                  audienceNameByKey.s25,
                  audienceNameByKey.s6,
                ],
              },
            },
          },
          orderBys: [{ dimension: { dimensionName: "date" } }],
        })
      : null;

    // Call 3: newsletter conversion split by new vs. returning.
    const conversionByNewVsReturningPromise = analyticsDataClient.runReport({
      property,
      dateRanges,
      dimensions: [{ name: "newVsReturning" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          stringFilter: { matchType: "EXACT", value: "Form_enviado" },
        },
      },
    });

    // Call 4: newsletter conversion split by session-frequency audience.
    const conversionByAudiencePromise = audiencesConfigured
      ? analyticsDataClient.runReport({
          property,
          dateRanges,
          dimensions: [{ name: "audienceName" }],
          metrics: [{ name: "eventCount" }],
          dimensionFilter: {
            andGroup: {
              expressions: [
                {
                  filter: {
                    fieldName: "eventName",
                    stringFilter: { matchType: "EXACT", value: "Form_enviado" },
                  },
                },
                {
                  filter: {
                    fieldName: "audienceName",
                    inListFilter: {
                      values: [
                        audienceNameByKey.s1,
                        audienceNameByKey.s25,
                        audienceNameByKey.s6,
                      ],
                    },
                  },
                },
              ],
            },
          },
        })
      : null;

    const [
      [usersReport],
      audienceReportResult,
      [conversionByNewVsReturning],
      conversionByAudienceResult,
    ] = await Promise.all([
      usersReportPromise,
      audienceReportPromise,
      conversionByNewVsReturningPromise,
      conversionByAudiencePromise,
    ]);
    const [audienceReport] = audienceReportResult ?? [null];
    const [conversionByAudience] = conversionByAudienceResult ?? [null];

    // ---- Users axis A: Total / Nuevos / Recurrentes ----
    const totalDaily: SeriesPoint[] = [];
    const nuevosDaily: SeriesPoint[] = [];
    let previousTotal = 0;
    let previousNuevos = 0;

    for (const row of usersReport.rows ?? []) {
      const dimensionValues = row.dimensionValues ?? [];
      const rangeName = rangeNameOf(row);
      const date = formatGaDate(dimensionValues[0]?.value ?? "");
      const totalUsers = Number(row.metricValues?.[0]?.value ?? 0);
      const newUsers = Number(row.metricValues?.[1]?.value ?? 0);

      // GA4 pads rows to the union of dates across both ranges (a date
      // outside a given range still gets a 0-value row for it) — only keep
      // rows whose date actually falls inside the range they're labeled as.
      if (rangeName === "current" && date >= startDate && date <= endDate) {
        totalDaily.push({ date, value: totalUsers });
        nuevosDaily.push({ date, value: newUsers });
      } else if (
        rangeName === "previous" &&
        date >= previousStartDate &&
        date <= previousEndDate
      ) {
        previousTotal += totalUsers;
        previousNuevos += newUsers;
      }
    }
    totalDaily.sort((a, b) => (a.date < b.date ? -1 : 1));
    nuevosDaily.sort((a, b) => (a.date < b.date ? -1 : 1));

    const recurrentesDaily: SeriesPoint[] = totalDaily.map((point, i) => ({
      date: point.date,
      value: point.value - (nuevosDaily[i]?.value ?? 0),
    }));
    const previousRecurrentes = previousTotal - previousNuevos;

    const currentTotal = sumSeries(totalDaily);
    const currentNuevos = sumSeries(nuevosDaily);
    const currentRecurrentes = sumSeries(recurrentesDaily);

    // ---- Users axis B: session-frequency buckets ----
    const audienceDaily: Record<"s1" | "s25" | "s6", SeriesPoint[]> = {
      s1: [],
      s25: [],
      s6: [],
    };
    const audiencePrevious: Record<"s1" | "s25" | "s6", number> = {
      s1: 0,
      s25: 0,
      s6: 0,
    };

    for (const row of audienceReport?.rows ?? []) {
      const dimensionValues = row.dimensionValues ?? [];
      const rangeName = rangeNameOf(row);
      const date = formatGaDate(dimensionValues[0]?.value ?? "");
      const audienceDisplayName = dimensionValues[1]?.value ?? "";
      const key = audienceKeyByName.get(audienceDisplayName);
      if (!key) continue;
      const totalUsers = Number(row.metricValues?.[0]?.value ?? 0);

      // Same GA4 date-union padding as the users report above.
      if (rangeName === "current" && date >= startDate && date <= endDate) {
        audienceDaily[key].push({ date, value: totalUsers });
      } else if (
        rangeName === "previous" &&
        date >= previousStartDate &&
        date <= previousEndDate
      ) {
        audiencePrevious[key] += totalUsers;
      }
    }
    (Object.keys(audienceDaily) as Array<"s1" | "s25" | "s6">).forEach((k) =>
      audienceDaily[k].sort((a, b) => (a.date < b.date ? -1 : 1))
    );

    // ---- Conversion axis A: new vs. returning ----
    let currentConvTotal = 0;
    let currentConvNew = 0;
    let previousConvTotal = 0;
    let previousConvNew = 0;

    for (const row of conversionByNewVsReturning.rows ?? []) {
      const dimensionValues = row.dimensionValues ?? [];
      const rangeName = rangeNameOf(row);
      const segment = dimensionValues[0]?.value ?? "";
      const count = Number(row.metricValues?.[0]?.value ?? 0);

      if (rangeName === "current") {
        currentConvTotal += count;
        if (segment === "new") currentConvNew += count;
      } else if (rangeName === "previous") {
        previousConvTotal += count;
        if (segment === "new") previousConvNew += count;
      }
    }
    const currentConvRecurrentes = currentConvTotal - currentConvNew;
    const previousConvRecurrentes = previousConvTotal - previousConvNew;

    // ---- Conversion axis B: session-frequency buckets ----
    const audienceConvCurrent: Record<"s1" | "s25" | "s6", number> = {
      s1: 0,
      s25: 0,
      s6: 0,
    };
    const audienceConvPrevious: Record<"s1" | "s25" | "s6", number> = {
      s1: 0,
      s25: 0,
      s6: 0,
    };

    for (const row of conversionByAudience?.rows ?? []) {
      const dimensionValues = row.dimensionValues ?? [];
      const rangeName = rangeNameOf(row);
      const audienceDisplayName = dimensionValues[0]?.value ?? "";
      const key = audienceKeyByName.get(audienceDisplayName);
      if (!key) continue;
      const count = Number(row.metricValues?.[0]?.value ?? 0);

      if (rangeName === "current") {
        audienceConvCurrent[key] += count;
      } else if (rangeName === "previous") {
        audienceConvPrevious[key] += count;
      }
    }

    const audienceStatus: DataStatus = !audiencesConfigured
      ? "unavailable"
      : audienceBackfilling
      ? "backfilling"
      : "ok";

    const segments: Segment[] = [
      {
        key: "total",
        label: SEGMENT_LABELS.total,
        value: currentTotal,
        percentChange: pctChange(currentTotal, previousTotal),
        daily: totalDaily,
        dataStatus: "ok",
        conversion: {
          value: currentConvTotal,
          percentChange: pctChange(currentConvTotal, previousConvTotal),
          status: "ok",
        },
      },
      {
        key: "nuevos",
        label: SEGMENT_LABELS.nuevos,
        value: currentNuevos,
        percentChange: pctChange(currentNuevos, previousNuevos),
        daily: nuevosDaily,
        dataStatus: "ok",
        conversion: {
          value: currentConvNew,
          percentChange: pctChange(currentConvNew, previousConvNew),
          status: "ok",
        },
      },
      {
        key: "recurrentes",
        label: SEGMENT_LABELS.recurrentes,
        value: currentRecurrentes,
        percentChange: pctChange(currentRecurrentes, previousRecurrentes),
        daily: recurrentesDaily,
        dataStatus: "ok",
        conversion: {
          value: currentConvRecurrentes,
          percentChange: pctChange(
            currentConvRecurrentes,
            previousConvRecurrentes
          ),
          status: "ok",
        },
      },
      {
        key: "s1",
        label: SEGMENT_LABELS.s1,
        value: sumSeries(audienceDaily.s1),
        percentChange: pctChange(sumSeries(audienceDaily.s1), audiencePrevious.s1),
        daily: audienceDaily.s1,
        dataStatus: audienceStatus,
        conversion: {
          value: audienceConvCurrent.s1,
          percentChange: pctChange(audienceConvCurrent.s1, audienceConvPrevious.s1),
          status: audienceStatus,
        },
      },
      {
        key: "s25",
        label: SEGMENT_LABELS.s25,
        value: sumSeries(audienceDaily.s25),
        percentChange: pctChange(sumSeries(audienceDaily.s25), audiencePrevious.s25),
        daily: audienceDaily.s25,
        dataStatus: audienceStatus,
        conversion: {
          value: audienceConvCurrent.s25,
          percentChange: pctChange(audienceConvCurrent.s25, audienceConvPrevious.s25),
          status: audienceStatus,
        },
      },
      {
        key: "s6",
        label: SEGMENT_LABELS.s6,
        value: sumSeries(audienceDaily.s6),
        percentChange: pctChange(sumSeries(audienceDaily.s6), audiencePrevious.s6),
        daily: audienceDaily.s6,
        dataStatus: audienceStatus,
        conversion: {
          value: audienceConvCurrent.s6,
          percentChange: pctChange(audienceConvCurrent.s6, audienceConvPrevious.s6),
          status: audienceStatus,
        },
      },
    ];

    // Anomaly detection per segment (only where we trust the data), then a
    // global top-3 cap on per-anomaly channel enrichment to bound GA4 calls.
    const segmentAnomalies = new Map<SegmentKey, Omit<Anomaly, "channel">[]>();
    for (const segment of segments) {
      if (segment.dataStatus !== "ok") continue;
      segmentAnomalies.set(segment.key, detectAnomalies(segment.daily));
    }

    const allCandidates = [...segmentAnomalies.entries()].flatMap(
      ([key, list]) => list.map((a) => ({ key, anomaly: a }))
    );
    allCandidates.sort((a, b) => b.anomaly.deviationScore - a.anomaly.deviationScore);
    const toEnrich = new Set(allCandidates.slice(0, 3).map((c) => `${c.key}:${c.anomaly.date}:${c.anomaly.kind}`));

    const enrichedBySegment = new Map<SegmentKey, Anomaly[]>();
    await Promise.all(
      [...segmentAnomalies.entries()].map(async ([key, list]) => {
        const enriched = await Promise.all(
          list.map(async (candidate) => {
            const shouldEnrich = toEnrich.has(
              `${key}:${candidate.date}:${candidate.kind}`
            );
            return {
              ...candidate,
              channel: shouldEnrich
                ? await getTopChannelForDate(analyticsDataClient, property, candidate.date)
                : null,
            };
          })
        );
        enrichedBySegment.set(key, enriched);
      })
    );

    const blocks: MetricBlock[] = segments
      .filter((s) => s.dataStatus !== "unavailable")
      .map((segment) => ({
        name: segment.label,
        totalValue: segment.value,
        percentChange: segment.percentChange,
        anomalies: enrichedBySegment.get(segment.key) ?? [],
        conversion:
          segment.conversion.status !== "unavailable"
            ? {
                value: segment.conversion.value,
                percentChange: segment.conversion.percentChange,
              }
            : undefined,
        note:
          segment.dataStatus === "backfilling"
            ? `Este segmento se basa en una audiencia de GA4 creada el ${audienceCreatedDate}; los datos históricos previos a esa fecha no existen (las audiencias no son retroactivas), así que la variación % puede no ser representativa todavía.`
            : undefined,
      }));

    const insights = await generateInsights({ startDate, endDate, blocks });

    return NextResponse.json({
      startDate,
      endDate,
      audienceCreatedDate,
      segments,
      insights,
    });
  } catch (error) {
    console.error("Error fetching GA4 users report:", error);
    return NextResponse.json(
      { error: "No se pudo obtener el reporte de usuarios de Google Analytics" },
      { status: 500 }
    );
  }
}
