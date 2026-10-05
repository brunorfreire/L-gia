/**
 * Espaço Ligia de Mayor - Scripts Principais
 * Fisioterapia & Estúdio de Pilates em Copacabana, Rio de Janeiro
 * JavaScript Vanilla moderno, modular e otimizado para carregamento rápido
 */

document.addEventListener('DOMContentLoaded', () => {
  initHeaderScroll();
  initHeroVideo();
  initMobileMenu();
  initFaqAccordion();
  initSmoothScroll();
  initCopyAddress();
  initBookingModal();
  initDynamicYear();
});

/**
 * 1. Efeito de Sombra e Transparência no Header ao Rolar
 */
function initHeaderScroll() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const handleScroll = () => {
    if (window.scrollY > 20) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // Checagem inicial
}

/**
 * 2. Controle Acessível e Otimizado do Fundo do Hero (Vídeo ou Imagem Estática Oficial)
 * - Integração centralizada com window.HERO_VIDEO_CONFIG (URL da Hostinger)
 * - Autoplay silencioso (muted, playsInline, loop)
 * - Botão "Pausar" permanentemente oculto conforme solicitado pelo usuário
 * - Respeita acessibilidade de movimento reduzido (prefers-reduced-motion) e economia de dados
 * - Pausa automática fora da viewport (IntersectionObserver) ou aba em segundo plano
 * - Diagnóstico transparente com fallback para a fotografia real do estúdio em caso de falha de rede/404
 */
function initHeroVideo() {
  const config = window.HERO_VIDEO_CONFIG || {
    videoUrl: 'https://fisioligia.siteoficialpro.com/assets/hero-studio-ligia.mp4',
    posterUrl: './assets/hero-studio-poster.jpg'
  };

  const videoWrapper = document.getElementById('heroVideoWrapper');
  const video = document.getElementById('heroBackgroundVideo');
  const controlBtn = document.getElementById('heroVideoControlBtn');
  const staticWrapper = document.getElementById('heroImageWrapper');
  const heroSection = document.getElementById('inicio');

  // Garante que qualquer resquício do botão de controle fique 100% oculto
  if (controlBtn) {
    controlBtn.style.display = 'none';
  }

  const targetVideoUrl = (config.videoUrl || 'https://fisioligia.siteoficialpro.com/assets/hero-studio-ligia.mp4').trim();

  // 1. Respeito à acessibilidade de movimento reduzido e economia de dados móveis
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDataSaver = navigator.connection && navigator.connection.saveData === true;

  if (prefersReducedMotion || isDataSaver) {
    if (videoWrapper) videoWrapper.style.display = 'none';
    if (staticWrapper) staticWrapper.style.display = 'block';
    return;
  }

  if (!video) return;

  // 2. Propriedades fundamentais para garantir autoplay silencioso contínuo
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.loop = true;
  video.autoplay = true;
  video.preload = 'auto';

  // Aplicação da URL pública absoluta do vídeo na Hostinger
  if (!video.src || video.src !== targetVideoUrl) {
    video.src = targetVideoUrl;
  }

  let isSectionInView = true;

  // 3. Exibição suave do vídeo assim que estiver pronto para reproduzir
  const handleReadyToPlay = () => {
    if (videoWrapper) videoWrapper.style.display = 'block';
    video.classList.add('is-ready');
  };

  if (video.readyState >= 2) {
    handleReadyToPlay();
  } else {
    video.addEventListener('canplay', handleReadyToPlay, { once: true });
    video.addEventListener('playing', handleReadyToPlay, { once: true });
    video.addEventListener('loadeddata', handleReadyToPlay, { once: true });
  }

  // 4. Tratamento de erro detalhado com diagnóstico preciso
  video.addEventListener('error', () => {
    const error = video.error;
    let errorDetail = 'Erro desconhecido';
    if (error) {
      switch (error.code) {
        case 1: errorDetail = 'MEDIA_ERR_ABORTED - Carregamento abortado'; break;
        case 2: errorDetail = 'MEDIA_ERR_NETWORK - Erro de conexão de rede'; break;
        case 3: errorDetail = 'MEDIA_ERR_DECODE - Falha de decodificação'; break;
        case 4: errorDetail = 'MEDIA_ERR_SRC_NOT_SUPPORTED - Arquivo não encontrado (HTTP 404) ou indisponível no servidor'; break;
      }
    }
    console.warn(`[Hero Video] Falha ao carregar ${targetVideoUrl}: ${errorDetail}. Exibindo fotografia oficial do estúdio.`);
    if (videoWrapper) videoWrapper.style.display = 'none';
    if (staticWrapper) staticWrapper.style.display = 'block';
  });

  // 5. Início da reprodução automática com captura de política do navegador
  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      handleReadyToPlay();
    }).catch((err) => {
      console.warn('[Hero Video] Autoplay aguardando interação do usuário:', err);
    });
  }

  // 6. Pausar automaticamente quando o Hero sai da tela (economia de bateria e dados)
  if ('IntersectionObserver' in window && heroSection) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        isSectionInView = entry.isIntersecting;
        if (!entry.isIntersecting) {
          if (!video.paused) video.pause();
        } else {
          if (!document.hidden && video.src && !prefersReducedMotion) {
            video.play().catch(() => {});
          }
        }
      });
    }, { threshold: 0.15 });

    observer.observe(heroSection);
  }

  // 7. Pausar quando o usuário troca ou minimiza a aba
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!video.paused) video.pause();
    } else {
      if (isSectionInView && video.src && !prefersReducedMotion) {
        video.play().catch(() => {});
      }
    }
  });
}

