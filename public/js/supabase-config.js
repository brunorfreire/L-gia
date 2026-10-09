/**
 * ============================================================================
 * ESPAÇO LIGIA DE MAYOR - CONFIGURAÇÃO CENTRAL DO SUPABASE
 * ============================================================================
 * 
 * ATENÇÃO DE SEGURANÇA:
 * Utilize APENAS a chave pública (Publishable Anon Key) neste arquivo de cliente.
 * NUNCA inclua a Service Role Key, Secret Key ou token administrativo.
 * 
 * Os valores abaixo são centralizados e definidos pela administração para o deploy.
 * A interface com o usuário nunca solicita chaves ou tokens.
 * ============================================================================
 */

(function () {
  'use strict';

  // Configuração central do projeto Supabase
  const CENTRAL_CONFIG = {
    // Project URL do Supabase (ex: https://xyzcompany.supabase.co)
    url: 'COLE_AQUI_A_PROJECT_URL',

    // Publishable Anon Key do Supabase (chave pública com RLS)
    anonKey: 'COLE_AQUI_A_PUBLISHABLE_KEY'
  };

  window.SUPABASE_CONFIG = {
    url: CENTRAL_CONFIG.url,
    anonKey: CENTRAL_CONFIG.anonKey,
    isConfigured: function () {
      const u = this.url || '';
      const k = this.anonKey || '';
      return u !== 'COLE_AQUI_A_PROJECT_URL' &&
             u.startsWith('https://') &&
             k !== 'COLE_AQUI_A_PUBLISHABLE_KEY' &&
             k.length > 20;
    }
  };
})();
