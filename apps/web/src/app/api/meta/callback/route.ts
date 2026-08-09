import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const META_GRAPH_API_VERSION = "v21.0";
const META_APP_ID = process.env.META_APP_ID ?? "1550590863219497";
const META_APP_SECRET = process.env.META_APP_SECRET ?? "";

type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
};

function redirectUri(origin: string): string {
  return `${origin}/api/meta/callback`;
}

async function exchangeCodeForUserToken(code: string, origin: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("client_secret", META_APP_SECRET);
  url.searchParams.set("redirect_uri", redirectUri(origin));
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

  const back = (query: string): NextResponse => NextResponse.redirect(`${url.origin}/connections?${query}`);

  if (oauthError) return back(`meta_error=${encodeURIComponent(oauthError)}`);
  if (!code) return back("meta_error=falta%20el%20código%20de%20Meta");
  if (!META_APP_SECRET) return back("meta_error=META_APP_SECRET%20no%20está%20configurado");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${url.origin}/login`);

  // state carries the tenantId the flow started from, but RLS on
  // social_connections (owner/admin only) is the real authorization gate —
  // this is only a sanity check that the session's active tenant matches.
  const tenantId = url.searchParams.get("state");
  if (!tenantId) return back("meta_error=falta%20el%20tenant");

  try {
    const shortLivedToken = await exchangeCodeForUserToken(code, url.origin);
    const longLivedUserToken = await extendUserToken(shortLivedToken);
    const pages = await fetchManagedPages(longLivedUserToken);

    if (pages.length === 0) {
      return back(
        "meta_error=" +
          encodeURIComponent(
            "tu cuenta de Facebook no administra ninguna página, o PulsoEngine no tiene acceso a ella",
          ),
      );
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
    const hint = otherPages.length > 0 ? `&meta_other_pages=${encodeURIComponent(otherPages.join(", "))}` : "";
    return back(`meta_connected=1${hint}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return back(`meta_error=${encodeURIComponent(message)}`);
  }
}
