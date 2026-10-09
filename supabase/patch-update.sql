-- ============================================================================
-- ESPAÇO LIGIA DE MAYOR - PATCH DE ATUALIZAÇÃO (REVISÃO DE SEGURANÇA E REGRAS)
-- ============================================================================
-- Execute este script no SQL Editor do Supabase caso você já tenha executado
-- uma versão anterior da migração. Este script preserva os dados existentes
-- e aplica as revisões estritas solicitadas:
--
-- 1. Validação de fuso America/Sao_Paulo em trg_check_reservation_collision (mesma data local)
-- 2. Política e gatilho de cancelamento estrito (ativo, proprietário, confirmado, futuro, imutabilidade)
-- 3. Atualização de availability_revisions cobrindo OLD e NEW ao mudar de sala ou período
-- 4. Substituição de GRANT ALL por privilégios mínimos explícitos e revogações
-- 5. Funções SECURITY DEFINER com search_path = public, pg_temp e EXECUTE restrito (sem PUBLIC)
-- 6. Limpeza de descrições não confirmadas nas salas oficiais
-- 7. Adição de operating_hours e spaces ao canal Supabase Realtime
-- ============================================================================

DO $$
BEGIN
  -- 1. Alinha nomes das salas oficiais e remove descrições não confirmadas
  UPDATE public.spaces SET name = 'Sala de Pilates', description = NULL 
  WHERE name ILIKE '%pilates%';

  UPDATE public.spaces SET name = 'Sala de massoterapia', description = NULL 
  WHERE name ILIKE '%massoterapia%' OR name ILIKE '%clínico%' OR name ILIKE '%clinico%';

  -- Insere caso ainda não existam
  INSERT INTO public.spaces (name, description, display_order)
  SELECT 'Sala de Pilates', NULL, 1
  WHERE NOT EXISTS (SELECT 1 FROM public.spaces WHERE name = 'Sala de Pilates');

  INSERT INTO public.spaces (name, description, display_order)
  SELECT 'Sala de massoterapia', NULL, 2
  WHERE NOT EXISTS (SELECT 1 FROM public.spaces WHERE name = 'Sala de massoterapia');
END $$;

