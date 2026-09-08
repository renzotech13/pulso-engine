// Turns a generated article into a real .html page for the tenant's own site.
//
// The design problem: the page has to look like it always belonged to that
// site, but Pulso serves many tenants and cannot hold a hand-written template
// per client. So nothing here is designed. The header, the footer and the
// <link> tags for fonts and CSS are LIFTED from a page the client already has
// (site_targets.shell_page), which means the blog follows the site's own
// design and keeps following it when the client changes it. Only the article
// body gets styles of our own, and those are written against CSS variables
// with fallbacks: on a site that defines --brown/--gold/--serif the article
// inherits the brand, and on one that doesn't it still reads well.
//
// No relative imports (apps/web may bundle this — see image-gen.ts).

export interface SiteShell {
  /** <link>/<meta> tags from the source page's head: fonts, stylesheets. */
  headExtras: string;
  /** The whole <header> element, or "" if the source page had none. */
  header: string;
  /** The whole <footer> element, or "" if the source page had none. */
  footer: string;
  /** class attribute of the source page's <body>, so body-level styles apply. */
  bodyClass: string;
}

export interface ArticlePageInput {
  title: string;
  metaDescription: string;
  bodyHtml: string;
  heroImageUrl?: string | undefined;
  /** ISO date the article was published, for <time> and the visible date. */
  publishedAt?: string | undefined;
  /** Canonical absolute URL, e.g. https://aurastudio.pe/blog/mi-articulo */
  canonicalUrl?: string | undefined;
  businessName: string;
  /** Where "volver al blog" points, e.g. /blog */
  blogPath: string;
}

export interface BlogIndexEntry {
  slug: string;
  title: string;
  metaDescription: string;
  publishedAt?: string | undefined;
  heroImageUrl?: string | undefined;
}

const SCRIPT_BLOCK = /<script[\s\S]*?<\/script>/gi;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Rewrites document-relative asset paths to root-absolute. The shell is
 * copied from a page that sits at the site root (`assets/css/style.css`), but
 * articles live one level down in /blog/, where that same path would 404.
 */
function rootAbsolutePaths(html: string): string {
  return html.replace(
    /\b(src|href)\s*=\s*"(?!https?:|\/\/|\/|#|mailto:|tel:|data:)([^"]*)"/gi,
    (_match, attr: string, path: string) => `${attr}="/${path}"`,
  );
}

function firstTag(html: string, tag: string): string {
  const match = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "i").exec(html);
  return match ? match[0] : "";
}

/**
 * Reads a page the client already ships and keeps only its chrome. Scripts
 * are dropped on purpose: the site's own JS expects the home page's DOM
 * (sliders, booking modal, scroll animations) and throws on a page that
 * doesn't have it. What the chrome needs to look right is CSS, not behaviour.
 */
export function extractShell(sourceHtml: string): SiteShell {
  const head = /<head[\s\S]*?<\/head>/i.exec(sourceHtml)?.[0] ?? "";
  const headExtras = (head.match(/<link[^>]*>/gi) ?? [])
    .filter((tag) => /rel\s*=\s*"(stylesheet|preconnect|preload)"/i.test(tag))
    .join("\n");

  const bodyClass = /<body[^>]*\bclass\s*=\s*"([^"]*)"/i.exec(sourceHtml)?.[1] ?? "";

  return {
    headExtras: rootAbsolutePaths(headExtras),
    header: rootAbsolutePaths(firstTag(sourceHtml, "header").replace(SCRIPT_BLOCK, "")),
    footer: rootAbsolutePaths(firstTag(sourceHtml, "footer").replace(SCRIPT_BLOCK, "")),
    bodyClass,
  };
}

export const EMPTY_SHELL: SiteShell = { headExtras: "", header: "", footer: "", bodyClass: "" };

/**
 * The one stylesheet Pulso owns, written once next to the articles. Every
 * colour and font goes through a variable WITH a fallback: it borrows the
 * client's tokens where they exist and stands on its own where they don't.
 */
