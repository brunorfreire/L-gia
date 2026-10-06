-- ============================================================================
-- ESPAÇO LIGIA DE MAYOR - MIGRAÇÃO SUPABASE: ÁREA PRIVADA DE PROFISSIONAIS
-- ============================================================================
-- Esta migração implementa:
-- 1. Extensão btree_gist para suporte a restrições de exclusão temporal
-- 2. Perfis de profissionais com papéis estritos ('admin' e 'professional')
-- 3. Espaços de atendimento com gerenciamento administrativo
-- 4. Bloqueios administrativos de espaço (manutenção, feriados)
-- 5. Reservas atômicas com exclusão PostgreSQL para impedir sobreposição ([start, end))
-- 6. Validação de horários de funcionamento no fuso America/Sao_Paulo
-- 7. RLS (Row Level Security) completo em todas as tabelas
-- 8. Função segura get_space_availability que expõe apenas horários livres/ocupados
--    sem divulgar dados pessoais ou clínicos a outros profissionais
-- 9. Publicação do Supabase Realtime para sincronização instantânea
-- ============================================================================

-- 1. HABILITAR EXTENSÃO DE ÍNDICES GIST (ESSENCIAL PARA CONSTRAINT DE EXCLUSÃO)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. TABELA DE PERFIS DE PROFISSIONAIS (LIGADA A AUTH.USERS)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'professional')) DEFAULT 'professional',
  is_active boolean NOT NULL DEFAULT true,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários de documentação
COMMENT ON TABLE public.profiles IS 'Perfis autorizados pela administração do Espaço Ligia de Mayor';
COMMENT ON COLUMN public.profiles.role IS 'admin: gerencia espaços, bloqueios e profissionais; professional: reserva e consulta horários';

-- 3. TABELA DE ESPAÇOS DISPONÍVEIS PARA ATENDIMENTO
CREATE TABLE IF NOT EXISTS public.spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.spaces IS 'Salas e estúdios cadastrados pela administração do Espaço Lígia de Mayor';

-- 4. TABELA DE BLOQUEIOS ADMINISTRATIVOS (Feriados, Manutenções, Treinamentos)
CREATE TABLE IF NOT EXISTS public.space_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_space_block_time CHECK (end_time > start_time)
);

-- Índice GIST para busca rápida de bloqueios
CREATE INDEX IF NOT EXISTS idx_space_blocks_range 
  ON public.space_blocks USING gist (space_id, tstzrange(start_time, end_time, '[)'));

-- 5. TABELA DE RESERVAS COM PROTEÇÃO ATÔMICA CONTRA SOBREPOSIÇÃO
CREATE TABLE IF NOT EXISTS public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  professional_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('confirmed', 'cancelled')) DEFAULT 'confirmed',
  notes text, -- Observações internas do profissional (sem dados clínicos de pacientes)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_reservation_time CHECK (end_time > start_time),
  -- PROTEÇÃO ATÔMICA POSTGRESQL: impede sobreposição de reservas confirmadas no mesmo espaço
  -- Intervalo [início, término) permite que uma reserva inicie no minuto exato em que outra termina
  CONSTRAINT no_overlapping_reservations EXCLUDE USING gist (
    space_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status = 'confirmed')
);

COMMENT ON CONSTRAINT no_overlapping_reservations ON public.reservations IS 
  'Garante que nenhuma reserva confirmada se sobreponha no mesmo espaço físico, mesmo em transações simultâneas concorrentes';

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_reservations_space_time 
  ON public.reservations (space_id, start_time, end_time) 
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_reservations_professional 
  ON public.reservations (professional_id, start_time DESC);

-- 6. FUNÇÕES AUXILIARES DE SEGURANÇA (SECURITY DEFINER)
-- Função para checar se o usuário atual é Administrador ativo
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  );
$$;

-- Função para checar se o usuário atual é Profissional ou Admin ativo
CREATE OR REPLACE FUNCTION public.is_active_professional()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND is_active = true
  );
$$;

-- 7. TRIGGERS DE VALIDAÇÃO DE NEGÓCIO

