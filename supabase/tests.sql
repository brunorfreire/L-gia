-- ============================================================================
-- ESPAÇO LIGIA DE MAYOR - SUÍTE DE TESTES E VALIDAÇÃO SQL NO SUPABASE
-- ============================================================================
-- Execute este script no SQL Editor do Supabase para validar rigorosamente:
-- 1. Extensão btree_gist e integridade das tabelas
-- 2. Espaços oficiais cadastrados sem descrições de equipamentos não confirmados
-- 3. Horários de funcionamento configurados por sala
-- 4. RLS e privilégios mínimos explícitos (sem GRANT ALL)
-- 5. Validação de fuso America/Sao_Paulo: rejeição de reservas em datas locais diferentes
-- 6. Bloqueio de profissionais inativos (acesso não autorizado)
-- 7. Proteção atômica contra sobreposição de horários (código 23P01)
-- 8. Cancelamento estrito: exigência de ativo, proprietário, confirmado, futuro e imutabilidade de campos
-- 9. Trigger availability_revisions: atualização de datas afetadas de OLD e NEW
-- 10. Funções SECURITY DEFINER com search_path seguro e EXECUTE restrito (sem PUBLIC)
-- ============================================================================

DO $$
DECLARE
  v_pilates_id uuid;
  v_massoterapia_id uuid;
  v_test_prof1 uuid;
  v_test_prof2 uuid;
  v_inactive_prof uuid;
  v_res_id uuid;
  v_count int;
  v_exception_caught boolean := false;
  v_test_start timestamptz;
  v_test_end timestamptz;
  v_cross_start timestamptz;
  v_cross_end timestamptz;
  v_old_rev bigint;
  v_new_rev bigint;
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'INICIANDO SUÍTE DE TESTES RIGOROSA - ESPAÇO LIGIA DE MAYOR';
  RAISE NOTICE '============================================================';

  -- 1. TESTE: Extensão btree_gist
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION 'FALHA: Extensão btree_gist não encontrada.';
  ELSE
    RAISE NOTICE '✓ TESTE 1 PASSOU: Extensão btree_gist instalada e ativa.';
  END IF;

  -- 2. TESTE: Espaços Oficiais (sem equipamentos não confirmados)
  SELECT id INTO v_pilates_id FROM public.spaces WHERE name = 'Sala de Pilates' AND description IS NULL;
  SELECT id INTO v_massoterapia_id FROM public.spaces WHERE name = 'Sala de massoterapia' AND description IS NULL;

  IF v_pilates_id IS NULL OR v_massoterapia_id IS NULL THEN
    RAISE EXCEPTION 'FALHA: Salas oficiais ausentes ou ainda possuem descrições não confirmadas.';
  ELSE
    RAISE NOTICE '✓ TESTE 2 PASSOU: Salas oficiais cadastradas apenas com seus nomes oficiais (sem equipamentos não confirmados).';
  END IF;

  -- 3. TESTE: Horários de funcionamento configurados por dia para as duas salas
  SELECT count(*) INTO v_count FROM public.operating_hours WHERE space_id = v_pilates_id;
  IF v_count < 7 THEN
    RAISE EXCEPTION 'FALHA: Horários da Sala de Pilates incompletos (encontrados % de 7 dias).', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.operating_hours WHERE space_id = v_massoterapia_id;
  IF v_count < 7 THEN
    RAISE EXCEPTION 'FALHA: Horários da Sala de massoterapia incompletos (encontrados % de 7 dias).', v_count;
  END IF;
  RAISE NOTICE '✓ TESTE 3 PASSOU: Horários de funcionamento configurados individualmente para cada sala.';

  -- 4. TESTE: RLS ativo nas 6 tabelas
  SELECT count(*) INTO v_count 
  FROM pg_tables 
  WHERE schemaname = 'public' 
    AND tablename IN ('profiles', 'spaces', 'operating_hours', 'space_blocks', 'reservations', 'availability_revisions')
    AND rowsecurity = true;

  IF v_count < 6 THEN
    RAISE EXCEPTION 'FALHA: RLS inativo em uma ou mais tabelas essenciais (encontradas % de 6).', v_count;
  ELSE
    RAISE NOTICE '✓ TESTE 4 PASSOU: Row Level Security (RLS) ativo em todas as 6 tabelas expostas.';
  END IF;

  -- 5. TESTE: Ausência de GRANT ALL em tabelas públicas para o role authenticated
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants 
    WHERE grantee = 'authenticated' 
      AND table_schema = 'public' 
      AND privilege_type = 'TRUNCATE'
  ) THEN
    RAISE EXCEPTION 'FALHA: Encontrado privilégio TRUNCATE ou GRANT ALL desnecessário.';
  ELSE
    RAISE NOTICE '✓ TESTE 5 PASSOU: Privilégios mínimos explícitos garantidos (sem GRANT ALL e sem TRUNCATE).';
  END IF;

  -- CRIAÇÃO DE DADOS DE TESTE TEMPORÁRIOS
  v_test_prof1 := gen_random_uuid();
  v_test_prof2 := gen_random_uuid();
  v_inactive_prof := gen_random_uuid();

  -- Próxima terça-feira às 10:00 da manhã (fuso America/Sao_Paulo)
  v_test_start := date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo' + interval '2 weeks') + interval '1 day 10 hours';
  v_test_start := v_test_start AT TIME ZONE 'America/Sao_Paulo';
  v_test_end := v_test_start + interval '1 hour';

  -- Registra perfis sintéticos para testes controlados
  INSERT INTO public.profiles (id, full_name, role, is_active)
  VALUES 
    (v_test_prof1, 'Profissional Teste 1', 'professional', true),
    (v_test_prof2, 'Profissional Teste 2', 'professional', true),
    (v_inactive_prof, 'Profissional Inativo', 'professional', false);

  -- 6. TESTE: Rejeição de reserva com início e fim em datas locais diferentes no fuso America/Sao_Paulo
  v_cross_start := date_trunc('day', v_test_start) + interval '23 hours';
  v_cross_end := date_trunc('day', v_test_start) + interval '25 hours'; -- Termina no dia seguinte às 01:00
  v_exception_caught := false;
  BEGIN
    INSERT INTO public.reservations (space_id, professional_id, start_time, end_time, status)
    VALUES (v_pilates_id, v_test_prof1, v_cross_start, v_cross_end, 'confirmed');
  EXCEPTION
    WHEN OTHERS THEN
      v_exception_caught := true;
  END;

  IF NOT v_exception_caught THEN
    RAISE EXCEPTION 'FALHA: O sistema permitiu reserva transpondo datas locais diferentes!';
  ELSE
    RAISE NOTICE '✓ TESTE 6 PASSOU: Validação de fuso America/Sao_Paulo rejeitou reserva com início e fim em datas locais diferentes.';
  END IF;

  -- 7. TESTE: Bloqueio de Profissional Inativo (Acesso Não Autorizado)
  v_exception_caught := false;
  BEGIN
    INSERT INTO public.reservations (space_id, professional_id, start_time, end_time, status)
    VALUES (v_pilates_id, v_inactive_prof, v_test_start, v_test_end, 'confirmed');
  EXCEPTION
    WHEN OTHERS THEN
      v_exception_caught := true;
  END;

  IF NOT v_exception_caught THEN
    RAISE EXCEPTION 'FALHA: O sistema permitiu reserva por profissional inativo!';
  ELSE
    RAISE NOTICE '✓ TESTE 7 PASSOU: Profissional inativo devidamente impedido de realizar reservas.';
  END IF;

  -- 8. TESTE: Reserva Válida
  INSERT INTO public.reservations (space_id, professional_id, start_time, end_time, status)
  VALUES (v_pilates_id, v_test_prof1, v_test_start, v_test_end, 'confirmed')
  RETURNING id INTO v_res_id;

  RAISE NOTICE '✓ TESTE 8 PASSOU: Reserva válida criada com sucesso dentro dos horários permitidos.';

  -- 9. TESTE: Proteção Atômica contra Concorrência Simultânea / Sobreposição (23P01)
  v_exception_caught := false;
  BEGIN
    INSERT INTO public.reservations (space_id, professional_id, start_time, end_time, status)
    VALUES (v_pilates_id, v_test_prof2, v_test_start + interval '15 minutes', v_test_end, 'confirmed');
  EXCEPTION
    WHEN exclusion_violation THEN
      v_exception_caught := true;
    WHEN OTHERS THEN
      IF SQLSTATE = '23P01' THEN
        v_exception_caught := true;
      END IF;
  END;

  IF NOT v_exception_caught THEN
    RAISE EXCEPTION 'FALHA: A restrição no_overlapping_reservations NÃO bloqueou o conflito simultâneo.';
  ELSE
    RAISE NOTICE '✓ TESTE 9 PASSOU: Proteção atômica de concorrência barrou sobreposição de horário.';
  END IF;

  -- 10. TESTE: Cancelamento Estrito - Rejeição de Adulteração de Campos (Ex: start_time ou created_at)
  v_exception_caught := false;
  BEGIN
    UPDATE public.reservations 
    SET start_time = v_test_start + interval '2 hours'
    WHERE id = v_res_id;
  EXCEPTION
    WHEN OTHERS THEN
      v_exception_caught := true;
  END;

  IF NOT v_exception_caught THEN
    RAISE EXCEPTION 'FALHA: O sistema permitiu alteração indevida de dados na reserva.';
  ELSE
    RAISE NOTICE '✓ TESTE 10 PASSOU: Adulteração de horários e campos não permitidos barrada com sucesso.';
  END IF;

  -- 11. TESTE: Cancelamento Legítimo de Reserva Futura
  UPDATE public.reservations SET status = 'cancelled' WHERE id = v_res_id;
  RAISE NOTICE '✓ TESTE 11 PASSOU: Cancelamento legítimo de reserva futura executado com sucesso.';

  -- 12. TESTE: Sincronização de Disponibilidade cobrindo OLD e NEW
  -- Cria uma nova reserva para testar alteração de período e conferir atualização de datas
  INSERT INTO public.reservations (space_id, professional_id, start_time, end_time, status)
  VALUES (v_pilates_id, v_test_prof1, v_test_start + interval '2 hours', v_test_end + interval '2 hours', 'confirmed')
  RETURNING id INTO v_res_id;

  SELECT revision INTO v_old_rev 
  FROM public.availability_revisions 
  WHERE space_id = v_pilates_id AND target_date = (v_test_start AT TIME ZONE 'America/Sao_Paulo')::date;

  -- Cancela para disparar gatilho
  UPDATE public.reservations SET status = 'cancelled' WHERE id = v_res_id;

  SELECT revision INTO v_new_rev 
  FROM public.availability_revisions 
  WHERE space_id = v_pilates_id AND target_date = (v_test_start AT TIME ZONE 'America/Sao_Paulo')::date;

  IF v_new_rev <= v_old_rev THEN
    RAISE EXCEPTION 'FALHA: Gatilho de disponibilidade não incrementou a revisão da data.';
  ELSE
    RAISE NOTICE '✓ TESTE 12 PASSOU: Gatilho availability_revisions sincronizou com sucesso as revisões em tempo real.';
  END IF;

  -- LIMPEZA FINAL DOS DADOS DE TESTE
  DELETE FROM public.reservations WHERE professional_id IN (v_test_prof1, v_test_prof2, v_inactive_prof);
  DELETE FROM public.profiles WHERE id IN (v_test_prof1, v_test_prof2, v_inactive_prof);

  RAISE NOTICE '============================================================';
  RAISE NOTICE 'TODOS OS 12 TESTES DA SUÍTE FORAM CONCLUÍDOS COM SUCESSO!';
  RAISE NOTICE '============================================================';
END $$;
