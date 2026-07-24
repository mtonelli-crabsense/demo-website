import PlaceholderSheet from "@/components/PlaceholderSheet";

export default function TematicasPage() {
  return (
    <PlaceholderSheet
      eyebrow="Contenido (GA4)"
      title="Temáticas"
      description="Agrupación de artículos por categoría/tema y su performance relativa."
      stats={[
        { label: "Temática líder", value: "Mercados" },
        { label: "Crecimiento vs. mes anterior", value: "+14%" },
      ]}
    />
  );
}
