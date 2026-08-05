-- ---------------------------------------------------------------------------
-- news_suggestions — daily news headlines the News agent judged relevant to
-- a tenant's business, each with a suggested content angle. Always starts
-- 'pending': unlike calendar slots, these never auto-schedule regardless of
-- hitl_mode — a human always picks which ones (if any) become real content
-- via /news, which converts one into a content_calendar slot on demand.
-- ---------------------------------------------------------------------------
create table public.news_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  headline text not null,
  source_url text not null,
  source_name text,
  summary text,
  angle text not null,
  status text not null default 'pending' check (status in ('pending', 'used', 'dismissed')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.news_suggestions enable row level security;
alter table public.news_suggestions force row level security;

create index news_suggestions_tenant_status_idx on public.news_suggestions (tenant_id, status, created_at desc);

-- Reruns of the daily tick shouldn't re-suggest the same article twice.
create unique index news_suggestions_tenant_source_idx on public.news_suggestions (tenant_id, source_url);

create policy news_suggestions_select on public.news_suggestions
  for select
  using (tenant_id in (select private.user_tenant_ids()));

-- No insert policy for `authenticated` on purpose — only the News agent
-- (service_role) creates these, same reasoning as content_calendar/creatives.
create policy news_suggestions_update on public.news_suggestions
  for update
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'))
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

insert into public.prompts (name, version, template, is_active)
values (
  'news.relevance',
  1,
  $$Eres el agente de noticias de Pulso Engine. Tu trabajo es revisar los titulares del día y decidir cuáles le sirven a este negocio para crear contenido en redes sociales.

Rubro del negocio: {{RUBRO}}

Titulares de hoy:
{{HEADLINES}}

Para cada titular que sea genuinamente relevante y aprovechable para este negocio, indica su número y un ángulo de contenido concreto: una idea específica de cómo este negocio podría usar esa noticia en una publicación (no una relación forzada ni genérica). Es mejor devolver pocos titulares o ninguno que inventar relevancia donde no la hay.

Responde SOLO con un JSON con esta forma exacta, sin texto adicional ni markdown:
{"relevant": [{"index": 1, "angle": "string breve y concreto"}]}

Si ningún titular es relevante, responde {"relevant": []}.$$,
  true
)
on conflict do nothing;

insert into public.agents_registry (name, allowed_tools, prompt_name, model, tenant_id)
values ('news', '[]'::jsonb, 'news.relevance', null, null)
on conflict do nothing;
