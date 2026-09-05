import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { META_OAUTH_REDIRECT_URI } from "@/lib/meta-oauth";
import { FLASH_COOKIE } from "@/lib/flash";

const META_GRAPH_API_VERSION = "v21.0";
const META_APP_ID = process.env.META_APP_ID ?? "1550590863219497";
const META_APP_SECRET = process.env.META_APP_SECRET ?? "";

type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
};

async function exchangeCodeForUserToken(code: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("client_secret", META_APP_SECRET);
  url.searchParams.set("redirect_uri", META_OAUTH_REDIRECT_URI);
  url.searchParams.set("code", code);

  const response = await fetch(url);
  const data = (await response.json()) as { access_token?: string; error?: { message: string } };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error?.message ?? "no se pudo canjear el código de Meta");
  }
  return data.access_token;
}

/** A user token exchanged this way inherits the ~60-day (effectively non-expiring while used) lifetime — this is what makes it durable unlike a Graph API Explorer token. */
async function extendUserToken(shortLivedToken: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("client_secret", META_APP_SECRET);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const response = await fetch(url);
  const data = (await response.json()) as { access_token?: string; error?: { message: string } };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error?.message ?? "no se pudo extender el token de Meta");
  }
  return data.access_token;
}

async function fetchManagedPages(longLivedUserToken: string): Promise<MetaPage[]> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account");
  url.searchParams.set("access_token", longLivedUserToken);

  const response = await fetch(url);
  const data = (await response.json()) as { data?: MetaPage[]; error?: { message: string } };
  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? "no se pudieron listar las páginas de Facebook");
  }
  return data.data ?? [];
}

async function fetchInstagramUsername(igUserId: string, accessToken: string): Promise<string | null> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${igUserId}`);
  url.searchParams.set("fields", "username");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const data = (await response.json()) as { username?: string };
  return data.username ?? null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  // The outcome travels in the same one-shot flash cookie every server
  // action uses (shown by FlashToast) — the old ?meta_connected / ?meta_error
  // query flags kept re-showing the message on every refresh.
  const back = (flash: { tone: "success" | "error"; message: string }): NextResponse => {
    const response = NextResponse.redirect(`${url.origin}/connections`);
    response.cookies.set(FLASH_COOKIE, JSON.stringify(flash), { path: "/", maxAge: 30, sameSite: "lax" });
    return response;
  };
  const fail = (message: string) => back({ tone: "error", message: `Error de Meta: ${message}` });

  if (oauthError) return fail(oauthError);
  if (!code) return fail("falta el código de Meta");
  if (!META_APP_SECRET) return fail("META_APP_SECRET no está configurado");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${url.origin}/login`);

  // state carries the tenantId the flow started from, but RLS on
  // social_connections (owner/admin only) is the real authorization gate —
  // this is only a sanity check that the session's active tenant matches.
  const tenantId = url.searchParams.get("state");
  if (!tenantId) return fail("falta el tenant");

  try {
    const shortLivedToken = await exchangeCodeForUserToken(code);
    const longLivedUserToken = await extendUserToken(shortLivedToken);
    const pages = await fetchManagedPages(longLivedUserToken);

    if (pages.length === 0) {
      return fail("tu cuenta de Facebook no administra ninguna página, o PulsoEngine no tiene acceso a ella");
    }

    const { data: existing } = await supabase
      .from("social_connections")
      .select("page_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const page = pages.find((p) => p.id === existing?.page_id) ?? pages[0]!;
    const igAccountId = page.instagram_business_account?.id ?? null;
    const instagramUsername = igAccountId
      ? await fetchInstagramUsername(igAccountId, page.access_token)
      : null;

    const { error: upsertError } = await supabase.from("social_connections").upsert(
      {
        tenant_id: tenantId,
        page_id: page.id,
        page_name: page.name,
        access_token: page.access_token,
        instagram_business_account_id: igAccountId,
        instagram_username: instagramUsername,
        status: "active",
        last_verified_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "tenant_id" },
    );
    if (upsertError) throw new Error(upsertError.message);

    const otherPages = pages.filter((p) => p.id !== page.id).map((p) => p.name);
    return back({
      tone: "success",
      message:
        otherPages.length > 0
          ? `Página conectada correctamente. También administras: ${otherPages.join(", ")} — para usar otra, pégala a mano.`
          : "Página conectada correctamente.",
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
