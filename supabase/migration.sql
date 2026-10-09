-- ============================================================================
-- ESPAÇO LIGIA DE MAYOR - MIGRAÇÃO OFICIAL SUPABASE (ÁREA PRIVADA DE RESERVAS)
-- ============================================================================
-- Espaço: Sala de Pilates & Sala de massoterapia
-- Fuso Horário Oficial: America/Sao_Paulo (UTC-03:00)
--
-- REGRAS E SEGURANÇA:
-- 1. Serialização e exclusão atômica via btree_gist (sem sobreposição de horários)
-- 2. Validação no fuso America/Sao_Paulo: início e término na mesma data local
-- 3. Cancelamento estrito: profissional ativo, proprietário, status confirmado,
--    início futuro e preservação de todos os outros campos (id, created_at, etc.)
-- 4. Gatilho de availability_revisions: atualiza datas de OLD e NEW ao alterar sala/período
-- 5. Privilégios mínimos explícitos: sem GRANT ALL, revogação de permissões desnecessárias
-- 6. Funções SECURITY DEFINER com search_path fixo (public, pg_temp) e EXECUTE restrito
-- 7. Cadastro das duas salas oficiais sem descrições de equipamentos não confirmados
-- ============================================================================

-- 1. EXTENSÃO PARA RESTRIÇÃO DE EXCLUSÃO ATÔMICA
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. TABELA DE PERFIS DOS PROFISSIONAIS
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'professional')) DEFAULT 'professional',
  is_active boolean NOT NULL DEFAULT false, -- Apenas administradores ativam profissionais
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. TABELA DE ESPAÇOS / SALAS FÍSICAS (Sala de Pilates e Sala de massoterapia)
CREATE TABLE IF NOT EXISTS public.spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. TABELA DE HORÁRIOS DE FUNCIONAMENTO (CONFIGURADOS POR SALA E DIA DA SEMANA)
-- day_of_week: 0 = Domingo, 1 = Segunda, 2 = Terça, ..., 6 = Sábado
CREATE TABLE IF NOT EXISTS public.operating_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open boolean NOT NULL DEFAULT true,
  opening_time time NOT NULL DEFAULT '07:00:00',
  closing_time time NOT NULL DEFAULT '21:00:00',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_space_day_of_week UNIQUE (space_id, day_of_week),
  CONSTRAINT chk_operating_hours_time CHECK (closing_time > opening_time)
);

CREATE INDEX IF NOT EXISTS idx_operating_hours_lookup 
  ON public.operating_hours (space_id, day_of_week);

-- 5. TABELA DE BLOQUEIOS ADMINISTRATIVOS (MANUTENÇÃO, FERIADOS, USO INTERNO)
CREATE TABLE IF NOT EXISTS public.space_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_space_block_time CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_space_blocks_range 
  ON public.space_blocks USING gist (space_id, tstzrange(start_time, end_time, '[)'));

-- 6. TABELA DE RESERVAS COM PROTEÇÃO ATÔMICA CONTRA SOBREPOSIÇÃO
CREATE TABLE IF NOT EXISTS public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  professional_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('confirmed', 'cancelled')) DEFAULT 'confirmed',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_reservation_time CHECK (end_time > start_time),
  -- RESTRIÇÃO DE EXCLUSÃO ATÔMICA: Garante que nenhuma reserva confirmada sobreponha outra no mesmo espaço
  CONSTRAINT no_overlapping_reservations EXCLUDE USING gist (
    space_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status = 'confirmed')
);

CREATE INDEX IF NOT EXISTS idx_reservations_space_time 
  ON public.reservations (space_id, start_time, end_time) 
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_reservations_professional 
  ON public.reservations (professional_id, start_time DESC);

-- 7. TABELA DE REVISÃO DE DISPONIBILIDADE (TEMPO REAL SEGURO & ANÔNIMO)
-- Usada para notificar clientes via Realtime SEM expor dados de colegas ou pacientes
CREATE TABLE IF NOT EXISTS public.availability_revisions (
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  target_date date NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, target_date)
);

-- ============================================================================
-- 8. FUNÇÕES PRIVILEGIADAS E DE APOIO DE SEGURANÇA (SECURITY DEFINER)
-- ============================================================================

-- JUSTIFICATIVA SECURITY DEFINER (is_admin):
-- Permite avaliar se o usuário autenticado atual possui perfil ativo de 'admin' em public.profiles.
-- Necessário contornar o RLS padrão para evitar recursão infinita ao consultar profiles dentro de políticas de RLS.
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