/**
 * 3. Menu Responsivo Mobile (Hambúrguer, Overlay e Acessibilidade)
 */
function initMobileMenu() {
  const toggleBtn = document.getElementById('mobileMenuToggle');
  const panel = document.getElementById('mobileNavPanel');
  const overlay = document.getElementById('mobileNavOverlay');
  const navLinks = document.querySelectorAll('.mobile-nav-link');

  if (!toggleBtn || !panel || !overlay) return;

  function openMenu() {
    const menuTop = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 90;
    [panel, overlay].forEach(el => { el.style.top = menuTop + 'px'; el.style.height = 'calc(100dvh - ' + menuTop + 'px)'; });
    toggleBtn.classList.add('active');
    panel.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    toggleBtn.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    toggleBtn.classList.remove('active');
    panel.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  toggleBtn.addEventListener('click', () => {
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  overlay.addEventListener('click', closeMenu);

  navLinks.forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  // Fechar ao pressionar ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) {
      closeMenu();
    }
  });
}

/**
 * 3. FAQ Accordion Interativo
 */
function initFaqAccordion() {
  const faqButtons = document.querySelectorAll('.faq-button');

  faqButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const currentItem = btn.parentElement;
      const isOpen = currentItem.classList.contains('active');

      // Fecha todos os outros itens para manter o layout limpo
      document.querySelectorAll('.faq-item').forEach((item) => {
        if (item !== currentItem) {
          item.classList.remove('active');
          const otherBtn = item.querySelector('.faq-button');
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
        }
      });

      // Alterna o estado do item atual
      if (isOpen) {
        currentItem.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
      } else {
        currentItem.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

/**
 * 4. Rolagem Suave com Destaque de Link Ativo
 */
function initSmoothScroll() {
  const links = document.querySelectorAll('a[href^="#"]');

  links.forEach((link) => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      if (!targetId || targetId === '#' || targetId === '#!') return;

      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        const headerOffset = 90;
        const elementPosition = targetEl.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

  // Destaque de link ativo ao rolar
  const sections = document.querySelectorAll('section[id]');
  const desktopLinks = document.querySelectorAll('.nav-desktop .nav-link');

  window.addEventListener('scroll', () => {
    let current = '';
    const scrollPosition = window.pageYOffset + 120;

    sections.forEach((section) => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.offsetHeight;
      if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
        current = section.getAttribute('id');
      }
    });

    desktopLinks.forEach((a) => {
      a.classList.remove('active');
      if (a.getAttribute('href') === `#${current}`) {
        a.classList.add('active');
      }
    });
  }, { passive: true });
}

/**
 * 5. Copiar Endereço Completo com Feedback Toast
 */
function initCopyAddress() {
  const copyBtn = document.getElementById('copyAddressBtn');
  if (!copyBtn) return;

  const fullAddress = 'Av. Nossa Sra. de Copacabana, 807 - Sala 706, Copacabana, Rio de Janeiro - RJ, 22050-002';

  copyBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(fullAddress);
      } else {
        // Fallback para navegadores antigos
        const textarea = document.createElement('textarea');
        textarea.value = fullAddress;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast('Endereço copiado para a área de transferência!');
    } catch (err) {
      showToast('Endereço: Av. Nossa Sra. de Copacabana, 807 - Sala 706');
    }
  });
}

