import { cookies } from "next/headers";

/**
 * Holds a Facebook OAuth callback's result while the user picks which page
 * to connect, for accounts that manage more than one — without this,
 * connecting a fresh tenant silently grabbed whatever page Meta listed
 * first, which for an agency user managing several businesses' pages under
 * one Facebook account could be a different tenant's page entirely.
 *
 * The long-lived user token (not any page token) is the only secret kept
 * here, scoped short and to this one tenant; page tokens are re-derived
 * from it once the user actually picks a page.
 */
export const META_PENDING_COOKIE = "pulso-meta-pending";

export interface MetaPendingPage {
  id: string;
  name: string;
  hasInstagram: boolean;
}

export interface MetaPendingSelection {
  tenantId: string;
  userToken: string;
  pages: MetaPendingPage[];
}

export async function setMetaPending(selection: MetaPendingSelection): Promise<void> {
  (await cookies()).set(META_PENDING_COOKIE, JSON.stringify(selection), {
    path: "/",
    maxAge: 300,
    sameSite: "lax",
    httpOnly: true,
  });
}

export async function readMetaPending(): Promise<MetaPendingSelection | null> {
  const raw = (await cookies()).get(META_PENDING_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MetaPendingSelection>;
    if (typeof parsed.tenantId === "string" && typeof parsed.userToken === "string" && Array.isArray(parsed.pages)) {
      return { tenantId: parsed.tenantId, userToken: parsed.userToken, pages: parsed.pages as MetaPendingPage[] };
    }
  } catch {
    // a stale or foreign cookie: ignore it
  }
  return null;
}

export async function clearMetaPending(): Promise<void> {
  (await cookies()).delete(META_PENDING_COOKIE);
}
