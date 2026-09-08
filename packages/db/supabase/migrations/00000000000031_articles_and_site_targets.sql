-- Una publicación de redes y un artículo de blog son la misma idea contada
-- con distinta profundidad: el post da el gancho, el artículo desarrolla y
-- es lo que Google indexa. Hasta ahora Pulso solo producía lo primero.
--
-- Un artículo nace del slot evergreen de la mañana (el de noticias no: es
-- coyuntural, envejece mal como página permanente y ya cita fuentes ajenas).

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- De qué pieza del calendario salió. ON DELETE SET NULL: regenerar el
  -- creative borra su fila, y el artículo no tiene por qué morir con ella.
  calendar_slot_id uuid references public.content_calendar (id) on delete set null,
  slug text not null,
  title text not null,
  meta_description text,
  -- HTML ya sanitizado por el generador (solo h2/h3/p/ul/ol/li/strong/em/a).
  body_html text not null,
  hero_image_url text,
  status text not null default 'draft' check (status in ('draft', 'ready', 'published', 'failed')),
  -- La URL pública real una vez publicado, para no recalcularla.
  url text,
  published_at timestamptz,
  word_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- El slug es la URL: único por negocio, no globalmente.
  unique (tenant_id, slug)
);

create index articles_tenant_created_idx on public.articles (tenant_id, created_at desc);
create index articles_slot_idx on public.articles (calendar_slot_id);

alter table public.articles enable row level security;
alter table public.articles force row level security;

create policy articles_select on public.articles
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy articles_update on public.articles
  for update
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'))
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create policy articles_delete on public.articles
  for delete
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create trigger articles_set_updated_at
  before update on public.articles
  for each row
  execute function private.set_updated_at();

-- Dónde vive el sitio de cada cliente. Declarativo a propósito: guarda RUTAS
-- y URLs, nunca un comando — el worker corre en la Mac del operador y
-- ejecutar una cadena venida de la base sería una vía de inyección. El "cómo"
-- (git, vercel) vive en el código, no acá.
create table public.site_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete cascade,
  -- Repo local del sitio. Tiene que ser la RAÍZ del repositorio git, no una
  -- carpeta que esté dentro de uno: p. ej. /Users/renzo/aurastudio/web, que
  -- es su propio repo. Apuntar un nivel más arriba haría que el commit
  -- arrastrara todo lo que cuelgue de ese repo. El worker lo verifica antes
  -- de tocar nada (site-publish.ts) y se niega si no coincide.
  repo_path text not null,
  -- Carpeta del blog relativa al repo, p. ej. web/blog
  blog_dir text not null default 'blog',
  -- Base pública para armar la URL final, p. ej. https://aurastudio.pe
  base_url text not null,
  -- Página existente del sitio de la que se copia el cascarón (header, footer
  -- y los <link> de fuentes y CSS), relativa a repo_path: p. ej.
  -- aviso-legal.html. Así el blog
  -- hereda el diseño real del cliente y sigue sus cambios, en vez de que
  -- nosotros mantengamos una copia del header que se desincroniza. Si es
  -- null, el artículo se renderiza como página suelta con estilos propios.
  shell_page text,
  -- Publicar en el sitio sin intervención. false = se escribe el archivo y
  -- alguien revisa y despliega. Arranca apagado a propósito: el sitio es
  -- más permanente que un post y merece una mano humana hasta que confíes.
  auto_publish boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_targets enable row level security;
alter table public.site_targets force row level security;

-- Solo owner/admin: guarda rutas del sistema de archivos del operador.
create policy site_targets_select on public.site_targets
  for select
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create trigger site_targets_set_updated_at
  before update on public.site_targets
  for each row
  execute function private.set_updated_at();
