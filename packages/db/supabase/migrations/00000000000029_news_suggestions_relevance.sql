-- El slot de actualidad tomaba la sugerencia pendiente MÁS RECIENTE, que no
-- es lo mismo que la más útil: una nota tangencial publicada hace una hora
-- le ganaba a una directamente sobre el rubro publicada ayer. El agente de
-- noticias ya juzga relevancia para elegir qué titulares guardar; ahora
-- también dice cuánto, y esa nota es la que ordena.
--
-- NULL = sugerencia guardada antes de que esto existiera; se ordena al final
-- sin desaparecer.
alter table public.news_suggestions
  add column relevance smallint check (relevance between 1 and 5);
