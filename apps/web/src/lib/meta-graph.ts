const META_GRAPH_API_VERSION = "v21.0";

export type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
};

export async function fetchManagedPages(longLivedUserToken: string): Promise<MetaPage[]> {
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

export async function fetchInstagramUsername(igUserId: string, accessToken: string): Promise<string | null> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${igUserId}`);
  url.searchParams.set("fields", "username");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const data = (await response.json()) as { username?: string };
  return data.username ?? null;
}
