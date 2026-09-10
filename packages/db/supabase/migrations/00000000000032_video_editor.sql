-- Fase 3 del Editor de Video: esquema para que el pipeline (ya construido
-- en apps/video-editor, Fases 1-2) corra como un job en segundo plano en
-- vez de un script de línea de comandos, con tres pantallas encima.
--
-- Cuatro tablas, no más — el mismo "proyecto, asset, job, preset" que
-- propuso la Fase 0. El "job" no es una tabla aparte: su estado vive en
-- video_projects.status (los pasos compartidos por todo el proyecto —
-- ingesta, guion, transcripción) y en video_project_videos.status (los
-- pasos que corren por separado para cada video que el guion describe,
-- después de que el proyecto se bifurca en uno-o-más videos).

-- ---------------------------------------------------------------------------
-- video_presets — igual patrón que render_templates: tenant_id null =
-- preset global, disponible para cualquier tenant.
-- ---------------------------------------------------------------------------
create table public.video_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  nombre text not null,
  -- El JSON completo, con la forma de Preset (src/pipeline/preset.ts) —
  -- validado por Zod en el worker antes de usarse, no acá.
  config jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.video_presets enable row level security;
alter table public.video_presets force row level security;

create policy video_presets_select on public.video_presets
  for select
  using (tenant_id is null or tenant_id in (select private.user_tenant_ids()));

create policy video_presets_insert on public.video_presets
  for insert
  with check (tenant_id in (select private.user_tenant_ids()));

create policy video_presets_update on public.video_presets
  for update
  using (tenant_id in (select private.user_tenant_ids()))
  with check (tenant_id in (select private.user_tenant_ids()));

create policy video_presets_delete on public.video_presets
  for delete
  using (tenant_id in (select private.user_tenant_ids()));

