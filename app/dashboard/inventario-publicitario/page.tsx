import PlaceholderSheet from "@/components/PlaceholderSheet";

export default function InventarioPublicitarioPage() {
  return (
    <PlaceholderSheet
      eyebrow="Comercial (GA4)"
      title="Inventario Publicitario"
      description="Identificación de inventario de alto valor para pauta: secciones y horarios de mayor tráfico calificado."
      stats={[
        { label: "Impresiones estimadas/día", value: "42K" },
        { label: "Sección de mayor valor", value: "Mercados" },
      ]}
    />
  );
}
