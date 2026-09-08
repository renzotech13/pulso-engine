import { describe, expect, it } from "vitest";
import { sanitizeArticleHtml, slugify, countWords } from "../src/article-gen.js";
import {
  extractShell,
  renderArticlePage,
  renderBlogIndex,
  stylesheetHrefFor,
  formatSpanishDate,
  EMPTY_SHELL,
} from "../src/article-html.js";

describe("sanitizeArticleHtml", () => {
  it("keeps the tags the blog template styles", () => {
    const html = "<h2>Título</h2><p>Un <strong>párrafo</strong> con <em>énfasis</em>.</p><ul><li>Uno</li></ul>";
    expect(sanitizeArticleHtml(html)).toBe(html);
  });

  it("drops scripts, styles and their contents", () => {
    const html = '<p>Antes</p><script>fetch("/robar")</script><style>body{display:none}</style><p>Después</p>';
    expect(sanitizeArticleHtml(html)).toBe("<p>Antes</p><p>Después</p>");
  });

  it("strips tags the template does not style, keeping their text", () => {
    expect(sanitizeArticleHtml('<div class="x"><p>Hola</p></div>')).toBe("<p>Hola</p>");
    expect(sanitizeArticleHtml("<h1>No debería haber h1</h1>")).toBe("No debería haber h1");
  });

  it("removes event handlers and inline attributes from allowed tags", () => {
    expect(sanitizeArticleHtml('<p onclick="alert(1)" style="color:red">Hola</p>')).toBe("<p>Hola</p>");
  });

  it("keeps only http(s) links and neutralises the rest", () => {
    expect(sanitizeArticleHtml('<a href="https://ok.pe">ok</a>')).toBe(
      '<a href="https://ok.pe" rel="noopener">ok</a>',
    );
    // The page is served from the client's own domain: a javascript: href
    // written by a model is exactly what must never reach it.
    expect(sanitizeArticleHtml('<a href="javascript:alert(1)">no</a>')).toBe("<a>no</a>");
  });

  it("does not leave an unbalanced comment able to swallow the page", () => {
    expect(sanitizeArticleHtml("<p>a</p><!-- <p>oculto</p> --><p>b</p>")).toBe("<p>a</p><p>b</p>");
  });
});

describe("slugify", () => {
  it("strips accents and punctuation", () => {
    expect(slugify("¿Cómo cuidar tu cabello teñido?")).toBe("como-cuidar-tu-cabello-tenido");
  });

  it("never ends in a hyphen, even when the cut lands on one", () => {
    const slug = slugify("palabra ".repeat(20));
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(70);
  });
});

describe("countWords", () => {
  it("counts words, not markup", () => {
    expect(countWords("<h2>Uno dos</h2><p>tres cuatro cinco</p>")).toBe(5);
  });
});

describe("extractShell", () => {
  const sourcePage = `<!DOCTYPE html><html><head>
<title>Aviso Legal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="assets/css/style.css">
<link rel="icon" href="favicon.ico">
</head>
<body class="legal">
<header class="site-header"><a href="/"><img src="assets/img/logo.webp"></a></header>
<main>texto legal</main>
<footer class="site-footer"><p>© Aura</p></footer>
<script src="assets/js/app.js"></script>
</body></html>`;

  it("lifts the header, the footer and the body class", () => {
    const shell = extractShell(sourcePage);
    expect(shell.header).toContain("site-header");
    expect(shell.footer).toContain("© Aura");
    expect(shell.bodyClass).toBe("legal");
    // The page body itself must not come along.
    expect(shell.header).not.toContain("texto legal");
  });

  it("keeps stylesheet and font links but not the favicon", () => {
    const shell = extractShell(sourcePage);
    expect(shell.headExtras).toContain("fonts.googleapis.com");
    expect(shell.headExtras).toContain("/assets/css/style.css");
    expect(shell.headExtras).not.toContain("favicon");
  });

  it("makes relative asset paths absolute, since articles sit a level down", () => {
    const shell = extractShell(sourcePage);
    expect(shell.header).toContain('src="/assets/img/logo.webp"');
    expect(shell.header).not.toContain('src="assets/');
  });

  it("leaves already-absolute and anchor links alone", () => {
    const shell = extractShell(
      '<header><a href="/#inicio">Inicio</a><a href="https://wa.me/51">wa</a></header>',
    );
    expect(shell.header).toContain('href="/#inicio"');
    expect(shell.header).toContain('href="https://wa.me/51"');
  });

  it("drops scripts from the chrome it copies", () => {
    const shell = extractShell('<footer><p>x</p><script>boom()</script></footer>');
    expect(shell.footer).not.toContain("boom");
  });
});

describe("renderArticlePage", () => {
  const article = {
    title: 'Cuidado del color <en "verano">',
    metaDescription: "Consejos para el verano.",
    bodyHtml: "<p>Cuerpo</p>",
    publishedAt: "2026-09-08T14:00:00.000Z",
    canonicalUrl: "https://aurastudio.pe/blog/cuidado",
    businessName: "Aura Studio",
    blogPath: "/blog",
  };

  it("escapes the title everywhere it lands in the head", () => {
    const html = renderArticlePage(article, EMPTY_SHELL);
    expect(html).toContain("<title>Cuidado del color &lt;en &quot;verano&quot;&gt; | Aura Studio</title>");
    expect(html).not.toContain('content="Cuidado del color <en');
  });

  it("cannot have its JSON-LD block closed early by the title", () => {
    const html = renderArticlePage({ ...article, title: "</script><script>boom()</script>" }, EMPTY_SHELL);
    expect(html).not.toContain("<script>boom()</script>");
  });

  it("points at the stylesheet under the tenant's own blog path", () => {
    const html = renderArticlePage({ ...article, blogPath: "/articulos" }, EMPTY_SHELL);
    expect(html).toContain('href="/articulos/blog.css"');
  });

  it("includes the site chrome when there is any", () => {
    const html = renderArticlePage(article, { ...EMPTY_SHELL, header: "<header>H</header>", footer: "<footer>F</footer>" });
    expect(html).toContain("<header>H</header>");
    expect(html).toContain("<footer>F</footer>");
  });
});

describe("renderBlogIndex", () => {
  it("says so plainly when there are no articles yet", () => {
    const html = renderBlogIndex({ businessName: "Aura Studio", blogPath: "/blog", entries: [] }, EMPTY_SHELL);
    expect(html).toContain("Todavía no hay artículos publicados");
  });

  it("links each card to the article under the blog path", () => {
    const html = renderBlogIndex(
      {
        businessName: "Aura Studio",
        blogPath: "/blog",
        entries: [{ slug: "uno", title: "Uno", metaDescription: "d", publishedAt: "2026-09-08T00:00:00Z" }],
      },
      EMPTY_SHELL,
    );
    expect(html).toContain('href="/blog/uno"');
    expect(html).toContain("8 de setiembre de 2026");
  });
});

describe("stylesheetHrefFor", () => {
  it("does not double the slash when the blog path has a trailing one", () => {
    expect(stylesheetHrefFor("/blog/")).toBe("/blog/blog.css");
    expect(stylesheetHrefFor("/blog")).toBe("/blog/blog.css");
  });
});

describe("formatSpanishDate", () => {
  it("uses the Peruvian month name", () => {
    expect(formatSpanishDate("2026-09-08")).toBe("8 de setiembre de 2026");
  });
});
