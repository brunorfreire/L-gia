/**
 * ============================================================================
 * CONFIGURAÇÃO CENTRAL DO EBOOK / GUIA GRATUITO
 * Espaço Lígia de Mayor - Fisioterapia e Pilates
 * ============================================================================
 * 
 * Centraliza a URL do PDF "Rotina Matinal de 7 Minutos".
 * Pode apontar para um arquivo local na pasta de assets estáticos ou para
 * a URL pública de publicação no servidor/CDN da Hostinger.
 * ============================================================================
 */

(function () {
  'use strict';

  // Configuração central do guia gratuito
  const EBOOK_CONFIG = {
    // Caminho sugerido para hospedagem estática
    pdfUrl: './assets/rotina-matinal-7-minutos.pdf',

    // URL alternativa/absoluta na Hostinger se hospedado externamente:
    // pdfFallbackUrl: 'https://fisioligia.siteoficialpro.com/assets/rotina-matinal-7-minutos.pdf',
    pdfFallbackUrl: 'https://fisioligia.siteoficialpro.com/assets/rotina-matinal-7-minutos.pdf',

    // Número oficial do WhatsApp
    whatsappNumber: '5521997172737',

    // Dias de suspensão da abertura automática após concluir o fluxo (30 dias)
    autoOpenDismissDays: 30
  };

  window.EBOOK_CONFIG = EBOOK_CONFIG;
})();
