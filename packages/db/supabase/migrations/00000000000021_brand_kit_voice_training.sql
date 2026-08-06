-- brand_kits.voice_training — guía libre del tenant para TODA generación de
-- contenido (copy e imágenes): tono, temas puntuales a tener en cuenta,
-- cosas a evitar. Separado de tone_description (un preset corto) porque
-- esto es texto libre más largo, tipo "entrenamiento" del agente.
alter table public.brand_kits add column voice_training text;