export const BLOG_STYLESHEET = `/* Generado por Pulso Engine. Se sobrescribe: no editar a mano.
   Usa los tokens del sitio (--brown, --gold, --serif...) cuando existen, y
   valores neutros de respaldo cuando no. */

.pulso-article{padding-top:clamp(96px,13vw,132px);padding-bottom:clamp(50px,6vw,80px);}
.pulso-article a{color:var(--gold-deep,#8a6410);text-decoration:underline;text-underline-offset:2px;}
.pulso-article a:hover{color:var(--brown,#3f2a1c);}

.pulso-article-head{width:min(760px,90vw);margin:0 auto clamp(30px,4vw,44px);}
.pulso-back{
  display:inline-flex;align-items:center;gap:8px;text-decoration:none;
  font-size:12px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--gold-deep,#8a6410);margin-bottom:clamp(18px,2.6vw,28px);
}
.pulso-article-head h1{
  font-family:var(--serif,Georgia,serif);color:var(--brown,#3f2a1c);
  font-size:clamp(1.7rem,4vw,2.7rem);line-height:1.2;letter-spacing:.01em;margin:0;
}
.pulso-date{margin-top:12px;font-size:12.5px;font-style:italic;color:rgba(92,58,35,.62);}

.pulso-hero{width:min(1040px,92vw);margin:0 auto clamp(30px,4vw,44px);}
.pulso-hero img{width:100%;height:auto;display:block;border-radius:2px;}

.pulso-body{width:min(760px,90vw);margin:0 auto;}
.pulso-body h2{
  font-family:var(--serif,Georgia,serif);color:var(--brown,#3f2a1c);
  font-size:clamp(1.15rem,2vw,1.45rem);line-height:1.35;
  margin:clamp(34px,4vw,46px) 0 14px;
}
.pulso-body h3{
  font-family:var(--sans,system-ui,sans-serif);color:var(--gold-deep,#8a6410);
  font-weight:500;font-size:13px;letter-spacing:.04em;margin:22px 0 8px;
}
.pulso-body p,.pulso-body li{
  color:var(--ink,#4a4a4a);font-size:15px;line-height:1.85;font-weight:300;
}
.pulso-body p + p{margin-top:14px;}
.pulso-body ul,.pulso-body ol{margin:14px 0 0;padding-left:22px;}
.pulso-body li + li{margin-top:6px;}
.pulso-body li::marker{color:var(--gold-deep,#8a6410);}
.pulso-body strong{font-weight:500;color:var(--brown,#3f2a1c);}

/* Índice del blog */
.pulso-index{padding-top:clamp(96px,13vw,132px);padding-bottom:clamp(50px,6vw,80px);}
.pulso-index-head{width:min(1040px,92vw);margin:0 auto clamp(34px,4.4vw,54px);}
.pulso-index-head h1{
  font-family:var(--serif,Georgia,serif);color:var(--brown,#3f2a1c);
  text-transform:uppercase;letter-spacing:.045em;
  font-size:clamp(1.7rem,4vw,2.7rem);line-height:1.15;margin:0;
}
.pulso-cards{
  width:min(1040px,92vw);margin:0 auto;display:grid;gap:clamp(20px,3vw,34px);
  grid-template-columns:repeat(auto-fill,minmax(280px,1fr));
}
.pulso-card{display:block;text-decoration:none;}
.pulso-card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;margin-bottom:14px;}
.pulso-card h2{
  font-family:var(--serif,Georgia,serif);color:var(--brown,#3f2a1c);
  font-size:1.1rem;line-height:1.35;margin:0 0 8px;
}
.pulso-card p{color:var(--ink,#4a4a4a);font-size:13.5px;line-height:1.7;font-weight:300;margin:0;}
.pulso-card time{display:block;margin-top:10px;font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-deep,#8a6410);}
.pulso-card:hover h2{color:var(--gold-deep,#8a6410);}
.pulso-empty{width:min(760px,90vw);margin:0 auto;color:var(--ink,#4a4a4a);font-weight:300;}
`;

/** blog.css sits alongside the articles, wherever the tenant's blog lives. */
export function stylesheetHrefFor(blogPath: string): string {
  return `${blogPath.replace(/\/$/, "")}/blog.css`;
}

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
];

/** "8 de setiembre de 2026" — read by people, so Spanish and no ISO. */
export function formatSpanishDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  return `${day} de ${MONTHS[month - 1]} de ${year}`;
}

