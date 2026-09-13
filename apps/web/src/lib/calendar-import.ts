/**
 * Parser for the "importar cronograma" HTML upload — deliberately NOT
 * LLM-based. This runs inside a Server Action deployed on Vercel, which has
 * no route to the local LM Studio the rest of the app's copy generation
 * depends on (see packages/shared/src/llm.ts, reachable only from the
 * tenant's own Mac). A fixed table format parsed with plain string ops
 * works the same in local dev and in production, with no external service.
 *
 * Expected shape: an HTML table with columns Fecha | Tipo | Tema | Notas
 * (Tipo and Notas optional). A row whose first cell isn't a YYYY-MM-DD date
 * is treated as a header/label row and skipped silently, so callers don't
 * need to match a specific header string.
 */

export type ImportSlotType = "post" | "carousel" | "story" | "reel";

export const IMPORT_SLOT_TYPES: readonly ImportSlotType[] = ["post", "carousel", "story", "reel"];

const SLOT_TYPE_ALIASES: Record<string, ImportSlotType> = {
  post: "post",
  publicacion: "post",
  publicación: "post",
  carousel: "carousel",
  carrusel: "carousel",
  story: "story",
  historia: "story",
  reel: "reel",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ImportRow {
  row: number; // 1-based, counting only data rows (header excluded)
  date: string;
  slotType: ImportSlotType;
  theme: string;
  notes?: string;
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportParseResult {
  rows: ImportRow[];
  errors: ImportRowError[];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cellText(cellHtml: string): string {
  const inner = cellHtml.replace(/^<t[dh][^>]*>/i, "").replace(/<\/t[dh]>$/i, "");
  return decodeEntities(inner.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCalendarImportHtml(html: string): ImportParseResult {
  const rows: ImportRow[] = [];
  const errors: ImportRowError[] = [];
  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  let dataRowNumber = 0;
  for (const trHtml of trMatches) {
    const cellMatches = trHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [];
    if (cellMatches.length === 0) continue;
    const cells = cellMatches.map(cellText);

    const [rawDate, rawType, rawTheme, rawNotes] = cells;
    if (!rawDate || !DATE_RE.test(rawDate)) continue; // header or separator row

    dataRowNumber += 1;

    if (!rawTheme || rawTheme.length < 3) {
      errors.push({ row: dataRowNumber, message: `${rawDate}: falta el tema (mínimo 3 caracteres).` });
      continue;
    }

    const typeKey = (rawType ?? "post").trim().toLowerCase();
    const slotType = typeKey ? SLOT_TYPE_ALIASES[typeKey] : "post";
    if (typeKey && !slotType) {
      errors.push({
        row: dataRowNumber,
        message: `${rawDate}: tipo "${rawType}" no reconocido (usá post, carousel, story o reel).`,
      });
      continue;
    }

    rows.push({
      row: dataRowNumber,
      date: rawDate,
      slotType: slotType ?? "post",
      theme: rawTheme,
      ...(rawNotes ? { notes: rawNotes } : {}),
    });
  }

  return { rows, errors };
}

/** Defensive re-validation for the client-echoed JSON at confirm time (see calendarImportAction). */
export function isValidImportRow(value: unknown): value is ImportRow {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.date === "string" &&
    DATE_RE.test(r.date) &&
    typeof r.slotType === "string" &&
    (IMPORT_SLOT_TYPES as readonly string[]).includes(r.slotType) &&
    typeof r.theme === "string" &&
    r.theme.trim().length >= 3
  );
}
