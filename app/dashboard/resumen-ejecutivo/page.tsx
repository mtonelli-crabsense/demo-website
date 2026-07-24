import PlaceholderSheet from "@/components/PlaceholderSheet";

export default function ResumenEjecutivoPage() {
  return (
    <PlaceholderSheet
      eyebrow="Resumen Ejecutivo"
      title="Resumen Ejecutivo"
      description="Vista consolidada de performance editorial y comercial del sitio."
      stats={[
        { label: "Usuarios (30 días)", value: "128.4K" },
        { label: "Suscripciones newsletter", value: "88" },
        { label: "Artículos publicados", value: "142" },
      ]}
    />
  );
}
