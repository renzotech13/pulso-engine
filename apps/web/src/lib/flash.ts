import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";

// One-shot feedback after a server action. Before this, every action ended
// in a silent revalidatePath — nothing told the owner "saved", and a thrown
// error became Next's generic crash page with the real message redacted.

export type FlashTone = "success" | "error" | "info";

export interface Flash {
  tone: FlashTone;
  message: string;
}

export const FLASH_COOKIE = "pulso-flash";

export async function setFlash(flash: Flash): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, JSON.stringify(flash), { path: "/", maxAge: 30, sameSite: "lax" });
}

export async function readFlash(): Promise<Flash | null> {
  const raw = (await cookies()).get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Flash>;
    if (
      typeof parsed.message === "string" &&
      (parsed.tone === "success" || parsed.tone === "error" || parsed.tone === "info")
    ) {
      return { tone: parsed.tone, message: parsed.message };
    }
  } catch {
    // a stale or foreign cookie: ignore it
  }
  return null;
}

export async function clearFlash(): Promise<void> {
  (await cookies()).delete(FLASH_COOKIE);
}

/**
 * Wraps a void server action: success → flash the message (when given);
 * failure → flash the error and return instead of crashing the page.
 * Redirects and notFound() still propagate (unstable_rethrow).
 */
export function withFeedback(
  successMessage: string | null,
  action: (formData: FormData) => Promise<void>,
): (formData: FormData) => Promise<void> {
  return async (formData: FormData) => {
    try {
      await action(formData);
    } catch (err) {
      unstable_rethrow(err);
      await setFlash({ tone: "error", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (successMessage) await setFlash({ tone: "success", message: successMessage });
  };
}