-- 2. REVISÃO DO GATILHO DE COLISÃO COM VALIDAÇÃO COMPLETA NO FUSO (AMERICA/SAO_PAULO)
CREATE OR REPLACE FUNCTION public.trg_check_reservation_collision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_local timestamp;
  v_end_local timestamp;
  v_start_date date;
  v_end_date date;
  v_dow int;
  v_start_time_of_day time;
  v_end_time_of_day time;
  v_op public.operating_hours%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.spaces WHERE id = NEW.space_id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = NEW.professional_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas profissionais ativos podem criar reservas.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.spaces WHERE id = NEW.space_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'O espaço selecionado não está ativo para agendamentos.'
      USING ERRCODE = '22000';
  END IF;

  -- Validação do intervalo completo no fuso America/Sao_Paulo:
  v_start_local := NEW.start_time AT TIME ZONE 'America/Sao_Paulo';
  v_end_local := NEW.end_time AT TIME ZONE 'America/Sao_Paulo';
  v_start_date := v_start_local::date;
  v_end_date := v_end_local::date;

  IF v_start_date <> v_end_date THEN
    RAISE EXCEPTION 'A reserva deve iniciar e terminar na mesma data local (America/Sao_Paulo).'
      USING ERRCODE = '22000';
  END IF;

  v_dow := EXTRACT(DOW FROM v_start_local)::int;
  v_start_time_of_day := v_start_local::time;
  v_end_time_of_day := v_end_local::time;

  SELECT * INTO v_op
  FROM public.operating_hours
  WHERE space_id = NEW.space_id AND day_of_week = v_dow;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Horário de funcionamento não configurado para este espaço nesta data.'
      USING ERRCODE = '22000';
  END IF;

  IF NOT v_op.is_open THEN
    RAISE EXCEPTION 'O espaço está fechado nesta data conforme configuração de funcionamento.'
      USING ERRCODE = '22000';
  END IF;

  IF v_start_time_of_day < v_op.opening_time OR v_end_time_of_day > v_op.closing_time THEN
    RAISE EXCEPTION 'A reserva deve respeitar o horário de funcionamento do espaço (% às %).',
      to_char(v_op.opening_time, 'HH24:MI'), to_char(v_op.closing_time, 'HH24:MI')
      USING ERRCODE = '22000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.space_blocks sb
    WHERE sb.space_id = NEW.space_id
      AND tstzrange(sb.start_time, sb.end_time, '[)') && tstzrange(NEW.start_time, NEW.end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'O espaço selecionado possui um bloqueio administrativo neste horário.'
      USING ERRCODE = '23P01';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.start_time < (now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Não é permitido criar reservas para horários passados.'
      USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_reservation_collision ON public.reservations;
CREATE TRIGGER trg_validate_reservation_collision
  BEFORE INSERT OR UPDATE ON public.reservations
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed')
  EXECUTE FUNCTION public.trg_check_reservation_collision();

-- 3. REVISÃO DO GATILHO DE CANCELAMENTO ESTRITO
CREATE OR REPLACE FUNCTION public.trg_validate_reservation_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NOT public.is_active_professional() THEN
      RAISE EXCEPTION 'Acesso negado: apenas profissionais ativos podem cancelar reservas.'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.professional_id <> auth.uid() THEN
      RAISE EXCEPTION 'Apenas o proprietário da reserva pode solicitar o cancelamento.'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.status <> 'confirmed' THEN
      RAISE EXCEPTION 'Apenas reservas confirmadas podem ser canceladas.'
        USING ERRCODE = '22000';
    END IF;

    IF OLD.start_time <= now() THEN
      RAISE EXCEPTION 'Não é permitido cancelar reservas retroativas ou que já tenham iniciado.'
        USING ERRCODE = '22000';
    END IF;

    IF NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'Operação negada: profissionais só podem alterar o status para cancelado.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.id <> OLD.id OR
       NEW.space_id <> OLD.space_id OR
       NEW.professional_id <> OLD.professional_id OR
       NEW.start_time <> OLD.start_time OR
       NEW.end_time <> OLD.end_time OR
       NEW.created_at <> OLD.created_at OR
       COALESCE(NEW.notes, '') <> COALESCE(OLD.notes, '') THEN
      RAISE EXCEPTION 'Apenas o status de cancelamento pode ser alterado. Todos os demais dados da reserva são imutáveis.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_reservation_update ON public.reservations;
CREATE TRIGGER trg_validate_reservation_update
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_validate_reservation_update();

-- 4. REVISÃO DA POLÍTICA DE CANCELAMENTO RLS
DROP POLICY IF EXISTS "reservations_update_cancel_policy" ON public.reservations;
CREATE POLICY "reservations_update_cancel_policy" ON public.reservations
  FOR UPDATE TO authenticated
  USING (
    (
      public.is_active_professional()
      AND professional_id = auth.uid()
      AND status = 'confirmed'
      AND start_time > now()
    )
    OR public.is_admin()
  )
  WITH CHECK (
    (
      public.is_active_professional()
      AND professional_id = auth.uid()
      AND status = 'cancelled'
    )
    OR public.is_admin()
  );

-- 5. REVISÃO DO TRIGGER DE ATUALIZAÇÃO DA TABELA DE REVISÃO (OLD E NEW)
CREATE OR REPLACE FUNCTION public.trg_bump_availability_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_curr_date date;
  v_new_start_date date;
  v_new_end_date date;
  v_old_start_date date;
  v_old_end_date date;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_start_date := (NEW.start_time AT TIME ZONE 'America/Sao_Paulo')::date;
    v_new_end_date := (NEW.end_time AT TIME ZONE 'America/Sao_Paulo')::date;
    v_curr_date := v_new_start_date;
    WHILE v_curr_date <= v_new_end_date LOOP
      INSERT INTO public.availability_revisions (space_id, target_date, revision, updated_at)
      VALUES (NEW.space_id, v_curr_date, 1, now())
      ON CONFLICT (space_id, target_date)
      DO UPDATE SET revision = public.availability_revisions.revision + 1, updated_at = now();

      v_curr_date := v_curr_date + 1;
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' OR (
    TG_OP = 'UPDATE' AND (
      OLD.space_id <> NEW.space_id OR 
      OLD.start_time <> NEW.start_time OR 
      OLD.end_time <> NEW.end_time
    )
  ) THEN
    v_old_start_date := (OLD.start_time AT TIME ZONE 'America/Sao_Paulo')::date;
    v_old_end_date := (OLD.end_time AT TIME ZONE 'America/Sao_Paulo')::date;
    v_curr_date := v_old_start_date;
    WHILE v_curr_date <= v_old_end_date LOOP
      INSERT INTO public.availability_revisions (space_id, target_date, revision, updated_at)
      VALUES (OLD.space_id, v_curr_date, 1, now())
      ON CONFLICT (space_id, target_date)
      DO UPDATE SET revision = public.availability_revisions.revision + 1, updated_at = now();

      v_curr_date := v_curr_date + 1;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservations_bump_availability ON public.reservations;
CREATE TRIGGER trg_reservations_bump_availability
  AFTER INSERT OR UPDATE OR DELETE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_bump_availability_revision();

DROP TRIGGER IF EXISTS trg_blocks_bump_availability ON public.space_blocks;
CREATE TRIGGER trg_blocks_bump_availability
  AFTER INSERT OR UPDATE OR DELETE ON public.space_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_bump_availability_revision();

-- 6. REVISÃO DAS DEMAIS FUNÇÕES DE SEGURANÇA (SECURITY DEFINER E SEARCH_PATH)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_professional()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.get_space_availability(
  p_space_id uuid,
  p_date date
)
RETURNS TABLE (
  start_time timestamptz,
  end_time timestamptz,
  is_mine boolean,
  slot_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_caller uuid;
BEGIN
  v_caller := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_caller AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Acesso não autorizado: profissional inativo ou não cadastrado.'
      USING ERRCODE = '42501';
  END IF;

  v_day_start := (p_date::text || ' 00:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_day_end := (p_date::text || ' 23:59:59')::timestamp AT TIME ZONE 'America/Sao_Paulo';

  RETURN QUERY
    SELECT
      r.start_time,
      r.end_time,
      (r.professional_id = v_caller) AS is_mine,
      'busy'::text AS slot_status
    FROM public.reservations r
    WHERE r.space_id = p_space_id
      AND r.status = 'confirmed'
      AND r.start_time < v_day_end
      AND r.end_time > v_day_start

    UNION ALL

    SELECT
      sb.start_time,
      sb.end_time,
      false AS is_mine,
      'blocked'::text AS slot_status
    FROM public.space_blocks sb
    WHERE sb.space_id = p_space_id
      AND sb.start_time < v_day_end
      AND sb.end_time > v_day_start
    
    ORDER BY start_time ASC;
END;
$$;

-- 7. REVISÃO DE PRIVILÉGIOS MÍNIMOS EXPLÍCITOS (REVOGAR GRANT ALL E EXECUTE PUBLIC)
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

REVOKE ALL ON public.spaces FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spaces TO authenticated;

REVOKE ALL ON public.operating_hours FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_hours TO authenticated;

REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

REVOKE ALL ON public.space_blocks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.space_blocks TO authenticated;

REVOKE ALL ON public.reservations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reservations TO authenticated;

REVOKE ALL ON public.availability_revisions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.availability_revisions TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_active_professional() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_space_availability(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_check_reservation_collision() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_check_block_collision() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_reservation_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_bump_availability_revision() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_professional() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_space_availability(uuid, date) TO authenticated;

-- 8. SINCRONIZAÇÃO DO REALTIME COM OPERATING_HOURS E SPACES
ALTER TABLE public.operating_hours REPLICA IDENTITY FULL;
ALTER TABLE public.spaces REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'operating_hours'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.operating_hours;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'spaces'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.spaces;
  END IF;
END $$;
