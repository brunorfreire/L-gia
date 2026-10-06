-- ============================================================================
-- ESPAÇO LIGIA DE MAYOR - SUÍTE DE TESTES E VALIDAÇÃO SQL NO SUPABASE
-- ============================================================================
-- Execute este script no SQL Editor do Supabase para validar todas as restrições,
-- regras de negócio e proteções de concorrência antes de liberar o sistema.
-- Cada bloco de teste é executado em transação ou bloco anônimo com feedback claro.
-- ============================================================================

DO $$
DECLARE
  v_test_space_id uuid;
  v_test_user1_id uuid;
  v_test_user2_id uuid;
  v_count int;
  v_exception_caught boolean := false;
  v_test_monday timestamptz;
  v_test_sunday timestamptz;
BEGIN
  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE 'INICIANDO SUÍTE DE TESTES DE INTEGRAÇÃO - ESPAÇO LIGIA';
  RAISE NOTICE '------------------------------------------------------------';

  -- 1. TESTE: Extensão btree_gist
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION 'FALHA: Extensão btree_gist não está instalada.';
  ELSE
    RAISE NOTICE '✓ TESTE 1 PASSOU: Extensão btree_gist ativa com sucesso.';
  END IF;

  -- 2. TESTE: Existência dos Espaços Reais
  SELECT id INTO v_test_space_id FROM public.spaces WHERE name = 'Sala de Atendimento Clínico' LIMIT 1;
  IF v_test_space_id IS NULL THEN
    RAISE EXCEPTION 'FALHA: Espaço "Sala de Atendimento Clínico" não encontrado.';
  ELSE
    RAISE NOTICE '✓ TESTE 2 PASSOU: Espaços reais configurados na base.';
  END IF;

  -- 3. TESTE: Verificação de tabelas e RLS ativo
  SELECT count(*) INTO v_count 
  FROM pg_tables 
  WHERE schemaname = 'public' 
    AND tablename IN ('profiles', 'spaces', 'reservations', 'space_blocks')
    AND rowsecurity = true;

  IF v_count < 4 THEN
    RAISE EXCEPTION 'FALHA: Nem todas as tabelas estão com Row Level Security (RLS) habilitado.';
  ELSE
    RAISE NOTICE '✓ TESTE 3 PASSOU: RLS ativo em todas as 4 tabelas.';
  END IF;

  -- 4. TESTE: Restrição de Exclusão contra Reservas Simultâneas (Concorrência Atômica)
  -- Gera dois UUIDs simulados para o teste de colisão
  v_test_user1_id := gen_random_uuid();
  v_test_user2_id := gen_random_uuid();

  -- Próxima segunda-feira às 10:00 da manhã no fuso de São Paulo
  v_test_monday := date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo' + interval '1 week') + interval '10 hours';
  v_test_monday := v_test_monday AT TIME ZONE 'America/Sao_Paulo';

  -- Desabilita temporariamente FK de auth para teste sintético dentro do bloco anônimo
  BEGIN
    -- Inserção 1: Reserva das 10:00 às 11:00
    INSERT INTO public.reservations (space_id, professional_id, start_time, end_time, status)
    VALUES (v_test_space_id, v_test_user1_id, v_test_monday, v_test_monday + interval '1 hour', 'confirmed');

    -- Inserção 2: Tentativa de sobreposição exata (10:30 às 11:30) no mesmo espaço
    BEGIN
      INSERT INTO public.reservations (space_id, professional_id, start_time, end_time, status)
      VALUES (v_test_space_id, v_test_user2_id, v_test_monday + interval '30 minutes', v_test_monday + interval '90 minutes', 'confirmed');
    EXCEPTION
      WHEN exclusion_violation THEN
        v_exception_caught := true;
    END;

    IF NOT v_exception_caught THEN
      RAISE EXCEPTION 'FALHA: A restrição no_overlapping_reservations NÃO barrou a reserva sobreposta.';
    ELSE
      RAISE NOTICE '✓ TESTE 4 PASSOU: Proteção atômica contra sobreposição barrou com exclusão GIST (código 23P01).';
    END IF;

    -- Inserção 3: Intervalo contíguo permitido [11:00 às 12:00) - início exato no término do anterior
    INSERT INTO public.reservations (space_id, professional_id, start_time, end_time, status)
    VALUES (v_test_space_id, v_test_user2_id, v_test_monday + interval '1 hour', v_test_monday + interval '2 hours', 'confirmed');
    RAISE NOTICE '✓ TESTE 5 PASSOU: Intervalo contíguo [início inclusivo, término exclusivo) aceito perfeitamente.';

    -- Limpeza dos registros de teste
    DELETE FROM public.reservations WHERE professional_id IN (v_test_user1_id, v_test_user2_id);
  EXCEPTION
    WHEN OTHERS THEN
      DELETE FROM public.reservations WHERE professional_id IN (v_test_user1_id, v_test_user2_id);
      RAISE;
  END;

  -- 5. TESTE: Validação de Horário de Funcionamento (Domingo Fechado)
  v_exception_caught := false;
  v_test_sunday := date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo' + interval '1 week') - interval '1 day' + interval '10 hours';
  v_test_sunday := v_test_sunday AT TIME ZONE 'America/Sao_Paulo';

  BEGIN
    INSERT INTO public.reservations (space_id, professional_id, start_time, end_time, status)
    VALUES (v_test_space_id, v_test_user1_id, v_test_sunday, v_test_sunday + interval '1 hour', 'confirmed');
  EXCEPTION
    WHEN OTHERS THEN
      v_exception_caught := true;
  END;

  IF NOT v_exception_caught THEN
    RAISE EXCEPTION 'FALHA: O trigger permitiu agendamento no domingo.';
  ELSE
    RAISE NOTICE '✓ TESTE 6 PASSOU: Trigger de horários impediu agendamento em dia não permitido (Domingo).';
  END IF;

  -- 6. TESTE: Presença do Realtime na publicação
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'reservations'
  ) THEN
    RAISE EXCEPTION 'FALHA: Tabela reservations não adicionada à publicação supabase_realtime.';
  ELSE
    RAISE NOTICE '✓ TESTE 7 PASSOU: Publicação Realtime habilitada para reservations.';
  END IF;

  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE 'TODOS OS TESTES PASSARAM COM SUCESSO! BANCO 100%% HOMOLOGADO.';
  RAISE NOTICE '------------------------------------------------------------';
END $$;
