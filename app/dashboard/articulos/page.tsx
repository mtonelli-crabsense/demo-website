import PlaceholderSheet from "@/components/PlaceholderSheet";

export default function ArticulosPage() {
  return (
    <PlaceholderSheet
      eyebrow="Contenido (GA4)"
      title="Artículos"
      description="Performance por artículo: vistas, tiempo de lectura y conversión a newsletter."
      stats={[
        { label: "Artículo más leído", value: "24.7K vistas" },
        { label: "Tiempo prom. de lectura", value: "3m 12s" },
      ]}
    />
  );
}