-- Validação de Colisão com Bloqueios Administrativos
CREATE OR REPLACE FUNCTION public.trg_check_space_block_collision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.space_blocks sb
    WHERE sb.space_id = NEW.space_id
      AND tstzrange(sb.start_time, sb.end_time, '[)') && tstzrange(NEW.start_time, NEW.end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'O espaço selecionado possui um bloqueio administrativo neste horário.'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_reservation_block ON public.reservations;
CREATE TRIGGER trg_validate_reservation_block
  BEFORE INSERT OR UPDATE ON public.reservations
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed')
  EXECUTE FUNCTION public.trg_check_space_block_collision();

-- Validação de Horário de Funcionamento (Fuso America/Sao_Paulo)
CREATE OR REPLACE FUNCTION public.trg_check_operating_hours()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_start_sp time;
  v_end_sp time;
  v_dow int;
BEGIN
  -- Converte os instantes para o fuso oficial de Copacabana (America/Sao_Paulo)
  v_start_sp := (NEW.start_time AT TIME ZONE 'America/Sao_Paulo')::time;
  v_end_sp := (NEW.end_time AT TIME ZONE 'America/Sao_Paulo')::time;
  v_dow := EXTRACT(DOW FROM (NEW.start_time AT TIME ZONE 'America/Sao_Paulo'))::int;

  -- 0 = Domingo: clínica fechada
  IF v_dow = 0 THEN
    RAISE EXCEPTION 'O Espaço Ligia de Mayor não funciona aos domingos.'
      USING ERRCODE = '22000';
  END IF;

  -- 6 = Sábado: das 07:00 às 14:00
  IF v_dow = 6 THEN
    IF v_start_sp < '07:00:00'::time OR v_end_sp > '14:00:00'::time THEN
      RAISE EXCEPTION 'Aos sábados, o horário de atendimento é das 07:00 às 14:00.'
        USING ERRCODE = '22000';
    END IF;
  ELSE
    -- 1 a 5 = Segunda a Sexta: das 07:00 às 21:00
    IF v_start_sp < '07:00:00'::time OR v_end_sp > '21:00:00'::time THEN
      RAISE EXCEPTION 'De segunda a sexta, o horário de atendimento é das 07:00 às 21:00.'
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- Não permitir criação de reservas retroativas (com tolerância de 5 minutos para latência)
  IF TG_OP = 'INSERT' AND NEW.start_time < (now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Não é permitido criar reservas para horários passados.'
      USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_reservation_hours ON public.reservations;
CREATE TRIGGER trg_validate_reservation_hours
  BEFORE INSERT OR UPDATE ON public.reservations
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed')
  EXECUTE FUNCTION public.trg_check_operating_hours();

-- 8. FUNÇÃO SEGURA PARA CONSULTA DE DISPONIBILIDADE
-- Retorna apenas se o horário está livre, ocupado ou bloqueado.
-- NUNCA revela quem reservou nem detalhes a outros profissionais.
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
SET search_path = public
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

  -- Delimita o dia no fuso America/Sao_Paulo
  v_day_start := (p_date::text || ' 00:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_day_end := (p_date::text || ' 23:59:59')::timestamp AT TIME ZONE 'America/Sao_Paulo';

  RETURN QUERY
    -- Reservas ativas no espaço: se for do próprio profissional, is_mine = true
    -- Se for de outro profissional, is_mine = false e nenhum dado pessoal é exposto
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

    -- Bloqueios administrativos no espaço
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

-- 9. HABILITAÇÃO DO ROW LEVEL SECURITY (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- POLÍTICAS RLS: PROFILES
-- ----------------------------------------------------------------------------
-- O usuário pode visualizar seu próprio perfil; Admins podem ver todos
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin());

-- Apenas Admins podem criar ou alterar perfis (evita auto-promoção de role)
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
CREATE POLICY "profiles_insert_admin" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- POLÍTICAS RLS: SPACES
-- ----------------------------------------------------------------------------
-- Profissionais ativos podem ver espaços ativos; Admins podem ver todos
DROP POLICY IF EXISTS "spaces_select_policy" ON public.spaces;
CREATE POLICY "spaces_select_policy" ON public.spaces
  FOR SELECT TO authenticated
  USING (
    (public.is_active_professional() AND is_active = true) OR public.is_admin()
  );

-- Apenas Admins podem inserir, atualizar ou excluir espaços
DROP POLICY IF EXISTS "spaces_admin_insert" ON public.spaces;
CREATE POLICY "spaces_admin_insert" ON public.spaces
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "spaces_admin_update" ON public.spaces;
CREATE POLICY "spaces_admin_update" ON public.spaces
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "spaces_admin_delete" ON public.spaces;
CREATE POLICY "spaces_admin_delete" ON public.spaces
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- POLÍTICAS RLS: SPACE_BLOCKS
-- ----------------------------------------------------------------------------
-- Profissionais ativos podem consultar bloqueios
DROP POLICY IF EXISTS "space_blocks_select_policy" ON public.space_blocks;
CREATE POLICY "space_blocks_select_policy" ON public.space_blocks
  FOR SELECT TO authenticated
  USING (public.is_active_professional());

-- Apenas Admins podem criar, editar ou excluir bloqueios
DROP POLICY IF EXISTS "space_blocks_admin_all" ON public.space_blocks;
CREATE POLICY "space_blocks_admin_all" ON public.space_blocks
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- POLÍTICAS RLS: RESERVATIONS
-- ----------------------------------------------------------------------------
-- Profissionais só enxergam suas PRÓPRIAS reservas com detalhes completos.
-- A disponibilidade dos outros é consultada EXCLUSIVAMENTE via get_space_availability.
-- Admins podem ver todas as reservas.
DROP POLICY IF EXISTS "reservations_select_policy" ON public.reservations;
CREATE POLICY "reservations_select_policy" ON public.reservations
  FOR SELECT TO authenticated
  USING (
    (public.is_active_professional() AND professional_id = auth.uid()) OR public.is_admin()
  );

-- Profissionais ativos podem criar reservas apenas em seu próprio nome
DROP POLICY IF EXISTS "reservations_insert_policy" ON public.reservations;
CREATE POLICY "reservations_insert_policy" ON public.reservations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_professional() 
    AND professional_id = auth.uid()
    AND status = 'confirmed'
  );

-- Profissionais podem cancelar (atualizar status para 'cancelled') apenas suas próprias reservas futuras
DROP POLICY IF EXISTS "reservations_update_cancel_policy" ON public.reservations;
CREATE POLICY "reservations_update_cancel_policy" ON public.reservations
  FOR UPDATE TO authenticated
  USING (
    (professional_id = auth.uid() AND status = 'confirmed' AND start_time > now())
    OR public.is_admin()
  )
  WITH CHECK (
    (professional_id = auth.uid() AND status = 'cancelled')
    OR public.is_admin()
  );

-- 10. GRANTS MÍNIMOS NECESSÁRIOS PARA A DATA API (ACESSO COM CHAVE PÚBLICA ANON/AUTHENTICATED)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.spaces TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reservations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.space_blocks TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_space_availability(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_professional() TO authenticated;

-- 11. SUPABASE REALTIME: HABILITAR SINCRONIZAÇÃO EM TEMPO REAL
DO $$
BEGIN
  -- Adiciona tabelas à publicação realtime se ainda não estiverem
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
END $$;

-- 12. DADOS INICIAIS (SEED) PARA O ESPAÇO LIGIA DE MAYOR
-- Insere espaços reais do estúdio caso a tabela esteja vazia
INSERT INTO public.spaces (name, description, display_order)
SELECT 'Sala de Atendimento Clínico', 'Maca biomecânica, espaço individual para Fisioterapia e Terapias Integrativas', 1
WHERE NOT EXISTS (SELECT 1 FROM public.spaces WHERE name = 'Sala de Atendimento Clínico');

INSERT INTO public.spaces (name, description, display_order)
SELECT 'Estúdio de Pilates & Columpio', 'Aparelhos Reformer, Cadillac, Combo Chair e tecido suspenso (Columpio)', 2
WHERE NOT EXISTS (SELECT 1 FROM public.spaces WHERE name = 'Estúdio de Pilates & Columpio');

-- ============================================================================
-- 13. TRIGGER AUTOMÁTICO DE CRIAÇÃO DE PERFIL
-- Quando um profissional ou administrador for criado pelo painel Supabase Auth,
-- um registro correspondente em public.profiles é criado automaticamente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, is_active, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'professional'),
    true,
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 14. GUIA DE CONFIGURAÇÃO DO PRIMEIRO ADMINISTRADOR E PROFISSIONAIS
-- ============================================================================
-- PASSO A PASSO NO SUPABASE DASHBOARD:
-- 
-- 1. No menu lateral do Supabase, vá em: Authentication -> Users -> Add user -> Create user
-- 2. Insira o e-mail da Lígia (ex: ligia@espacoligiademayor.com.br) e uma senha segura.
-- 3. Marque "Auto Confirm User?" como SIM para ativar imediatamente.
-- 4. Vá no menu "SQL Editor", cole e execute o comando abaixo para torná-la Administradora:
--
--    UPDATE public.profiles
--    SET role = 'admin', full_name = 'Lígia de Mayor'
--    WHERE id = (SELECT id FROM auth.users WHERE email = 'ligia@espacoligiademayor.com.br');
--
-- 5. PARA CADA NOVO PROFISSIONAL:
--    - Vá em Authentication -> Users -> Add user -> Create user
--    - Informe o e-mail e senha do profissional
--    - O perfil em public.profiles será criado automaticamente com o papel 'professional'.
--    - Para atualizar o nome do profissional:
--      UPDATE public.profiles SET full_name = 'Nome do Fisioterapeuta' 
--      WHERE id = (SELECT id FROM auth.users WHERE email = 'email.do.profissional@exemplo.com');
-- ============================================================================
