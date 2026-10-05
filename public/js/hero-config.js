/**
 * ============================================================================
 * CENTRALIZAÇÃO DA CONFIGURAÇÃO DO VÍDEO DE FUNDO (HERO)
 * Espaço Lígia de Mayor - Fisioterapia & Estúdio de Pilates em Copacabana
 * ============================================================================
 *
 * Este é o ÚNICO local onde você precisa inserir a URL do vídeo gravado no estúdio.
 *
 * INSTRUÇÕES SIMPLES PARA ATIVAR O SEU VÍDEO DA HOSTINGER:
 * ----------------------------------------------------------------------------
 * 1. Acesse o Painel da Hostinger (hPanel) > Gerenciador de Arquivos (File Manager).
 * 2. Na pasta public_html (ou em uma subpasta como public_html/videos/), faça o upload
 *    do seu arquivo de vídeo em formato .mp4 (ex: hero-studio-ligia.mp4).
 * 3. Copie o endereço web direto do vídeo.
 *    Exemplo: "https://espacoligiademayor.com.br/videos/hero-studio-ligia.mp4"
 * 4. Cole o endereço dentro das aspas da propriedade `videoUrl` abaixo.
 *
 * COMPORTAMENTO DO SITE:
 * - Enquanto `videoUrl` estiver vazia (""), o site exibe com perfeição a fotografia
 *   estática de alta definição do estúdio (sem vídeo demonstrativo ou falso).
 * - Ao colar a URL, o site ativa automaticamente a reprodução em tela cheia na primeira
 *   seção: silenciosa (muted), com início instantâneo (autoplay), em loop suave
 *   e com botão discreto para pausar/retomar a qualquer momento.
 * ============================================================================
 */

window.HERO_VIDEO_CONFIG = {
  // >>> COLE AQUI A URL PÚBLICA DIRETA DO SEU VÍDEO .MP4 DA HOSTINGER <<<
  videoUrl: "",

  // Imagem estática de fundo oficial (exibida enquanto videoUrl estiver vazia):
  posterUrl: "./assets/hero-studio-poster.jpg",

  // Parâmetros automáticos de reprodução
  autoplay: true,
  muted: true,
  loop: true,
  playsInline: true
};
