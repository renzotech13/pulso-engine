-- blog_dir is a FILESYSTEM location (relative to repo_path, where
-- site-publish.ts writes files) — for a static site like Aura's, that
-- happens to also be the public URL path, since the whole folder is served
-- as-is. For a real app with its own router (AZ Estudio Contable: files go
-- in content/blog, but the app serves them at /blog via its own
-- app/blog/[slug] route), the two are different things entirely, and
-- article.ts wrongly conflated them when building each article's public
-- url. public_path is null by default, meaning "same as blog_dir" — every
-- existing site keeps its current behavior unchanged; only a site that
-- needs the two to differ (AZ) sets it explicitly.

alter table public.site_targets
  add column public_path text;