create trigger video_presets_set_updated_at
  before update on public.video_presets
  for each row
  execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- video_projects — un proyecto por corrida (N videos crudos + 1 PDF de
-- guion + música opcional -> N videos finales). El status cubre los pasos
-- ANTERIORES a que el proyecto se bifurque por video (2.1-2.3); de ahí en
-- adelante cada video en video_project_videos lleva el suyo.
-- ---------------------------------------------------------------------------
create table public.video_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  nombre text not null,
  preset_id uuid not null references public.video_presets (id),
  -- Ruta dentro del bucket video-editor-assets, no una URL — el bucket es
  -- privado (puede haber material de cliente sin publicar todavía) y toda
  -- lectura pasa por una URL firmada de corta duración, generada al vuelo.
  pdf_path text not null,
  music_path text,
  status text not null default 'subido'
    check (status in ('subido', 'leyendo_guion', 'transcribiendo', 'en_revision', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.video_projects enable row level security;
alter table public.video_projects force row level security;

create policy video_projects_select on public.video_projects
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy video_projects_insert on public.video_projects
  for insert
  with check (tenant_id in (select private.user_tenant_ids()));

create policy video_projects_update on public.video_projects
  for update
  using (tenant_id in (select private.user_tenant_ids()))
  with check (tenant_id in (select private.user_tenant_ids()));

create policy video_projects_delete on public.video_projects
  for delete
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create trigger video_projects_set_updated_at
  before update on public.video_projects
  for each row
  execute function private.set_updated_at();

create index video_projects_tenant_created_idx on public.video_projects (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- video_assets — las tomas en crudo que el navegador subió directo al
-- bucket (Server Actions no aguantan archivos de varios GB). `probe` queda
-- null hasta que el worker corre ffprobe.
-- ---------------------------------------------------------------------------
create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.video_projects (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  path text not null,
  filename text not null,
  probe jsonb,
  -- La transcripción + silencios (AudioAnalysis del pipeline), guardada acá
  -- y no solo usada en memoria: si en Revisión el dueño excluye un segmento
  -- de la EDL, hay que recalcular los bloques de subtítulos (sus tiempos
  -- cambian) y eso necesita las palabras transcritas con sus timestamps.
  -- Guardarla evita retranscribir solo para editar la EDL.
  analysis jsonb,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'validado', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.video_assets enable row level security;
alter table public.video_assets force row level security;

create policy video_assets_select on public.video_assets
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy video_assets_insert on public.video_assets
  for insert
  with check (tenant_id in (select private.user_tenant_ids()));

create policy video_assets_update on public.video_assets
  for update
  using (tenant_id in (select private.user_tenant_ids()))
  with check (tenant_id in (select private.user_tenant_ids()));

create index video_assets_project_idx on public.video_assets (project_id);

-- ---------------------------------------------------------------------------
-- video_project_videos — un video de los que el guion describe. Guarda
-- todo lo que la pantalla de Revisión necesita editar (guion, título, EDL,
-- subtítulos) como JSONB — son estructuras internas del pipeline
-- (packages ya definidos en video-editor/src/pipeline/types.ts), no
-- entidades con vida propia que ameriten sus propias tablas.
-- ---------------------------------------------------------------------------
create table public.video_project_videos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.video_projects (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- El id que el propio guion usa ("video-1", "video-2"...) — estable entre
  -- relecturas del mismo PDF, a diferencia de un índice de array.
  script_id text not null,
  titulo text,
  mostrar_titulo boolean not null default false,
  guion text not null,
  -- Array de EdlSegment — editable en Revisión (excluir un segmento, en
  -- Fase 3, es tan simple como sacarlo de este array).
  edl jsonb not null default '[]'::jsonb,
  -- Array de SubtitleBlock — cada bloque, editable en Revisión.
  subtitulos jsonb not null default '[]'::jsonb,
  necesita_revision boolean not null default false,
  -- Rutas dentro de video-editor-output, no URLs — mismo motivo que
  -- video_projects.pdf_path.
  preview_path text,
  output_mp4_path text,
  output_srt_path text,
  status text not null default 'en_revision'
    check (status in ('en_revision', 'renderizando', 'listo', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, script_id)
);

alter table public.video_project_videos enable row level security;
alter table public.video_project_videos force row level security;

create policy video_project_videos_select on public.video_project_videos
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy video_project_videos_insert on public.video_project_videos
  for insert
  with check (tenant_id in (select private.user_tenant_ids()));

create policy video_project_videos_update on public.video_project_videos
  for update
  using (tenant_id in (select private.user_tenant_ids()))
  with check (tenant_id in (select private.user_tenant_ids()));

create trigger video_project_videos_set_updated_at
  before update on public.video_project_videos
  for each row
  execute function private.set_updated_at();

create index video_project_videos_project_idx on public.video_project_videos (project_id);

-- ---------------------------------------------------------------------------
-- Storage — dos buckets PRIVADOS (a diferencia de product-media/creative-
-- assets, que son material ya destinado a redes): una toma cruda sin editar
-- o un render todavía sin aprobar no tienen por qué quedar accesibles por
-- una URL pública adivinable. Toda lectura pasa por una URL firmada de
-- corta duración generada en el servidor (Server Action), nunca guardada.
-- La subida SÍ es directa desde el navegador (con el cliente autenticado
-- normal, respetando esta misma política de insert) — la única forma
-- práctica de manejar archivos de varios GB sin pasar por un Server Action.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('video-editor-assets', 'video-editor-assets', false),
  ('video-editor-output', 'video-editor-output', false)
on conflict (id) do nothing;

create policy "tenant members can upload their video-editor assets"
  on storage.objects for insert
  with check (
    bucket_id = 'video-editor-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );

create policy "tenant members can read their video-editor assets"
  on storage.objects for select
  using (
    bucket_id = 'video-editor-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );

create policy "tenant members can delete their video-editor assets"
  on storage.objects for delete
  using (
    bucket_id = 'video-editor-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );

create policy "tenant members can read their video-editor output"
  on storage.objects for select
  using (
    bucket_id = 'video-editor-output'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );

-- El worker (service_role, bypassa RLS) es el único que escribe acá — no
-- hace falta una política de insert/update para authenticated.

-- ---------------------------------------------------------------------------
-- RPCs que el dashboard llama para arrancar el trabajo pesado — mismo
-- patrón que request_creative_generation (migración 7): valida el rol,
-- inserta en el outbox, y el dispatcher de apps/workers (ya corriendo)
-- enruta a la cola "video-editor" según packages/events/src/catalog.ts.
-- ---------------------------------------------------------------------------
create or replace function public.request_video_project_processing(target_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  project_tenant_id uuid;
begin
  select tenant_id into project_tenant_id
  from public.video_projects
  where id = target_project_id;

  if project_tenant_id is null then
    raise exception 'video project not found';
  end if;

  if private.user_role_for_tenant(project_tenant_id) not in ('owner', 'admin') then
    raise exception 'not a member of this tenant';
  end if;

  insert into public.events (tenant_id, type, payload, correlation_id)
  values (
    project_tenant_id,
    'video.project.requested',
    jsonb_build_object('projectId', target_project_id),
    gen_random_uuid()
  );
end;
$$;

revoke all on function public.request_video_project_processing(uuid) from public;
grant execute on function public.request_video_project_processing(uuid) to authenticated;

create or replace function public.request_video_render(target_video_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  video_tenant_id uuid;
  video_project_id uuid;
begin
  select tenant_id, project_id into video_tenant_id, video_project_id
  from public.video_project_videos
  where id = target_video_id;

  if video_tenant_id is null then
    raise exception 'video not found';
  end if;

  if private.user_role_for_tenant(video_tenant_id) not in ('owner', 'admin') then
    raise exception 'not a member of this tenant';
  end if;

  insert into public.events (tenant_id, type, payload, correlation_id)
  values (
    video_tenant_id,
    'video.render.requested',
    jsonb_build_object('projectId', video_project_id, 'videoId', target_video_id),
    gen_random_uuid()
  );
end;
$$;

revoke all on function public.request_video_render(uuid) from public;
grant execute on function public.request_video_render(uuid) to authenticated;
