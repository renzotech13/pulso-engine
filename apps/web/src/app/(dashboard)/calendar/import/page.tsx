import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { PageHeader } from "@/components/ui/page-header";
import { ImportThemesForm } from "./import-form";

export default async function CalendarImportPage() {
  const ctx = await getTenantContext();

  return (
    <div className="space-y-6">
      <Link href="/calendar" className="inline-flex items-center gap-1 text-sm text-fg-3 hover:text-fg">
        <ChevronLeft size={14} aria-hidden="true" />
        Volver al calendario
      </Link>

      <PageHeader
        eyebrow={ctx.tenantName}
        title="Importar cronograma"
        description="Subí un HTML con tu cronograma (fecha, tipo, tema) — se reparte en el calendario y se pide el copy e imagen de cada uno, sin pasar por el Planner."
      />

      <ImportThemesForm tenantId={ctx.tenantId} />
    </div>
  );
}
