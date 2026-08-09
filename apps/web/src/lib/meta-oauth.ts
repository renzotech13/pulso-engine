/**
 * Must exactly match a URI registered in Meta's App Dashboard under
 * "Valid OAuth Redirect URIs" — Meta matches this string literally, so it's
 * hardcoded here instead of derived from the incoming request's host (which
 * varies across Vercel's aliases for the same deployment).
 */
export const META_OAUTH_REDIRECT_URI =
  "https://pulso-engine-render-templates-qtwd-renzotech13s-projects.vercel.app/api/meta/callback";
