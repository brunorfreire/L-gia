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
 * - Enquanto nenhuma URL for configurada, exibe exclusivamente a imagem estática oficial
 *   sem solicitar arquivos demonstrativos inexistentes ou gerar erros 404
 * - Assim que a URL for preenchida, ativa reprodução silenciosa (muted, playsInline, loop)
 * - Exibe o botão de controle de play/pause somente quando houver vídeo ativo
 * - Respeita acessibilidade de movimento reduzido (prefers-reduced-motion) e economia de dados
 * - Pausa automática fora da viewport (IntersectionObserver) ou aba em segundo plano
 */
function initHeroVideo() {
  const config = window.HERO_VIDEO_CONFIG || {
    videoUrl: '',
    posterUrl: './assets/hero-studio-poster.jpg'
  };

  const videoWrapper = document.getElementById('heroVideoWrapper');
  const video = document.getElementById('heroBackgroundVideo');
  const controlBtn = document.getElementById('heroVideoControlBtn');
  const staticWrapper = document.getElementById('heroImageWrapper');
  const heroSection = document.getElementById('inicio');

  // 1. Caso nenhuma URL de vídeo tenha sido informada:
  // Mantém 100% o fundo com a imagem estática de alta qualidade, sem tentar carregar vídeos fictícios
  const targetVideoUrl = (config.videoUrl || '').trim();
  if (!targetVideoUrl) {
    if (videoWrapper) videoWrapper.style.display = 'none';
    if (staticWrapper) staticWrapper.style.display = 'block';
    if (controlBtn) controlBtn.style.display = 'none';
    return;
  }

  // 2. Respeito à acessibilidade de movimento reduzido e economia de dados móveis
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDataSaver = navigator.connection && navigator.connection.saveData === true;

  if (prefersReducedMotion || isDataSaver) {
    if (videoWrapper) videoWrapper.style.display = 'none';
    if (staticWrapper) staticWrapper.style.display = 'block';
    if (controlBtn) controlBtn.style.display = 'none';
    return;
  }

  if (!video) return;

  // 3. Aplicação da URL pública fornecida e propriedades para reprodução silenciosa garantida
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.loop = true;
  video.preload = 'auto';
  video.src = targetVideoUrl;

  let userManuallyPaused = false;
  let isSectionInView = true;

  // 4. Exibição suave do contêiner do vídeo e ativação do botão apenas quando o vídeo puder reproduzir
  const handleReadyToPlay = () => {
    if (videoWrapper) videoWrapper.style.display = 'block';
    video.classList.add('is-ready');
    if (controlBtn) controlBtn.style.display = 'inline-flex';
    updateControlState(false);
  };

  if (video.readyState >= 3) {
    handleReadyToPlay();
  } else {
    video.addEventListener('canplay', handleReadyToPlay, { once: true });
    video.addEventListener('playing', handleReadyToPlay, { once: true });
  }

  // 5. Fallback automático em caso de falha de carregamento da URL (ex: erro 404 na hospedagem)
  video.addEventListener('error', () => {
    console.warn('Vídeo do Hero não pôde ser reproduzido pela URL informada. Exibindo imagem estática oficial.');
    if (videoWrapper) videoWrapper.style.display = 'none';
    if (staticWrapper) staticWrapper.style.display = 'block';
    if (controlBtn) controlBtn.style.display = 'none';
  });

  // 6. Tentativa de reprodução automática com captura de bloqueio do navegador
  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      // Caso a política do navegador exija interação, mantém o botão acessível no estado "pausado"
      if (videoWrapper) videoWrapper.style.display = 'block';
      if (controlBtn) controlBtn.style.display = 'inline-flex';
      updateControlState(true);
    });
  }

  // 7. Atualização do botão de controle (Play/Pause)
  function updateControlState(isPaused) {
    if (!controlBtn) return;
    const pauseIcon = controlBtn.querySelector('.icon-pause');
    const playIcon = controlBtn.querySelector('.icon-play');
    const labelText = controlBtn.querySelector('.control-text');

    if (isPaused) {
      controlBtn.setAttribute('aria-label', 'Reproduzir vídeo de fundo');
      controlBtn.setAttribute('aria-pressed', 'true');
      controlBtn.title = 'Reproduzir vídeo de fundo';
      if (pauseIcon) pauseIcon.style.display = 'none';
      if (playIcon) playIcon.style.display = 'inline-block';
      if (labelText) labelText.textContent = 'Reproduzir';
    } else {
      controlBtn.setAttribute('aria-label', 'Pausar vídeo de fundo');
      controlBtn.setAttribute('aria-pressed', 'false');
      controlBtn.title = 'Pausar vídeo de fundo';
      if (pauseIcon) pauseIcon.style.display = 'inline-block';
      if (playIcon) playIcon.style.display = 'none';
      if (labelText) labelText.textContent = 'Pausar';
    }
  }

  // 8. Evento de clique para alternar play/pause manualmente
  if (controlBtn) {
    controlBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (video.paused) {
        userManuallyPaused = false;
        video.play().then(() => updateControlState(false)).catch(() => {});
      } else {
        userManuallyPaused = true;
        video.pause();
        updateControlState(true);
      }
    });
  }

  // 9. Pausar automaticamente quando o Hero sai da tela (economia de bateria e dados)
  if ('IntersectionObserver' in window && heroSection) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        isSectionInView = entry.isIntersecting;
        if (!entry.isIntersecting) {
          if (!video.paused) video.pause();
        } else {
          if (!userManuallyPaused && !document.hidden && video.src) {
            video.play().then(() => updateControlState(false)).catch(() => {});
          }
        }
      });
    }, { threshold: 0.15 });

    observer.observe(heroSection);
  }

  // 10. Pausar quando o usuário troca de aba no navegador
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!video.paused) video.pause();
    } else {
      if (!userManuallyPaused && isSectionInView && video.src) {
        video.play().then(() => updateControlState(false)).catch(() => {});
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
  const modalBackdrop = document.getElementById('bookingModal');
  const openButtons = document.querySelectorAll('.open-booking-modal');
  const closeButton = document.getElementById('closeBookingModal');
  const form = document.getElementById('quickBookingForm');

  if (!modalBackdrop || !closeButton || !form) return;

  function openModal(defaultService = '') {
    if (defaultService) {
      const select = document.getElementById('modalServiceSelect');
      if (select) select.value = defaultService;
    }
    modalBackdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalBackdrop.classList.remove('active');
    document.body.style.overflow = '';
  }

  openButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const service = btn.getAttribute('data-service') || '';
      openModal(service);
    });
  });

  closeButton.addEventListener('click', closeModal);

  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBackdrop.classList.contains('active')) {
      closeModal();
    }
  });

  // Envio do formulário direto para o WhatsApp formatado
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('clientName').value.trim();
    const service = document.getElementById('modalServiceSelect').value;
    const period = document.getElementById('preferredPeriod').value;
    const notes = document.getElementById('clientNotes').value.trim();

    let text = `Olá, Lígia! Me chamo *${name}* e gostaria de agendar uma avaliação no Espaço Ligia de Mayor.\n\n`;
    text += `*Interesse:* ${service}\n`;
    if (period) text += `*Período de preferência:* ${period}\n`;
    if (notes) text += `*Mensagem/Queixa:* ${notes}\n`;

    const encodedText = encodeURIComponent(text);
    const whatsappUrl = `https://wa.me/5521997172737?text=${encodedText}`;

    closeModal();
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
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
