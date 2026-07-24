import Anthropic from "@anthropic-ai/sdk";
import { Anomaly } from "./ga4-anomalies";

export type InsightSeverity = "positive" | "warning" | "negative";
export type InsightWeight = "peak" | "normal";

export type Insight = {
  text: string;
  shortText: string;
  severity: InsightSeverity;
  weight: InsightWeight;
};

export type MetricBlock = {
  name: string;
  totalValue: number;
  percentChange: number;
  anomalies: Anomaly[];
  conversion?: { value: number; percentChange: number };
  note?: string;
};

const INSIGHTS_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          shortText: { type: "string" },
          severity: {
            type: "string",
            enum: ["positive", "warning", "negative"],
          },
          weight: {
            type: "string",
            enum: ["peak", "normal"],
          },
        },
        required: ["text", "shortText", "severity", "weight"],
        additionalProperties: false,
      },
    },
  },
  required: ["insights"],
  additionalProperties: false,
} as const;

function formatAnomaly(a: Anomaly): string {
  const label = a.kind === "peak" ? "Pico" : "Valle";
  const channelText = a.channel
    ? `, explicado principalmente por el canal "${a.channel}"`
    : "";
  return `- ${label} el ${a.date}: ${a.value.toLocaleString("es-AR")}${channelText}`;
}

function buildBlockSection(input: {
  startDate: string;
  endDate: string;
  block: MetricBlock;
}): string {
  const { block } = input;
  const anomaliesText = block.anomalies.length
    ? block.anomalies.map(formatAnomaly).join("\n")
    : "  Sin picos ni valles significativos.";
  const conversionText = block.conversion
    ? `\n  Conversión (newsletter) del período: ${block.conversion.value.toLocaleString(
        "es-AR"
      )} (${block.conversion.percentChange > 0 ? "+" : ""}${
        block.conversion.percentChange
      }% vs. período anterior)`
    : "";

  const noteText = block.note ? `\n  Nota: ${block.note}` : "";

  return `Métrica "${block.name}":
  Total del período: ${block.totalValue.toLocaleString("es-AR")}
  Variación vs. período anterior: ${block.percentChange > 0 ? "+" : ""}${block.percentChange}%${conversionText}${noteText}
  Eventos destacados:
${anomaliesText}`;
}

// Cross-metric correlation: dates where 2+ blocks have an anomaly on the same
// day are worth calling out explicitly (e.g. a new-users spike coinciding
// with a returning-users dip), since that's a stronger signal than either
// anomaly in isolation.
function buildSameDaySection(blocks: MetricBlock[]): string {
  const byDate = new Map<string, { blockName: string; anomaly: Anomaly }[]>();
  for (const block of blocks) {
    for (const anomaly of block.anomalies) {
      const list = byDate.get(anomaly.date) ?? [];
      list.push({ blockName: block.name, anomaly });
      byDate.set(anomaly.date, list);
    }
  }

  const multiMetricDates = [...byDate.entries()].filter(
    ([, entries]) => entries.length >= 2
  );
  if (multiMetricDates.length === 0) return "";

  const lines = multiMetricDates.map(([date, entries]) => {
    const parts = entries
      .map(
        (e) =>
          `${e.blockName} (${e.anomaly.kind === "peak" ? "pico" : "valle"} ${e.anomaly.value.toLocaleString(
            "es-AR"
          )})`
      )
      .join(" y ");
    return `- ${date}: ${parts} ocurrieron el mismo día.`;
  });

  return `\n\nCoincidencias el mismo día entre métricas (señal más fuerte que un pico aislado):\n${lines.join(
    "\n"
  )}`;
}

function buildInsightsPrompt(input: {
  startDate: string;
  endDate: string;
  blocks: MetricBlock[];
}): string {
  const { startDate, endDate, blocks } = input;
  const blocksText = blocks
    .map((block) => buildBlockSection({ startDate, endDate, block }))
    .join("\n\n");
  const sameDayText = buildSameDaySection(blocks);

  return `Sos un analista de datos de un sitio de noticias financieras. Analizá el desempeño de las siguientes métricas para el período del ${startDate} al ${endDate}, comparado contra el período inmediatamente anterior de igual duración.

${blocksText}${sameDayText}

Generá entre 3 y 8 insights breves en español. Cada insight debe ser una oración corta y concreta que mencione un dato específico (el total, la variación porcentual, un pico/valle puntual, o la conversión a newsletter de ese segmento) y, si aplica, el canal de adquisición responsable. Priorizá señalar relaciones entre métricas cuando existan coincidencias el mismo día.

Para cada insight generá dos versiones del mismo texto:
- "text": la oración completa como se describió arriba.
- "shortText": una versión de una sola línea (máximo ~90 caracteres) del mismo insight, que conserve el dato numérico más importante (el porcentaje o el valor absoluto principal) y descarte la cláusula secundaria o la aclaración. No es un resumen distinto ni agrega información nueva — es el mismo insight, más corto.

Clasificá cada insight con:
- "severity": "positive" (buena noticia), "warning" (algo para monitorear sin ser grave) o "negative" (mala noticia o caída relevante).
- "weight": "peak" SOLO para el/los insights anclados directamente a uno de los picos o valles listados arriba como "Eventos destacados" (como mucho 2 insights con weight "peak" en total, los más pronunciados) — el resto de los insights, aunque sean relevantes, van con weight "normal". No marques "peak" para variaciones moderadas o esperables.

Si no hay variaciones destacables en ningún lado, devolvé un array vacío en "insights".`;
}

export async function generateInsights(input: {
  startDate: string;
  endDate: string;
  blocks: MetricBlock[];
}): Promise<Insight[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1536,
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
