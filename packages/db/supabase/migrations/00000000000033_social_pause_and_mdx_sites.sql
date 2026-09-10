-- Two independent additions:
--
-- 1. tenants.social_paused — lets a tenant keep publishing to its own blog
--    (the article agent runs off the SAME morning creative that feeds social,
--    see article.ts) while its social-media posting stays off. `status`
--    already works as a global kill switch (planner/render/publish/news
--    ticks all skip a paused tenant entirely, which stops blog articles
--    too) — this is a second, narrower switch: only the social-publishing
--    steps check it, so the daily piece and its blog article still get
--    generated.
--
-- 2. site_targets.format — some tenant sites are plain static HTML (Aura:
--    hand-rolled pages, site-publish.ts writes .html directly) and some are
--    a real Next.js app with its own MDX-based blog (AZ Estudio Contable:
--    content/blog/*.mdx, frontmatter-driven, its own /blog route reads the
--    directory directly) — writing raw .html into a folder like that would
--    just be ignored by the site's own blog page. 'html' keeps today's
--    behavior; 'mdx' writes one <slug>.mdx file with YAML frontmatter
--    instead of an article page + index + stylesheet.

alter table public.tenants
  add column social_paused boolean not null default false;

alter table public.site_targets
  add column format text not null default 'html'
    check (format in ('html', 'mdx'));