/**
 * Notificação Flutuante (Toast)
 */
function showToast(message) {
  let toast = document.getElementById('toastNotification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastNotification';
    toast.className = 'toast-notification';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #34d399;">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <span>${message}</span>
  `;

  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

/**
 * 6. Modal Interativo de Agendamento Personalizado
 */
function initBookingModal() {
  const backdrop = document.getElementById('bookingModal');
  const card = backdrop?.querySelector('.assessment-card');
  const close = document.getElementById('closeBookingModal');
  const form = document.getElementById('quickBookingForm');
  if (!backdrop || !card || !close || !form) return;
  let opener, previousOverflow;
  function hide() {
    backdrop.classList.remove('active');
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = previousOverflow || '';
    opener?.focus();
  }
  document.querySelectorAll('.open-booking-modal').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      opener = button;
      previousOverflow = document.body.style.overflow;
      const select = document.getElementById('modalServiceSelect');
      select.value = button.dataset.service || '';
      backdrop.hidden = false;
      backdrop.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('active');
      document.body.style.overflow = 'hidden';
      form.scrollTop = 0;
      card.focus();
    });
  });
  close.addEventListener('click', hide);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) hide(); });
  document.addEventListener('keydown', event => {
    if (backdrop.hidden) return;
    if (event.key === 'Escape') hide();
    if (event.key === 'Tab') {
      const items = Array.from(card.querySelectorAll('button, input, select, a[href], textarea')).filter(el => !el.disabled && el.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === card)) { event.preventDefault(); first?.focus(); }
    }
  });
  const pain = document.getElementById('painLevel');
  pain.addEventListener('input', () => { document.getElementById('painValue').textContent = pain.value + '/10'; });
  const phone = document.getElementById('clientPhone');
  phone.addEventListener('input', () => phone.setCustomValidity(''));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const digits = phone.value.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) {
      phone.setCustomValidity('Informe um telefone com DDD válido.');
      phone.reportValidity();
      return;
    }
    const data = new FormData(form);
    const text = [
      'Olá, equipe do Espaço Ligia de Mayor! Gostaria de solicitar minha avaliação.',
      '',
      '*Nome:* ' + data.get('name').trim(),
      '*WhatsApp / telefone:* ' + phone.value.trim(),
      '*Região / necessidade:* ' + data.get('region'),
      '*Tempo de desconforto:* ' + data.get('duration'),
      '*Intensidade (0 a 10):* ' + data.get('pain') + '/10',
      '*Principal objetivo:* ' + data.get('goal'),
      '*Modalidade de interesse:* ' + (document.getElementById('modalServiceSelect').value || 'Quero orientação na avaliação'),
      '',
      'Quero saber os horários disponíveis para minha avaliação individual.'
    ].join('\n');
    window.location.assign('https://wa.me/5521997172737?text=' + encodeURIComponent(text));
  });
}

/**
 * 7. Atualização do Ano no Rodapé
 */
function initDynamicYear() {
  const yearEl = document.getElementById('currentYear');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}
