-- Frases que el cliente prohibió por nombre ("sin sustos" en AZ Estudio
-- Contable). Ya estaban escritas dos veces en el brand kit (tono y
-- entrenamiento) y el LLM local las usó igual en una pieza real — un
-- "nunca digas X" en el prompt no es una garantía con un modelo local.
-- Esta lista se valida en código contra la copy generada (headline,
-- subheadline, caption, slides) y dispara el reintento del LLM si aparece
-- alguna, igual que un JSON mal formado. '{}' = sin lista, sin cambios.
alter table public.brand_kits
  add column banned_phrases text[] not null default '{}'::text[];
