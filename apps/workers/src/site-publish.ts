// Writes the generated pages into the tenant's own site repo and, when the
// tenant has asked for it, commits and pushes them so the host redeploys.
//
// Everything here runs on the operator's own machine against a path that
// came out of the database, so it is written to be boring on purpose:
// commands run through execFile with argument arrays (never a shell string),
// nothing from the database is ever interpreted as a command, and the repo
// path is validated before a single file is touched.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "@pulso/db/types";
import {
  renderArticlePage,
  renderBlogIndex,
  BLOG_STYLESHEET,
  type SiteShell,
  type BlogIndexEntry,
} from "@pulso/shared/article-html";

const run = promisify(execFile);

type SiteTargetRow = Database["public"]["Tables"]["site_targets"]["Row"];

export interface WriteArticleInput {
  site: SiteTargetRow;
  businessName: string;
  shell: SiteShell;
  article: {
    slug: string;
    title: string;
    metaDescription: string;
    bodyHtml: string;
    heroImageUrl?: string | undefined;
    publishedAt: string;
  };
  indexEntries: readonly BlogIndexEntry[];
}

export interface WriteArticleResult {
  /** Repo-relative paths, in the order they should be staged. */
  files: string[];
}

/** Slugs become file names, so anything that could climb out is refused. */
function assertSafeSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`unsafe article slug: ${JSON.stringify(slug)}`);
  }
}

export async function writeArticleFiles(input: WriteArticleInput): Promise<WriteArticleResult> {
  const { site, article } = input;
  assertSafeSlug(article.slug);

  const blogDir = site.blog_dir.replace(/^\/+|\/+$/g, "");
  const blogPath = `/${blogDir}`;
  const baseUrl = site.base_url.replace(/\/$/, "");
  const absoluteDir = path.join(site.repo_path, blogDir);
  await mkdir(absoluteDir, { recursive: true });

  const page = renderArticlePage(
    {
      title: article.title,
      metaDescription: article.metaDescription,
      bodyHtml: article.bodyHtml,
      heroImageUrl: article.heroImageUrl,
      publishedAt: article.publishedAt,
      canonicalUrl: `${baseUrl}${blogPath}/${article.slug}`,
      businessName: input.businessName,
      blogPath,
    },
    input.shell,
  );

  const index = renderBlogIndex(
    {
      businessName: input.businessName,
      blogPath,
      canonicalUrl: `${baseUrl}${blogPath}`,
      entries: input.indexEntries,
    },
    input.shell,
  );

  const files = [
    `${blogDir}/${article.slug}.html`,
    `${blogDir}/index.html`,
    // Rewritten every time so a change to the stylesheet reaches every
    // tenant's site on their next article, without a migration step.
    `${blogDir}/blog.css`,
  ];

  await writeFile(path.join(site.repo_path, files[0]!), page, "utf8");
  await writeFile(path.join(site.repo_path, files[1]!), index, "utf8");
  await writeFile(path.join(site.repo_path, files[2]!), BLOG_STYLESHEET, "utf8");

  return { files };
}

export interface WriteMdxArticleInput {
  site: SiteTargetRow;
  article: {
    slug: string;
    title: string;
    metaDescription: string;
    bodyHtml: string;
    publishedAt: string;
  };
}

/** Double-quoted YAML scalar — JSON.stringify already escapes the same way YAML expects for plain text. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * For a tenant whose site already has its own blog (e.g. AZ Estudio
 * Contable's Next.js app, reading `content/blog/*.mdx` via next-mdx-remote/
 * gray-matter) rather than the plain-HTML pages writeArticleFiles produces.
 * Only the one file: no index page to write, since a real app's own /blog
 * route lists posts by reading the directory itself, and no shared
 * stylesheet, since the app already has one. `bodyHtml` — already limited to
 * a handful of basic tags by article-gen.ts's sanitizer — passes through
 * as-is: plain HTML inside an .mdx file's body is standard Markdown/MDX,
 * not something that needs converting.
 *
 * No `category` in the frontmatter: article-gen.ts's GeneratedArticle has no
 * concept of one, and guessing wrong would be worse than the site's own
 * fallback (confirmed in AZ's lib/mdx.ts: an absent category defaults to its
 * first one rather than erroring).
 */
export async function writeMdxArticleFile(input: WriteMdxArticleInput): Promise<WriteArticleResult> {
  const { site, article } = input;
  assertSafeSlug(article.slug);

  const blogDir = site.blog_dir.replace(/^\/+|\/+$/g, "");
  const absoluteDir = path.join(site.repo_path, blogDir);
  await mkdir(absoluteDir, { recursive: true });

  const frontmatter = [
    "---",
    `title: ${yamlString(article.title)}`,
    `description: ${yamlString(article.metaDescription)}`,
    `date: ${yamlString(article.publishedAt.slice(0, 10))}`,
    "---",
    "",
  ].join("\n");

  const file = `${blogDir}/${article.slug}.mdx`;
  await writeFile(path.join(site.repo_path, file), frontmatter + article.bodyHtml + "\n", "utf8");

  return { files: [file] };
}

export type DeployResult = { ok: true; commit: string } | { ok: false; error: string };

/**
 * Commits exactly the files we wrote and pushes them; the host (Vercel,
 * Netlify, Pages) redeploys off the push.
 *
 * The repo-root check is not a formality. Aura's site lives at
 * ~/aurastudio/web, which is its own repo with its own remote — but
 * ~/aurastudio itself is not a repo at all: it sits inside the operator's
 * home directory, which happens to be one. Pointed one level too high, a
 * `git add` there would have staged the operator's entire home folder. So a
 * repo_path that is not itself the root of a repository is refused outright
 * rather than committed to.
 */
export async function deployArticles(
  site: SiteTargetRow,
  message: string,
  files: readonly string[],
): Promise<DeployResult> {
  const cwd = site.repo_path;
  if (!path.isAbsolute(cwd)) return { ok: false, error: `repo_path must be absolute: ${cwd}` };

  const git = (args: string[]) => run("git", args, { cwd, timeout: 120_000 });

  try {
    const { stdout: root } = await git(["rev-parse", "--show-toplevel"]);
    if (path.resolve(root.trim()) !== path.resolve(cwd)) {
      return {
        ok: false,
        error: `repo_path ${cwd} is not the root of a git repository (root is ${root.trim()}) — refusing to commit`,
      };
    }

    const { stdout: remotes } = await git(["remote"]);
    if (!remotes.trim()) return { ok: false, error: `repository at ${cwd} has no remote to push to` };

    // "--" keeps a file name from ever being read as an option.
    await git(["add", "--", ...files]);

    const { stdout: staged } = await git(["diff", "--cached", "--name-only"]);
    if (!staged.trim()) return { ok: false, error: "nothing changed to commit" };

    await git(["commit", "-m", message]);
    const { stdout: sha } = await git(["rev-parse", "HEAD"]);
    await git(["push", "origin", "HEAD"]);

    return { ok: true, commit: sha.trim().slice(0, 8) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}