function page(options: {
  shell: SiteShell;
  title: string;
  description: string;
  ogType: "article" | "website";
  /** Where blog.css lives, derived from the tenant's blog path. */
  stylesheetHref: string;
  canonicalUrl?: string | undefined;
  ogImage?: string | undefined;
  extraHead?: string;
  main: string;
}): string {
  const { shell } = options;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<meta name="description" content="${escapeHtml(options.description)}">
${options.canonicalUrl ? `<link rel="canonical" href="${escapeHtml(options.canonicalUrl)}">` : ""}
<meta property="og:type" content="${options.ogType}">
<meta property="og:title" content="${escapeHtml(options.title)}">
<meta property="og:description" content="${escapeHtml(options.description)}">
${options.canonicalUrl ? `<meta property="og:url" content="${escapeHtml(options.canonicalUrl)}">` : ""}
${options.ogImage ? `<meta property="og:image" content="${escapeHtml(options.ogImage)}">` : ""}
${shell.headExtras}
<link rel="stylesheet" href="${escapeHtml(options.stylesheetHref)}">
${options.extraHead ?? ""}
</head>
<body${shell.bodyClass ? ` class="${escapeHtml(shell.bodyClass)}"` : ""}>

${shell.header}

${options.main}

${shell.footer}

</body>
</html>
`;
}

export function renderArticlePage(input: ArticlePageInput, shell: SiteShell): string {
  const date = input.publishedAt ? formatSpanishDate(input.publishedAt) : "";
  // JSON-LD so the piece can show up as an article in search results rather
  // than as an anonymous page. Every value is escaped: the title came from a
  // model, and this sits inside a <script> block.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title,
    description: input.metaDescription,
    ...(input.heroImageUrl ? { image: input.heroImageUrl } : {}),
    ...(input.publishedAt ? { datePublished: input.publishedAt.slice(0, 10) } : {}),
    author: { "@type": "Organization", name: input.businessName },
    publisher: { "@type": "Organization", name: input.businessName },
    ...(input.canonicalUrl ? { mainEntityOfPage: input.canonicalUrl } : {}),
  };

  const main = `<main class="pulso-article">
  <div class="pulso-article-head">
    <a class="pulso-back" href="${escapeHtml(input.blogPath)}">&larr; Volver al blog</a>
    <h1>${escapeHtml(input.title)}</h1>
    ${date ? `<p class="pulso-date"><time datetime="${escapeHtml(input.publishedAt!.slice(0, 10))}">${date}</time></p>` : ""}
  </div>
  ${
    input.heroImageUrl
      ? `<figure class="pulso-hero"><img src="${escapeHtml(input.heroImageUrl)}" alt="${escapeHtml(input.title)}" loading="eager"></figure>`
      : ""
  }
  <article class="pulso-body">
${input.bodyHtml}
  </article>
</main>`;

  return page({
    shell,
    ogType: "article",
    stylesheetHref: stylesheetHrefFor(input.blogPath),
    title: `${input.title} | ${input.businessName}`,
    description: input.metaDescription,
    canonicalUrl: input.canonicalUrl,
    ogImage: input.heroImageUrl,
    // </script> inside a string would close this block early; escaping the
    // slash is the standard way to keep JSON-LD from breaking the page.
    extraHead: `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
    main,
  });
}

export function renderBlogIndex(
  input: { businessName: string; blogPath: string; canonicalUrl?: string | undefined; entries: readonly BlogIndexEntry[] },
  shell: SiteShell,
): string {
  const base = input.blogPath.replace(/\/$/, "");
  const cards = input.entries
    .map((entry) => {
      const date = entry.publishedAt ? formatSpanishDate(entry.publishedAt) : "";
      return `    <a class="pulso-card" href="${escapeHtml(`${base}/${entry.slug}`)}">
${entry.heroImageUrl ? `      <img src="${escapeHtml(entry.heroImageUrl)}" alt="${escapeHtml(entry.title)}" loading="lazy">\n` : ""}      <h2>${escapeHtml(entry.title)}</h2>
      <p>${escapeHtml(entry.metaDescription)}</p>
${date ? `      <time datetime="${escapeHtml(entry.publishedAt!.slice(0, 10))}">${date}</time>\n` : ""}    </a>`;
    })
    .join("\n");

  const main = `<main class="pulso-index">
  <div class="pulso-index-head">
    <h1>Blog</h1>
  </div>
${
  input.entries.length > 0
    ? `  <div class="pulso-cards">\n${cards}\n  </div>`
    : `  <p class="pulso-empty">Todavía no hay artículos publicados.</p>`
}
</main>`;

  return page({
    shell,
    ogType: "website",
    stylesheetHref: stylesheetHrefFor(input.blogPath),
    title: `Blog | ${input.businessName}`,
    description: `Artículos y consejos de ${input.businessName}.`,
    canonicalUrl: input.canonicalUrl,
    main,
  });
}
