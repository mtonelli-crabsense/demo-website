import PlaceholderSheet from "@/components/PlaceholderSheet";

export default function PodcastVideoPage() {
  return (
    <PlaceholderSheet
      eyebrow="Contenido (GA4)"
      title="Podcast / Video"
      description="Consumo de contenido audiovisual: reproducciones, duración promedio y conversión."
      stats={[
        { label: "Reproducciones (30 días)", value: "9.1K" },
        { label: "Duración prom.", value: "8m 40s" },
      ]}
    />
  );
}
