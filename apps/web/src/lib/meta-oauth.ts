/**
 * Must exactly match a URI registered in Meta's App Dashboard under
 * "Valid OAuth Redirect URIs" — Meta matches this string literally, so it's
 * hardcoded here instead of derived from the incoming request's host (which
 * varies across Vercel's aliases for the same deployment).
 *
 * Also has to be the SAME domain the user is actually logged into: Supabase's
 * auth cookie is host-only, so landing the OAuth redirect on a sibling
 * Vercel alias (different subdomain, same deployment) arrives with no
 * session at all — this must be the domain the dashboard is normally
 * accessed from, not just any valid alias for it.
 */
export const META_OAUTH_REDIRECT_URI = "https://pulso-engine-render-templates-qtwd.vercel.app/api/meta/callback";