-- JUSTIFICATIVA SECURITY DEFINER (is_active_professional):
-- Permite avaliar se o usuário autenticado atual é um profissional ativo sem incorrer em recursão de RLS
-- nas tabelas reservations, spaces e operating_hours.
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

-- JUSTIFICATIVA SECURITY DEFINER (trg_check_reservation_collision):
-- Executado por trigger para validar atomicamente conflito contra bloqueios (space_blocks),
-- verificar horário de funcionamento configurado e travar a linha de spaces via FOR UPDATE.
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
  -- Trava a linha da sala para serializar transações concorrentes
  PERFORM 1 FROM public.spaces WHERE id = NEW.space_id FOR UPDATE;

  -- 1. Verifica se o profissional é ativo
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = NEW.professional_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas profissionais ativos podem criar reservas.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Verifica se a sala está ativa
  IF NOT EXISTS (
    SELECT 1 FROM public.spaces WHERE id = NEW.space_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'O espaço selecionado não está ativo para agendamentos.'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Validação do intervalo completo no fuso America/Sao_Paulo:
  -- Rejeita reservas cujo início e término pertençam a datas locais diferentes (não compara apenas time).
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

  -- 4. Consulta horários de funcionamento configurados para a sala neste dia da semana
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

  -- 5. Verifica colisão com bloqueios administrativos ativos
  IF EXISTS (
    SELECT 1 FROM public.space_blocks sb
    WHERE sb.space_id = NEW.space_id
      AND tstzrange(sb.start_time, sb.end_time, '[)') && tstzrange(NEW.start_time, NEW.end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'O espaço selecionado possui um bloqueio administrativo neste horário.'
      USING ERRCODE = '23P01';
  END IF;

  -- 6. Impede agendamento retroativo (tolerância de 5 minutos para latência de relógio)
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

-- JUSTIFICATIVA SECURITY DEFINER (trg_check_block_collision):
-- Permite verificar se o bloqueio administrativo proposto colide com reservas existentes de qualquer usuário.
CREATE OR REPLACE FUNCTION public.trg_check_block_collision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM public.spaces WHERE id = NEW.space_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.space_id = NEW.space_id
      AND r.status = 'confirmed'
      AND tstzrange(r.start_time, r.end_time, '[)') && tstzrange(NEW.start_time, NEW.end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'Não é possível criar o bloqueio: já existem reservas confirmadas no espaço para este período.'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_block_collision ON public.space_blocks;
CREATE TRIGGER trg_validate_block_collision
  BEFORE INSERT OR UPDATE ON public.space_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_check_block_collision();

-- JUSTIFICATIVA SECURITY DEFINER (trg_validate_reservation_update):
-- Garante integridade no cancelamento: profissional ativo, proprietário, status anterior confirmed,
-- início futuro, imutabilidade estrita de todos os outros campos (incluindo id e created_at).
CREATE OR REPLACE FUNCTION public.trg_validate_reservation_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    -- 1. Exige profissional ativo
    IF NOT public.is_active_professional() THEN
      RAISE EXCEPTION 'Acesso negado: apenas profissionais ativos podem cancelar reservas.'
        USING ERRCODE = '42501';
    END IF;

    -- 2. Exige proprietário da reserva
    IF OLD.professional_id <> auth.uid() THEN
      RAISE EXCEPTION 'Apenas o proprietário da reserva pode solicitar o cancelamento.'
        USING ERRCODE = '42501';
    END IF;

    -- 3. Exige status anterior confirmed
    IF OLD.status <> 'confirmed' THEN
      RAISE EXCEPTION 'Apenas reservas confirmadas podem ser canceladas.'
        USING ERRCODE = '22000';
    END IF;

    -- 4. Exige início futuro (não permite cancelar após o início ou reservas passadas)
    IF OLD.start_time <= now() THEN
      RAISE EXCEPTION 'Não é permitido cancelar reservas retroativas ou que já tenham iniciado.'
        USING ERRCODE = '22000';
    END IF;

    -- 5. Exige novo status = 'cancelled'
    IF NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'Operação negada: profissionais só podem alterar o status para cancelado.'
        USING ERRCODE = '42501';
    END IF;

    -- 6. Preserva estritamente todos os campos além do status e do updated_at (incluindo id e created_at)
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

-- JUSTIFICATIVA SECURITY DEFINER (trg_bump_availability_revision):
-- Permite incrementar a tabela availability_revisions no momento de inserção, alteração ou cancelamento.
-- Quando uma reserva ou bloqueio muda de sala ou período, atualiza as datas afetadas tanto de OLD quanto de NEW.
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
  -- Se for INSERT ou UPDATE, atualiza todas as datas afetadas de NEW
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

  -- Se for DELETE, ou se for UPDATE e mudou de sala ou mudou período de início/fim:
  -- atualiza também todas as datas afetadas de OLD
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

-- JUSTIFICATIVA SECURITY DEFINER (get_space_availability):
-- Permite que profissionais ativos consultem os horários ocupados de uma sala sem expor a identidade
-- dos outros profissionais, anotações de clientes ou dados sigilosos que o RLS de reservations protege.
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

  -- Verifica se quem chamou é um profissional ativo
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
    -- Reservas confirmadas no espaço (sem expor identificação de colegas ou pacientes)
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

    -- Bloqueios administrativos
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

-- JUSTIFICATIVA SECURITY DEFINER (handle_new_user):
-- Executado via trigger de auth.users ao registrar um novo usuário para provisionar
-- a linha em public.profiles como 'professional' e inativo (is_active = false).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, is_active, phone)
  VALUES (
    NEW.id,
    COALESCE(split_part(NEW.email, '@', 1), 'Profissional'),
    'professional',
    false, -- SEGURANÇA: sempre inativo até aprovação administrativa
    NULL
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 9. HABILITAÇÃO DO ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_revisions ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS: PROFILES
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_admin_insert" ON public.profiles;
CREATE POLICY "profiles_admin_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;
CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- POLÍTICAS: SPACES
DROP POLICY IF EXISTS "spaces_select_policy" ON public.spaces;
CREATE POLICY "spaces_select_policy" ON public.spaces
  FOR SELECT TO authenticated
  USING ((public.is_active_professional() AND is_active = true) OR public.is_admin());

DROP POLICY IF EXISTS "spaces_admin_all" ON public.spaces;
CREATE POLICY "spaces_admin_all" ON public.spaces
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- POLÍTICAS: OPERATING_HOURS
DROP POLICY IF EXISTS "operating_hours_select" ON public.operating_hours;
CREATE POLICY "operating_hours_select" ON public.operating_hours
  FOR SELECT TO authenticated
  USING (public.is_active_professional() OR public.is_admin());

DROP POLICY IF EXISTS "operating_hours_admin_all" ON public.operating_hours;
CREATE POLICY "operating_hours_admin_all" ON public.operating_hours
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- POLÍTICAS: SPACE_BLOCKS
DROP POLICY IF EXISTS "space_blocks_select_policy" ON public.space_blocks;
CREATE POLICY "space_blocks_select_policy" ON public.space_blocks
  FOR SELECT TO authenticated
  USING (public.is_active_professional() OR public.is_admin());

DROP POLICY IF EXISTS "space_blocks_admin_all" ON public.space_blocks;
CREATE POLICY "space_blocks_admin_all" ON public.space_blocks
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- POLÍTICAS: RESERVATIONS
DROP POLICY IF EXISTS "reservations_select_policy" ON public.reservations;
CREATE POLICY "reservations_select_policy" ON public.reservations
  FOR SELECT TO authenticated
  USING ((public.is_active_professional() AND professional_id = auth.uid()) OR public.is_admin());

DROP POLICY IF EXISTS "reservations_insert_policy" ON public.reservations;
CREATE POLICY "reservations_insert_policy" ON public.reservations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_professional()
    AND professional_id = auth.uid()
    AND status = 'confirmed'
  );

-- POLÍTICA DE CANCELAMENTO ESTRITO:
-- Exige profissional ativo, proprietário da reserva, status anterior confirmed e início futuro.
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

-- POLÍTICAS: AVAILABILITY_REVISIONS
DROP POLICY IF EXISTS "availability_revisions_select" ON public.availability_revisions;
CREATE POLICY "availability_revisions_select" ON public.availability_revisions
  FOR SELECT TO authenticated
  USING (public.is_active_professional() OR public.is_admin());

DROP POLICY IF EXISTS "availability_revisions_admin_all" ON public.availability_revisions;
CREATE POLICY "availability_revisions_admin_all" ON public.availability_revisions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- 10. PRIVILÉGIOS MÍNIMOS EXPLÍCITOS (SEM GRANT ALL, REVOGAÇÕES COMPLETAS)
-- ============================================================================

-- Revoga permissões prévias amplas do PUBLIC e roles
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Concede uso seguro do schema public
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Tabela spaces: apenas SELECT para authenticated em geral; INSERT, UPDATE, DELETE controlados por RLS para admin
REVOKE ALL ON public.spaces FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spaces TO authenticated;

-- Tabela operating_hours: SELECT para leitura; mutações restritas por RLS
REVOKE ALL ON public.operating_hours FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_hours TO authenticated;

-- Tabela profiles: SELECT e UPDATE controlados por RLS; sem DELETE
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

-- Tabela space_blocks: SELECT, INSERT, UPDATE, DELETE controlados por RLS
REVOKE ALL ON public.space_blocks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.space_blocks TO authenticated;

-- Tabela reservations: SELECT, INSERT e UPDATE (apenas cancelamento). Proibição total de DELETE
REVOKE ALL ON public.reservations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reservations TO authenticated;

-- Tabela availability_revisions: SELECT, INSERT, UPDATE
REVOKE ALL ON public.availability_revisions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.availability_revisions TO authenticated;

-- Funções: Remove permissão pública padrão e concede apenas às funções necessárias para authenticated
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_active_professional() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_space_availability(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_check_reservation_collision() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_check_block_collision() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_reservation_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_bump_availability_revision() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_professional() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_space_availability(uuid, date) TO authenticated;

-- ============================================================================
-- 11. CONFIGURAÇÃO DO SUPABASE REALTIME
-- ============================================================================

ALTER TABLE public.reservations REPLICA IDENTITY FULL;
ALTER TABLE public.space_blocks REPLICA IDENTITY FULL;
ALTER TABLE public.availability_revisions REPLICA IDENTITY FULL;
ALTER TABLE public.operating_hours REPLICA IDENTITY FULL;
ALTER TABLE public.spaces REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'availability_revisions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_revisions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'reservations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'space_blocks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.space_blocks;
  END IF;

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

-- ============================================================================
-- 12. SEED DAS SALAS REAIS DO ESPAÇO LÍGIA DE MAYOR
-- ============================================================================
-- Cadastra somente os nomes oficiais confirmados das salas, sem descrições de equipamentos não confirmados.
INSERT INTO public.spaces (name, description, display_order)
SELECT 'Sala de Pilates', NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM public.spaces WHERE name = 'Sala de Pilates');

INSERT INTO public.spaces (name, description, display_order)
SELECT 'Sala de massoterapia', NULL, 2
WHERE NOT EXISTS (SELECT 1 FROM public.spaces WHERE name = 'Sala de massoterapia');

-- Garante que descrições não confirmadas anteriores sejam limpas
UPDATE public.spaces 
SET description = NULL 
WHERE name IN ('Sala de Pilates', 'Sala de massoterapia');

-- ============================================================================
-- 13. SEED DOS HORÁRIOS INICIAIS DE FUNCIONAMENTO DAS DUAS SALAS
-- ============================================================================
-- O Administrador pode alterar esses horários a qualquer momento pelo painel da Área Privada.
DO $$
DECLARE
  v_pilates_id uuid;
  v_massoterapia_id uuid;
  v_day int;
BEGIN
  SELECT id INTO v_pilates_id FROM public.spaces WHERE name = 'Sala de Pilates';
  SELECT id INTO v_massoterapia_id FROM public.spaces WHERE name = 'Sala de massoterapia';

  -- Horários da Sala de Pilates:
  -- Segunda a Sexta (1 a 5): 07:00 às 21:00
  -- Sábado (6): 08:00 às 13:00
  -- Domingo (0): Fechado
  IF v_pilates_id IS NOT NULL THEN
    FOR v_day IN 0..6 LOOP
      INSERT INTO public.operating_hours (space_id, day_of_week, is_open, opening_time, closing_time)
      VALUES (
        v_pilates_id,
        v_day,
        CASE WHEN v_day BETWEEN 1 AND 6 THEN true ELSE false END,
        CASE WHEN v_day = 6 THEN '08:00:00'::time ELSE '07:00:00'::time END,
        CASE WHEN v_day = 6 THEN '13:00:00'::time ELSE '21:00:00'::time END
      )
      ON CONFLICT (space_id, day_of_week) DO NOTHING;
    END LOOP;
  END IF;

  -- Horários da Sala de massoterapia:
  -- Segunda a Sexta (1 a 5): 08:00 às 20:00
  -- Sábado (6): 08:00 às 14:00
  -- Domingo (0): Fechado
  IF v_massoterapia_id IS NOT NULL THEN
    FOR v_day IN 0..6 LOOP
      INSERT INTO public.operating_hours (space_id, day_of_week, is_open, opening_time, closing_time)
      VALUES (
        v_massoterapia_id,
        v_day,
        CASE WHEN v_day BETWEEN 1 AND 6 THEN true ELSE false END,
        '08:00:00'::time,
        CASE WHEN v_day = 6 THEN '14:00:00'::time ELSE '20:00:00'::time END
      )
      ON CONFLICT (space_id, day_of_week) DO NOTHING;
    END LOOP;
  END IF;
END $$;
