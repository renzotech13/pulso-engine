-- Hasta acá el sistema era, por diseño, UNA publicación por día por tenant:
-- `unique (tenant_id, date)` en content_calendar lo garantizaba y todo lo
-- demás asumía eso (el Planner trata "día con slot" como día lleno, la UI
-- del calendario mapea fecha → slot, "usar idea" de /news falla con "ya hay
-- contenido para ese día").
--
-- AZ Estudio Contable necesita dos al día: uno evergreen del Planner por la
-- mañana y uno de actualidad tributaria por la tarde, alimentado por el
-- agente de noticias que ya corre a diario. El día pasa entonces a tener
-- slots numerados.
--
-- Nada de esto cambia el comportamiento de los tenants que ya existen: todos
-- quedan con slot_index = 0 y publish_hours = '{}', que es exactamente lo que
-- hacían antes (un slot por día, que sale apenas llega su fecha).
alter table public.content_calendar
  drop constraint content_calendar_tenant_id_date_key;

alter table public.content_calendar
  add column slot_index smallint not null default 0
    check (slot_index between 0 and 3);

alter table public.content_calendar
  add constraint content_calendar_tenant_date_slot_key unique (tenant_id, date, slot_index);

-- Hora local (America/Lima) a partir de la cual este slot puede publicarse.
-- NULL = comportamiento histórico: sale apenas la fecha llega, sin esperar
-- ninguna hora. publish.tick corre cada hora, así que esta es la resolución
-- real con la que se respeta.
alter table public.content_calendar
  add column publish_hour smallint
    check (publish_hour between 0 and 23);

-- Agenda de publicación del tenant: una hora por slot del día, en orden.
-- '{}' (el default) = un post al día sin hora fija — lo de siempre.
-- '{9,18}' = dos al día, el slot 0 a las 9am y el slot 1 a las 6pm.
-- La cantidad de posts diarios se deriva de acá en vez de vivir en su propia
-- columna, para que no puedan contradecirse entre sí.
alter table public.tenants
  add column publish_hours smallint[] not null default '{}'::smallint[]
    check (
      array_length(publish_hours, 1) is null
      or (array_length(publish_hours, 1) <= 4 and publish_hours <@ array(select generate_series(0, 23))::smallint[])
    );
