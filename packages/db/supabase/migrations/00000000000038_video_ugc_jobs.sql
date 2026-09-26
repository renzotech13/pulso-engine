-- Fábrica de video UGC: un trabajo = un video vertical de una protagonista
-- hablando a cámara (Veo vía APIMart: tramo de 8 s + extensión), con destello
-- en el empalme y los elementos de marca encima (título, precio, CTA, pill de
-- WhatsApp). Independiente de video_projects a propósito: acá no hay tomas
-- crudas ni guion en PDF, el "guion" es el texto que el modelo dice. Los
-- lotes son varios trabajos con el mismo batch_id. Mismo patrón que
-- video_bg_replace_jobs (migración 35): el worker del editor de video corre
-- en la Mac y escribe status/progress/output; la web solo crea y lee.

create table public.video_ugc_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  batch_id uuid,
  nombre text not null,
  model text not null default 'veo3.1-fast',
  -- Foto de la protagonista (primer cuadro), ruta dentro de video-editor-assets.
  frame_path text not null,
  -- Escena descrita en inglés para el prompt ("in her bright kitchen, confident").
  escena text not null,
  -- Guion en dos partes: A = primer tramo (≤ ~8 s), B = extensión (≤ ~7 s).
  -- El precio se escribe "treintaynueve con noventa" (una palabra) para que
  -- el modelo no haga pausa entre "treinta" y "y nueve".
  guion_a text not null,
  guion_b text not null,
  -- Elementos elegidos y sus textos: { titulo: {clave, texto1, texto2, yFrac?},
  -- precio: {clave}, cta: {clave, linea1, linea2}, whatsapp: bool,
  -- destello: {paleta}|null }. Validado en el borde (Zod) por la web y el worker.
  elementos jsonb not null default '{}'::jsonb,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'generando', 'extendiendo', 'armando', 'listo', 'error')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  -- IDs de las tareas de APIMart (para reintentar la extensión sin regenerar
  -- el primer tramo) y costo real acumulado en USD.
  task_ids jsonb not null default '{}'::jsonb,
  cost_usd numeric not null default 0,
  saldo_apimart numeric,
  output_path text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.video_ugc_jobs enable row level security;
alter table public.video_ugc_jobs force row level security;

create policy video_ugc_jobs_select on public.video_ugc_jobs
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy video_ugc_jobs_insert on public.video_ugc_jobs
  for insert
  with check (tenant_id in (select private.user_tenant_ids()));

create policy video_ugc_jobs_delete on public.video_ugc_jobs
  for delete
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

-- Sin política de update: status/progress/costos/output solo los escribe el
-- worker (service_role, bypassa RLS).

create trigger video_ugc_jobs_set_updated_at
  before update on public.video_ugc_jobs
  for each row
  execute function private.set_updated_at();

create index video_ugc_jobs_tenant_created_idx on public.video_ugc_jobs (tenant_id, created_at desc);
create index video_ugc_jobs_batch_idx on public.video_ugc_jobs (batch_id) where batch_id is not null;

-- Mismo patrón que request_video_bg_replace: la web inserta las filas y luego
-- pide procesarlas; cada trabajo emite su evento (una cola de la Mac, de a uno).
create or replace function public.request_video_ugc(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_tenant_id uuid;
begin
  select tenant_id into job_tenant_id
  from public.video_ugc_jobs
  where id = target_job_id;

  if job_tenant_id is null then
    raise exception 'ugc job not found';
  end if;

  if private.user_role_for_tenant(job_tenant_id) not in ('owner', 'admin') then
    raise exception 'not a member of this tenant';
  end if;

  update public.video_ugc_jobs
  set status = 'pendiente', progress = 0, error_message = null
  where id = target_job_id;

  insert into public.events (tenant_id, type, payload, correlation_id)
  values (
    job_tenant_id,
    'video.ugc.requested',
    jsonb_build_object('jobId', target_job_id),
    gen_random_uuid()
  );
end;
$$;

revoke all on function public.request_video_ugc(uuid) from public;
grant execute on function public.request_video_ugc(uuid) to authenticated;
