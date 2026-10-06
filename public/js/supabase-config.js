/**
 * ============================================================================
 * ESPAÇO LIGIA DE MAYOR - CONFIGURAÇÃO DO SUPABASE (ÁREA DOS PROFISSIONAIS)
 * ============================================================================
 * 
 * ATENÇÃO DE SEGURANÇA:
 * Utilize APENAS a chave pública (anon / publishable key) no frontend.
 * NUNCA inclua a Service Role Key ou Secret Key no código do cliente.
 * 
 * As constantes abaixo podem ser editadas diretamente aqui para o deploy
 * ou sobrescritas no navegador (localStorage) através do painel de configuração.
 * ============================================================================
 */

(function() {
  // Valores configurados para o projeto
  const DEFAULT_CONFIG = {
    // Substitua pela Project URL fornecida no painel do Supabase:
    // Exemplo: https://xyzcompany.supabase.co
    url: 'COLE_AQUI_A_PROJECT_URL',

    // Substitua pela Publishable Key (Anon Key) fornecida no painel do Supabase:
    // Exemplo: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
    anonKey: 'COLE_AQUI_A_PUBLISHABLE_KEY'
  };

  // Suporte a armazenamento local para testes rápidos ou chave configurada em runtime
  const storedUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('espaco_ligia_supabase_url') : null;
  const storedKey = typeof localStorage !== 'undefined' ? localStorage.getItem('espaco_ligia_supabase_key') : null;

  window.SUPABASE_CONFIG = {
    url: (storedUrl && storedUrl.trim()) ? storedUrl.trim() : DEFAULT_CONFIG.url,
    anonKey: (storedKey && storedKey.trim()) ? storedKey.trim() : DEFAULT_CONFIG.anonKey,
    isConfigured: function() {
      const u = this.url || '';
      const k = this.anonKey || '';
      return u !== 'COLE_AQUI_A_PROJECT_URL' && 
             u.startsWith('https://') && 
             k !== 'COLE_AQUI_A_PUBLISHABLE_KEY' && 
             k.length > 20;
    },
    saveCustomConfig: function(newUrl, newKey) {
      if (typeof localStorage !== 'undefined') {
        if (newUrl) localStorage.setItem('espaco_ligia_supabase_url', newUrl.trim());
        if (newKey) localStorage.setItem('espaco_ligia_supabase_key', newKey.trim());
        this.url = newUrl.trim();
        this.anonKey = newKey.trim();
      }
    },
    resetConfig: function() {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('espaco_ligia_supabase_url');
        localStorage.removeItem('espaco_ligia_supabase_key');
        this.url = DEFAULT_CONFIG.url;
        this.anonKey = DEFAULT_CONFIG.anonKey;
      }
    }
  };
})();
