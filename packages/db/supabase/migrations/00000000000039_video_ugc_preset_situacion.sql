-- Preset "situación con voz en off" dentro de la Fábrica de video UGC: el mismo trabajo (video_ugc_jobs,
-- misma cola, misma pantalla de resultados) puede ser un video UGC (Veo) o una situación de 4 tomas con
-- voz en off. Las columnas de UGC siguen siendo obligatorias en su tipo, así que para 'situacion' se
-- rellenan con textos vacíos y el contenido real vive en `situacion` (jsonb validado con Zod en el borde).

alter table public.video_ugc_jobs
  add column preset text not null default 'ugc' check (preset in ('ugc', 'situacion')),
  add column situacion jsonb;

alter table public.video_ugc_jobs alter column frame_path drop not null;
alter table public.video_ugc_jobs alter column escena drop not null;
alter table public.video_ugc_jobs alter column guion_a drop not null;
alter table public.video_ugc_jobs alter column guion_b drop not null;

alter table public.video_ugc_jobs
  add constraint video_ugc_jobs_contenido_chk check (
    (preset = 'ugc' and frame_path is not null and escena is not null and guion_a is not null and guion_b is not null)
    or (preset = 'situacion' and situacion is not null)
  );
