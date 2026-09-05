// Spanish labels for every raw DB enum the dashboard used to print as-is
// (draft/approved/skipped, post/carousel, succeeded, dispatched…), plus the
// ONE vocabulary for "what state is this day's piece in" — shared by the
// calendar grid dots, the list badges, the day page and the stats funnel.

import type { StatusTone } from "@/components/ui/status-badge";

export const SLOT_TYPE: Record<string, string> = {
  post: "Publicación",
  carousel: "Carrusel",
  story: "Historia",
  reel: "Reel",
};

export const SLOT_STATUS: Record<string, string> = {
  draft: "Borrador",
  approved: "Aprobado",
  skipped: "Omitido",
};

export const CREATIVE_STATUS: Record<string, string> = {
  pending: "En cola",
  rendering: "Generando",
  ready: "Por revisar",
  approved: "Aprobada",
  failed: "Falló",
};

export const PUB_STATUS: Record<string, string> = {
  pending: "Enviando",
  scheduled: "Programada",
  published: "Publicada",
  failed: "Falló",
};

export const PLATFORM: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
};

export const AGENT: Record<string, string> = {
  planner: "Planificador",
  creative: "Creativo",
  publish: "Publicador",
  news: "Noticias",
  hello: "Latido",
  orchestrator: "Orquestador",
};

export const HITL_MODE: Record<string, string> = {
  "approve-all": "Todo manual",
  "approve-creatives": "Apruebo cada pieza",
  "full-auto": "Automático",
};

export const ORIGIN: Record<string, string> = {
  planner: "Planificador",
  news: "Noticias",
  manual: "Manual",
};

export const PHOTO_SOURCE: Record<string, string> = {
  product: "Foto del catálogo",
  bank: "Foto del banco",
  gemini: "Imagen generada",
  gradient: "Solo degradado",
};

export const BRIEF_KEYS: Record<string, string> = {
  headline: "Titular",
  subheadline: "Subtítulo",
  priceLabel: "Precio",
  message: "Mensaje",
  caption: "Caption",
};

export function label(map: Record<string, string>, raw: string | null | undefined): string {
  if (!raw) return "";
  return map[raw] ?? raw;
}

export const SELECT_OPTIONS = {
  slotType: Object.entries(SLOT_TYPE).map(([value, text]) => ({ value, text })),
  slotStatus: Object.entries(SLOT_STATUS).map(([value, text]) => ({ value, text })),
  hitlMode: Object.entries(HITL_MODE).map(([value, text]) => ({ value, text })),
};

export interface SlotDisplayState {
  key:
    | "skipped"
    | "held"
    | "published"
    | "no_creative"
    | "queued"
    | "failed"
    | "generating"
    | "review"
    | "overdue"
    | "ready";
  label: string;
  tone: StatusTone;
}

/**
 * The single answer to "what's going on with this slot?", in priority order.
 * `today` is a Lima YYYY-MM-DD (see limaToday).
 */
export function slotDisplayState(
  slot: {
    status: string;
    hold_publish: boolean;
    published_at: string | null;
    date: string;
    creative_id: string | null;
  },
  creative: { status: string } | null,
  today: string,
): SlotDisplayState {
  if (slot.status === "skipped") return { key: "skipped", label: "Omitido", tone: "grey" };
  if (slot.published_at) return { key: "published", label: "Publicada", tone: "green" };
  if (slot.hold_publish) return { key: "held", label: "En pausa", tone: "orange" };
  if (!slot.creative_id || !creative) {
    return slot.status === "approved"
      ? { key: "queued", label: "En cola", tone: "blue" }
      : { key: "no_creative", label: "Sin pieza", tone: "grey" };
  }
  if (creative.status === "failed") return { key: "failed", label: "Falló", tone: "pink" };
  if (creative.status === "pending" || creative.status === "rendering") {
    return { key: "generating", label: "Generando", tone: "blue" };
  }
  if (creative.status === "ready") return { key: "review", label: "Por revisar", tone: "orange" };
  if (slot.date < today) return { key: "overdue", label: "Sin publicar", tone: "pink" };
  return { key: "ready", label: "Lista", tone: "green" };
}

// ─── Lima-time formatters ────────────────────────────────────────────────────

const LIMA = "America/Lima";
const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: LIMA, year: "numeric", month: "2-digit", day: "2-digit" });
const dateTimeFormatter = new Intl.DateTimeFormat("es-PE", {
  timeZone: LIMA,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const longDateFormatter = new Intl.DateTimeFormat("es-PE", { timeZone: LIMA, weekday: "long", day: "numeric", month: "long" });

/** YYYY-MM-DD in Lima for an ISO timestamp or Date. */
export function limaDay(value: string | Date): string {
  return dayFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function limaToday(): string {
  return limaDay(new Date());
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

/** "jueves, 5 de septiembre" for a YYYY-MM-DD calendar day. */
export function formatCalendarDay(dateStr: string): string {
  return longDateFormatter.format(new Date(`${dateStr}T12:00:00-05:00`));
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - Date.parse(iso);
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} d`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${seconds % 60} s`;
}
