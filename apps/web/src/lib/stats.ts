// Pure grouping for the per-tenant "Estadísticas" page. Runs over the RLS
// client (never the service role): every select is narrowed to the active
// tenant, and social_connections — owner/admin-only by policy — is skipped
// for viewers instead of relying on an empty RLS result.
//
// All bucketing happens in Lima time (see labels.ts) with Monday-start
// weeks, and every week between the range start and today is zero-filled so
// a quiet week shows as a gap instead of vanishing from the chart.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@pulso/db/types";
import type { TenantContext } from "./tenant-context";
import { limaDay, limaToday, slotDisplayState, type SlotDisplayState } from "./labels";

export type StatsDays = 7 | 30 | 90;
export const STATS_DAY_OPTIONS: readonly StatsDays[] = [7, 30, 90];

export function parseStatsDays(raw: string | undefined): StatsDays {
  const n = Number(raw);
  return n === 7 || n === 90 ? n : 30;
}

const LOOKAHEAD_DAYS = 30;
const COVERAGE_DAYS = 30;
const MOTOR_HEALTHY_WINDOW_MS = 26 * 60 * 60 * 1000;
const MOTOR_AGENTS = new Set(["planner", "publish", "news"]);
const TOP_LIMIT = 5;
const ERROR_PREFIX_CHARS = 80;

export interface WeekBucket {
  label: string;
  [series: string]: string | number;
}

export interface MixEntry {
  key: string;
  count: number;
}

export interface AttentionSlot {
  id: string;
  date: string;
  publish_hour: number | null;
  theme: string;
  slot_index: number;
  state: SlotDisplayState;
}

export interface StatsSnapshot {
  days: StatsDays;
  today: string;
  since: string;
  tenant: {
    publishHours: number[];
    hitlMode: string;
    maxWeeklyCarousels: number | null;
    geminiShare: number | null;
  };
  /** True once anything has ever gone out in the period — drives the empty state. */
  hasPublished: boolean;
  totals: { planned: number; published: number; upcoming7: number };
  publishedByWeek: WeekBucket[];
  byPlatformByWeek: WeekBucket[];
  formatMix: MixEntry[];
  originMix: MixEntry[];
  photoSourceMix: MixEntry[];
  funnel: { planned: number; withPiece: number; approved: number; published: number };
  attention: AttentionSlot[];
  coverage: { filledDays: number; totalDays: number; pct: number; tardeFill: { filled: number; total: number } | null };
  news: {
    pending: number;
    used: number;
    dismissed: number;
    byWeek: WeekBucket[];
    topSources: { name: string; count: number }[];
  };
  topPublishErrors: { message: string; count: number }[];
  motor: { lastRunAt: string | null; lastSuccessAt: string | null; healthy: boolean };
  /** null = not visible to this member (viewer) or not connected yet. */
  connection: {
    status: string;
    pageName: string | null;
    instagramUsername: string | null;
    lastVerifiedAt: string | null;
    lastError: string | null;
  } | null;
}

