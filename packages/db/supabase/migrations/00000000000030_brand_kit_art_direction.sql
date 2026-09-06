-- Los prompts de imagen recibían tone_description + voice_training enteros:
-- 11.000 caracteres de reglas de REDACCIÓN (CTAs, firmas, remates de marca,
-- frases prohibidas). Gemini hizo lo previsible y los dibujó dentro de la
-- foto — un post real salió publicado con "Soy Angel Zegarra..." y un botón
-- de WhatsApp pintados en la imagen, con faltas de ortografía. La orden de
-- "no pongas texto" quedaba sepultada entre instrucciones para escribir.
--
-- Esta columna es lo ÚNICO que ven los prompts de imagen cuando está puesta:
-- paleta, tipo de fotografía, escenas, qué evitar. NULL = se mantiene el
-- comportamiento anterior, así ningún tenant cambia sin configurarla.
alter table public.brand_kits
  add column art_direction text;
