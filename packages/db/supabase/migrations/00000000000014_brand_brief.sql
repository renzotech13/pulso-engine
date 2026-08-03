-- Brief del negocio: hasta ahora brand_kits solo tenía tono de voz libre
-- (tone_description). Esto agrega un lugar real donde dejar contexto del
-- cliente que el Planner/Creative puedan usar más adelante — el sitio web
-- y un documento de brief (PDF o TXT). El documento se sube al mismo bucket
-- brand-assets (ya público, ya con políticas de insert/delete por tenant),
-- no hace falta un bucket nuevo.

alter table public.brand_kits
  add column website_url text,
  add column brief_document_url text,
  add column brief_document_name text;