// ─── Calendar-day helpers (YYYY-MM-DD, no timezone drift) ────────────────────

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week that contains `day`. */
function weekStartOf(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

const weekLabelFormatter = new Intl.DateTimeFormat("es-PE", { timeZone: "UTC", day: "numeric", month: "short" });

function weekLabel(weekStart: string): string {
  return weekLabelFormatter.format(new Date(`${weekStart}T12:00:00Z`)).replace(".", "");
}

/** Start-of-day in Lima as an ISO timestamp, for timestamptz filters. */
function limaStartIso(day: string): string {
  return new Date(`${day}T00:00:00-05:00`).toISOString();
}

class WeekBuckets {
  private readonly order: string[] = [];
  private readonly rows = new Map<string, WeekBucket>();

  constructor(since: string, today: string, series: readonly string[]) {
    for (let ws = weekStartOf(since); ws <= today; ws = addDays(ws, 7)) {
      const row: WeekBucket = { label: weekLabel(ws) };
      for (const s of series) row[s] = 0;
      this.order.push(ws);
      this.rows.set(ws, row);
    }
  }

  /** Adds 1 to `series` for the week containing `day`; ignores days outside the range. */
  bump(day: string, series: string): void {
    const row = this.rows.get(weekStartOf(day));
    if (!row) return;
    row[series] = Number(row[series] ?? 0) + 1;
  }

  toArray(): WeekBucket[] {
    const out: WeekBucket[] = [];
    for (const ws of this.order) {
      const row = this.rows.get(ws);
      if (row) out.push(row);
    }
    return out;
  }
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function toMix(counts: Map<string, number>): MixEntry[] {
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

function sourceAgent(source: unknown): string {
  if (source && typeof source === "object" && "agent" in source) {
    const agent = (source as { agent?: unknown }).agent;
    if (typeof agent === "string" && agent) return agent;
  }
  return "planner";
}

function briefPhotoSource(brief: unknown): string | null {
  if (brief && typeof brief === "object" && "photoSource" in brief) {
    const src = (brief as { photoSource?: unknown }).photoSource;
    if (src === "bank" || src === "gemini" || src === "product" || src === "gradient") return src;
  }
  return null;
}

// ─── The snapshot ────────────────────────────────────────────────────────────

export async function getTenantStats(
  supabase: SupabaseClient<Database>,
  ctx: Pick<TenantContext, "tenantId" | "role">,
  days: StatsDays,
): Promise<StatsSnapshot> {
  const today = limaToday();
  const since = addDays(today, -days);
  const sinceIso = limaStartIso(since);
  const horizon = addDays(today, LOOKAHEAD_DAYS);
  const tenantId = ctx.tenantId;
  const canSeeConnection = ctx.role !== "viewer";

  const [
    { data: slots },
    { data: publications },
    { data: news },
    { data: runs },
    { data: tenant },
    { data: creatives },
    connectionResult,
  ] = await Promise.all([
    supabase
      .from("content_calendar")
      .select(
        "id, date, slot_index, publish_hour, slot_type, status, published_at, hold_publish, source, creative_id, theme, creatives!content_calendar_creative_id_fkey(status, type)",
      )
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .lte("date", horizon)
      .order("date")
      .order("slot_index"),
    supabase
      .from("publications")
      .select("platform, status, published_at, created_at, error_message")
      .eq("tenant_id", tenantId)
      .or(`published_at.gte.${sinceIso},created_at.gte.${sinceIso}`),
    // Every pending idea (so the "Ver ideas pendientes (N)" link matches
    // /news) plus whatever was decided inside the period.
    supabase
      .from("news_suggestions")
      .select("status, created_at, source_name")
      .eq("tenant_id", tenantId)
      .or(`status.eq.pending,created_at.gte.${sinceIso}`),
    supabase
      .from("agent_runs")
      .select("agent, trigger, status, started_at")
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      .limit(60),
    supabase
      .from("tenants")
      .select("publish_hours, hitl_mode, max_weekly_carousels, gemini_share")
      .eq("id", tenantId)
      .maybeSingle(),
    supabase
      .from("creatives")
      .select("brief, created_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", sinceIso),
    canSeeConnection
      ? supabase
          .from("social_connections")
          .select("status, page_name, instagram_username, last_verified_at, last_error")
          .eq("tenant_id", tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const allSlots = slots ?? [];
  const publishHours = tenant?.publish_hours ?? [];
  const hasTarde = publishHours.length > 1;
  // Keyed by slot_index rather than a fixed "manana"/"tarde" pair — a tenant
  // can run up to 4 daily slots (tenants.publish_hours), and the old pair
  // silently merged every slot past the second into "tarde" and dropped its
  // hour from the chart. Page-level labels come from publishHours itself.
  const dayPartCount = Math.max(publishHours.length, 1);
  const dayPartKeys = Array.from({ length: dayPartCount }, (_, i) => `daypart${i}`);

  // ── Slots in the period (past + today), the base for mixes and the funnel
  const periodSlots = allSlots.filter((s) => s.date <= today && s.status !== "skipped");

  const funnel = { planned: periodSlots.length, withPiece: 0, approved: 0, published: 0 };
  for (const slot of periodSlots) {
    const state = slotDisplayState(slot, slot.creatives, today);
    const creativeStatus = slot.creatives?.status ?? null;
    const hasPiece =
      state.key === "review" ||
      state.key === "ready" ||
      state.key === "overdue" ||
      state.key === "published" ||
      (state.key === "held" && (creativeStatus === "ready" || creativeStatus === "approved"));
    const isApproved =
      state.key === "ready" ||
      state.key === "overdue" ||
      state.key === "published" ||
      (state.key === "held" && creativeStatus === "approved");
    if (hasPiece) funnel.withPiece++;
    if (isApproved) funnel.approved++;
    if (state.key === "published") funnel.published++;
  }

  // ── Published pieces per week, split by daypart
  const publishedBuckets = new WeekBuckets(since, today, dayPartKeys);
  let publishedCount = 0;
  for (const slot of allSlots) {
    if (!slot.published_at) continue;
    const day = limaDay(slot.published_at);
    if (day < since || day > today) continue;
    publishedCount++;
    const idx = slot.slot_index != null && slot.slot_index < dayPartCount ? slot.slot_index : 0;
    publishedBuckets.bump(day, dayPartKeys[idx]!);
  }

  // ── Per platform per week ("scheduled" on Facebook is as good as published)
  const platformBuckets = new WeekBuckets(since, today, ["facebook", "instagram"]);
  const failedErrors = new Map<string, number>();
  let platformCount = 0;
  for (const pub of publications ?? []) {
    if (pub.status === "published" || pub.status === "scheduled") {
      const at = pub.published_at ?? pub.created_at;
      const day = limaDay(at);
      // Matches publishedBuckets' guard above — without it, a 'scheduled'
      // row (published_at still null, so `at` falls back to created_at)
      // lands in whichever week it was created, not the week it actually
      // goes out, inflating an in-range bar with future activity.
      if (day < since || day > today) continue;
      platformBuckets.bump(day, pub.platform === "instagram" ? "instagram" : "facebook");
      platformCount++;
    } else if (pub.status === "failed" && pub.error_message) {
      const key = pub.error_message.trim().slice(0, ERROR_PREFIX_CHARS);
      failedErrors.set(key, (failedErrors.get(key) ?? 0) + 1);
    }
  }

  // ── Attention: anything the owner has to act on, past or future
  const attention: AttentionSlot[] = [];
  for (const slot of allSlots) {
    const state = slotDisplayState(slot, slot.creatives, today);
    if (state.key === "overdue" || state.key === "failed" || state.key === "review") {
      attention.push({
        id: slot.id,
        date: slot.date,
        publish_hour: slot.publish_hour,
        theme: slot.theme,
        slot_index: slot.slot_index,
        state,
      });
    }
  }

  // ── Next 7 days: approved slot + approved creative, not held, not out yet
  const weekEnd = addDays(today, 6);
  const upcoming7 = allSlots.filter(
    (s) =>
      s.date >= today &&
      s.date <= weekEnd &&
      s.status === "approved" &&
      s.creatives?.status === "approved" &&
      !s.hold_publish &&
      !s.published_at,
  ).length;

  // ── Coverage of the next 30 days
  const coverageEnd = addDays(today, COVERAGE_DAYS - 1);
  const mananaDays = new Set<string>();
  const tardeDays = new Set<string>();
  for (const slot of allSlots) {
    if (slot.date < today || slot.date > coverageEnd || slot.status === "skipped") continue;
    if (slot.slot_index === 0) mananaDays.add(slot.date);
    else tardeDays.add(slot.date);
  }
  const coverage = {
    filledDays: mananaDays.size,
    totalDays: COVERAGE_DAYS,
    pct: Math.round((mananaDays.size / COVERAGE_DAYS) * 100),
    tardeFill: hasTarde ? { filled: tardeDays.size, total: COVERAGE_DAYS } : null,
  };

  // ── News
  const newsRows = news ?? [];
  const newsBuckets = new WeekBuckets(since, today, ["usadas", "descartadas", "pendientes"]);
  let pending = 0;
  let used = 0;
  let dismissed = 0;
  const inPeriodNews: typeof newsRows = [];
  for (const n of newsRows) {
    if (n.status === "pending") pending++;
    const day = limaDay(n.created_at);
    if (day < since) continue;
    inPeriodNews.push(n);
    if (n.status === "used") {
      used++;
      newsBuckets.bump(day, "usadas");
    } else if (n.status === "dismissed") {
      dismissed++;
      newsBuckets.bump(day, "descartadas");
    } else if (n.status === "pending") {
      newsBuckets.bump(day, "pendientes");
    }
  }
  const topSources = [...countBy(inPeriodNews, (n) => n.source_name?.trim()).entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_LIMIT);

  // ── Motor: a successful planner/publish/news run in the last 26h
  const now = Date.now();
  let lastRunAt: string | null = null;
  let lastSuccessAt: string | null = null;
  for (const run of runs ?? []) {
    if (!lastRunAt) lastRunAt = run.started_at;
    if (!lastSuccessAt && run.status === "succeeded" && MOTOR_AGENTS.has(run.agent)) {
      lastSuccessAt = run.started_at;
    }
  }
  const healthy = lastSuccessAt !== null && now - Date.parse(lastSuccessAt) <= MOTOR_HEALTHY_WINDOW_MS;

  const connectionRow = connectionResult.data;
  const connection = connectionRow
    ? {
        status: connectionRow.status,
        pageName: connectionRow.page_name,
        instagramUsername: connectionRow.instagram_username,
        lastVerifiedAt: connectionRow.last_verified_at,
        lastError: connectionRow.last_error,
      }
    : null;

  return {
    days,
    today,
    since,
    tenant: {
      publishHours,
      hitlMode: tenant?.hitl_mode ?? "approve-all",
      maxWeeklyCarousels: tenant?.max_weekly_carousels ?? null,
      geminiShare: tenant?.gemini_share ?? null,
    },
    hasPublished: publishedCount > 0 || platformCount > 0,
    totals: { planned: periodSlots.length, published: publishedCount, upcoming7 },
    publishedByWeek: publishedBuckets.toArray(),
    byPlatformByWeek: platformBuckets.toArray(),
    formatMix: toMix(countBy(periodSlots, (s) => s.slot_type)),
    originMix: toMix(countBy(periodSlots, (s) => sourceAgent(s.source))),
    photoSourceMix: toMix(countBy(creatives ?? [], (c) => briefPhotoSource(c.brief))),
    funnel,
    attention: attention.sort((a, b) => (a.date === b.date ? a.slot_index - b.slot_index : a.date < b.date ? -1 : 1)),
    coverage,
    news: { pending, used, dismissed, byWeek: newsBuckets.toArray(), topSources },
    topPublishErrors: [...failedErrors.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_LIMIT),
    motor: { lastRunAt, lastSuccessAt, healthy },
    connection,
  };
}
