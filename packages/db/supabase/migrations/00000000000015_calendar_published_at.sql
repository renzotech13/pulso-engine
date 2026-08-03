-- Bug real encontrado probando full-auto: regenerar un creative lo BORRA
-- (regenerateCreativeAction hace un DELETE, y publications.creative_id tiene
-- ON DELETE CASCADE) — así que su historial de publicaciones desaparece con
-- él. El chequeo de "¿ya se publicó esto?" vivía solo en `publications`,
-- indexado por creative_id, así que un creative regenerado para el mismo día
-- no tenía memoria de que ese día YA se había publicado, y el sistema lo
-- volvía a postear de verdad — pasó con un post real de un cliente.
--
-- content_calendar es lo único que sobrevive a una regeneración (el slot es
-- el mismo, solo cambia qué creative tiene enganchado), así que ahí es donde
-- tiene que vivir esta bandera, no en publications ni en creatives.

alter table public.content_calendar
  add column published_at timestamptz;
