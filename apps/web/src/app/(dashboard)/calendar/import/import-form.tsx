"use client";

import Link from "next/link";
import { useActionState } from "react";
import { calendarImportAction, type CalendarImportState } from "@/lib/actions";
import { SLOT_TYPE } from "@/lib/labels";
import { SubmitButton } from "@/components/submit-button";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const INITIAL_STATE: CalendarImportState = { step: "start", error: null, rows: [], rowErrors: [], result: null };

export function ImportThemesForm({ tenantId }: { tenantId: string }) {
  const [state, formAction] = useActionState(calendarImportAction, INITIAL_STATE);

  if (state.step === "done") {
    return (
      <Card>
        <p className="text-sm text-fg">
          Importado: {state.result?.created ?? 0} {(state.result?.created ?? 0) === 1 ? "día creado" : "días creados"}
          {", "}
          {state.result?.updated ?? 0}{" "}
          {(state.result?.updated ?? 0) === 1 ? "día actualizado" : "días actualizados"}.
        </p>
        <p className="mt-1 text-sm text-fg-3">
          El copy y la imagen de cada uno se generan solos si tus servicios locales (Planner/Creative) están
          corriendo — puede tardar 1-3 minutos por día.
        </p>
        <Link href="/calendar" className={buttonClass("primary", "sm", "mt-3")}>
          Volver al calendario
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="intent" value="preview" />
          <div>
            <label htmlFor="import-file" className="eyebrow mb-1.5 block text-fg-3">
              Archivo HTML
            </label>
            <input
              id="import-file"
              type="file"
              name="file"
              accept=".html,text/html"
              required
              className="block w-full text-sm text-fg-2 file:mr-3 file:rounded-btn file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-fg"
            />
          </div>
          {state.error && <p className="text-sm text-danger">{state.error}</p>}
          <SubmitButton variant="primary" size="sm" pendingText="Leyendo…">
            Previsualizar
          </SubmitButton>
        </form>
      </Card>

      {state.rowErrors.length > 0 && (
        <Card>
          <p className="eyebrow mb-2 text-danger">Filas con error ({state.rowErrors.length})</p>
          <ul className="space-y-1 text-sm text-danger">
            {state.rowErrors.map((e, i) => (
              <li key={i}>
                Fila {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {state.step === "preview" && state.rows.length > 0 && (
        <Card>
          <p className="mb-3 text-sm text-fg-2">
            {state.rows.length} {state.rows.length === 1 ? "tema listo" : "temas listos"} para importar.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-3">
                  <th className="py-1 pr-3 font-normal">Fecha</th>
                  <th className="py-1 pr-3 font-normal">Tipo</th>
                  <th className="py-1 pr-3 font-normal">Tema</th>
                  <th className="py-1 pr-3 font-normal">Reemplaza</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((r) => (
                  <tr key={r.date} className="border-t border-line">
                    <td className="tnum py-1.5 pr-3">{r.date}</td>
                    <td className="py-1.5 pr-3 text-fg-2">{SLOT_TYPE[r.slotType]}</td>
                    <td className="py-1.5 pr-3">{r.theme}</td>
                    <td className="py-1.5 pr-3 text-fg-3">{r.existingTheme ? `"${r.existingTheme}"` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={formAction} className="mt-4">
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="intent" value="confirm" />
            <input
              type="hidden"
              name="rows"
              value={JSON.stringify(state.rows.map(({ existingTheme: _existingTheme, ...r }) => r))}
            />
            <SubmitButton
              variant="primary"
              size="sm"
              pendingText="Importando…"
              confirmMessage="Se va a crear/sobrescribir el calendario con estos temas y se va a pedir el copy e imagen de cada uno. ¿Continuar?"
            >
              Confirmar importación
            </SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
