-- Fechas especiales (Fiestas Patrias, etc.) pueden pedir un guiño visual
-- distinto a los colores de marca del tenant — nullable a propósito, la
-- inmensa mayoría de efemérides no necesita ninguno.

alter table public.ephemerides
  add column accent_color_primary text,
  add column accent_color_secondary text;
