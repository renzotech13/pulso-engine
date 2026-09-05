-- El banco de fotos rotaba a ciegas por last_used_at: un post sobre "RUC 10
-- vs RUC 20" salió con una foto de foquitos de brainstorming solo porque era
-- la que llevaba más tiempo sin usarse. Cada foto se describe UNA vez
-- (Gemini vision, en un tick del worker) y desde ahí elegir por tema es puro
-- código: cruce de palabras entre el tema/copy y estas etiquetas. El dueño
-- puede corregirlas desde Marca › Banco de fotos (tag_source = 'manual' no
-- lo vuelve a tocar el tick).
alter table public.media_assets
  add column description text,
  add column tags text[] not null default '{}'::text[],
  add column has_people boolean,
  add column orientation text check (orientation in ('landscape', 'portrait', 'square')),
  add column tag_source text check (tag_source in ('gemini', 'manual')),
  add column tagged_at timestamptz,
  add column tag_attempts smallint not null default 0,
  add column tag_error text;

-- El tick busca fotos sin etiquetar cada pocos minutos; que ese barrido sea
-- barato aunque un tenant suba cientos de fotos de golpe.
create index media_assets_untagged_idx
  on public.media_assets (created_at)
  where tagged_at is null and tag_attempts < 3;

-- Hasta hoy no había política de UPDATE (solo el worker tocaba last_used_at
-- vía service_role). Necesaria para editar etiquetas desde el dashboard.
create policy media_assets_update on public.media_assets
  for update
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'))
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

-- Política banco-vs-Gemini por tenant. NULL en gemini_share = comportamiento
-- de siempre (banco siempre que exista; Gemini solo sin banco, para noticias
-- y por slide en carruseles), así ningún tenant cambia hasta configurarlo.
--   gemini_share: % objetivo de piezas con imagen generada (0-100).
--   gemini_daily_image_budget: tope de imágenes Gemini exitosas por día de
--   Lima (se cuentan en agent_calls con agent_name = 'gemini-image').
alter table public.tenants
  add column gemini_share smallint check (gemini_share between 0 and 100),
  add column gemini_daily_image_budget smallint check (gemini_daily_image_budget >= 0);
