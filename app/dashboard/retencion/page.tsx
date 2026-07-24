import PlaceholderSheet from "@/components/PlaceholderSheet";

export default function RetencionPage() {
  return (
    <PlaceholderSheet
      eyebrow="Audiencia (GA4)"
      title="Retención"
      description="Cohortes de usuarios y su tasa de retorno a lo largo del tiempo."
      stats={[
        { label: "Retención semana 1", value: "38%" },
        { label: "Retención semana 4", value: "17%" },
      ]}
    />
  );
}
