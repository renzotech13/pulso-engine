-- Reemplazo de fondo (RVM) desde el dashboard: hasta ahora solo existía como
-- CLI (apps/video-editor/src/bg-replace-cli.ts). Es una herramienta aparte
-- de video_projects a propósito — un trabajo acá no tiene guion ni EDL, y
-- RVM es lo bastante lento como para querer probar el corte/difuminado
-- solo, sin rehacer un proyecto entero. El MP4 resultante se descarga y,
-- si hace falta, se sube como toma cruda en un proyecto normal.

create table public.video_bg_replace_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  nombre text not null,
  -- Rutas dentro de video-editor-assets (mismo bucket privado que las tomas
  -- crudas de un proyecto): la toma con la persona a recortar con RVM, y el
  -- video (o imagen) que corre detrás de ella.
  source_path text not null,
  background_path text not null,
  -- Fracciones de la altura del cuadro — mismas opciones que
  -- BackgroundReplaceOptions (src/pipeline/background-replace.ts).
  cut_position numeric not null default 0.5 check (cut_position >= 0 and cut_position <= 1),
  blend_band numeric not null default 0.15 check (blend_band > 0 and blend_band <= 1),
  status text not null default 'pendiente'
    check (status in ('pendiente', 'procesando', 'listo', 'error')),
  -- 0-100, cuadros ya pasados por RVM — el paso lento, que sin esto se ve
  -- como un "procesando…" congelado durante varios minutos.
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  -- Ruta dentro de video-editor-output, no una URL (mismo motivo que
  -- video_project_videos.output_mp4_path).
  output_path text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.video_bg_replace_jobs enable row level security;
alter table public.video_bg_replace_jobs force row level security;

create policy video_bg_replace_jobs_select on public.video_bg_replace_jobs
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy video_bg_replace_jobs_insert on public.video_bg_replace_jobs
  for insert
  with check (tenant_id in (select private.user_tenant_ids()));

create policy video_bg_replace_jobs_delete on public.video_bg_replace_jobs
  for delete
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

-- Sin política de update para authenticated: status/progress/output_path
-- solo los escribe el worker (service_role, bypassa RLS).

create trigger video_bg_replace_jobs_set_updated_at
  before update on public.video_bg_replace_jobs
  for each row
  execute function private.set_updated_at();

create index video_bg_replace_jobs_tenant_created_idx on public.video_bg_replace_jobs (tenant_id, created_at desc);

-- Mismo patrón que request_video_project_processing (migración 32).
create or replace function public.request_video_bg_replace(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_tenant_id uuid;
begin
  select tenant_id into job_tenant_id
  from public.video_bg_replace_jobs
  where id = target_job_id;

  if job_tenant_id is null then
    raise exception 'background replace job not found';
  end if;

  if private.user_role_for_tenant(job_tenant_id) not in ('owner', 'admin') then
    raise exception 'not a member of this tenant';
  end if;

  insert into public.events (tenant_id, type, payload, correlation_id)
  values (
    job_tenant_id,
    'video.bg_replace.requested',
    jsonb_build_object('jobId', target_job_id),
    gen_random_uuid()
  );
end;
$$;

revoke all on function public.request_video_bg_replace(uuid) from public;
grant execute on function public.request_video_bg_replace(uuid) to authenticated;
