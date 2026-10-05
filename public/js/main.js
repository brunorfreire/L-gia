/**
 * Espaço Ligia de Mayor - Scripts Principais
 * Fisioterapia & Estúdio de Pilates em Copacabana, Rio de Janeiro
 * JavaScript Vanilla moderno, modular e otimizado para carregamento rápido
 */

/**
 * Função utilitária para inicializar módulos com isolamento de falhas.
 * Garante que a falha em um recurso (como vídeo de fundo) não bloqueie o questionário.
 */
function safeRun(moduleName, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`[Espaço Lígia] Falha ao inicializar módulo "${moduleName}":`, error);
  }
}

/**
 * Ponto de entrada principal da aplicação.
 * Executa com suporte a DOM em carregamento ou já pronto (document.readyState).
 */
function initAllModules() {
  // 1. O Modal de Avaliação é a funcionalidade mais crítica: inicializado em 1º lugar
  safeRun('initAssessmentModal', initAssessmentModal);

  // 2. Demais módulos visuais e interativos com isolamento de erros
  safeRun('initHeaderScroll', initHeaderScroll);
  safeRun('initHeroVideo', initHeroVideo);
  safeRun('initMobileMenu', initMobileMenu);
  safeRun('initFaqAccordion', initFaqAccordion);
  safeRun('initSmoothScroll', initSmoothScroll);
  safeRun('initCopyAddress', initCopyAddress);
  safeRun('initDynamicYear', initDynamicYear);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAllModules, { once: true });
} else {
  // DOMContentLoaded já ocorreu antes da execução deste script
  initAllModules();
}

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
  const prefersReducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let isDataSaver = false;
  try {
    isDataSaver = Boolean(navigator.connection && navigator.connection.saveData === true);
  } catch (err) {}

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
 * 6. Modal Interativo de Avaliação Individual (Questionário Contínuo)
 * - Inspirado no fluxo contínuo de alta conversão adaptado ao Espaço Lígia de Mayor
 * - Cartões de seleção com destaque turquesa e indicador visual
 * - Escala de desconforto de 0 a 10 com display interativo e marcadores rápidos
 * - Máscara automática de telefone celular brasileiro (DDD + 9 dígitos)
 * - Mensagem formatada enviada diretamente para o WhatsApp oficial 5521997172737
 * - Não armazena dados em localStorage, analytics ou logs
 */
function initAssessmentModal() {
  const modalBackdrop = document.getElementById('assessmentModal') || document.getElementById('bookingModal');
  const closeButton = document.getElementById('closeAssessmentModal') || document.getElementById('closeBookingModal');
  const triggerSelectors = '[data-open-assessment], .open-assessment-modal, .open-booking-modal';
  const form = document.getElementById('assessmentForm') || document.getElementById('quickBookingForm');

  if (!modalBackdrop || !closeButton) return;

  // Evita inicialização duplicada
  if (modalBackdrop.dataset.initialized === 'true') return;
  modalBackdrop.dataset.initialized = 'true';

  // Elementos da Escala de Dor/Desconforto
  const painInput = document.getElementById('painRangeInput');
  const painCircle = document.getElementById('painScoreCircle');
  const painText = document.getElementById('painScoreText');
  const painHelp = document.getElementById('painScoreHelp');
  const painButtons = document.querySelectorAll('.pain-num-btn');

  // Elementos do formulário de contato
  const nameInput = document.getElementById('assessmentUserName');
  const phoneInput = document.getElementById('assessmentUserPhone');
  const consentInput = document.getElementById('assessmentUserConsent');
  const nameError = document.getElementById('nameError');
  const phoneError = document.getElementById('phoneError');

  // Cartões de escolha das perguntas
  const choiceCards = document.querySelectorAll('.assessment-choice-card, .assessment-option');

  // Armazena o último botão focado para restaurar o foco ao fechar
  let lastActiveTrigger = null;

  // Função para abrir o modal
  function openModal(defaultRegion = '', triggerElement = null) {
    if (triggerElement) {
      lastActiveTrigger = triggerElement;
    } else if (document.activeElement && document.activeElement !== document.body) {
      lastActiveTrigger = document.activeElement;
    }

    // Fecha o menu mobile se estiver aberto
    const mobilePanel = document.getElementById('mobileNavPanel');
    const mobileOverlay = document.getElementById('mobileNavOverlay');
    const mobileToggle = document.getElementById('mobileMenuToggle');
    if (mobilePanel && mobilePanel.classList.contains('open')) {
      mobilePanel.classList.remove('open');
      if (mobileOverlay) mobileOverlay.classList.remove('open');
      if (mobileToggle) {
        mobileToggle.classList.remove('active');
        mobileToggle.setAttribute('aria-expanded', 'false');
      }
      document.body.style.overflow = '';
    }

    // 1. Sincroniza hidden e display
    modalBackdrop.removeAttribute('hidden');
    modalBackdrop.hidden = false;
    modalBackdrop.style.display = 'flex';

    // 2. Sincroniza aria-hidden
    modalBackdrop.setAttribute('aria-hidden', 'false');

    // 3. Sincroniza classe de exibição
    modalBackdrop.classList.add('active');
    document.body.classList.add('modal-open');

    // 4. Se houver uma região ou necessidade padrão, seleciona o cartão correspondente
    if (defaultRegion) {
      const targetRadio = document.querySelector(`input[name="region"][value="${defaultRegion}"]`);
      if (targetRadio) {
        targetRadio.checked = true;
        updateCardSelection('region');
      }
    }

    // 5. Garante que o scroll do corpo do modal inicie no topo
    const modalBody = modalBackdrop.querySelector('.assessment-modal-body, .assessment-body');
    if (modalBody) {
      modalBody.scrollTop = 0;
    }

    // 6. Foco acessível no botão fechar
    setTimeout(() => {
      if (closeButton && typeof closeButton.focus === 'function') {
        closeButton.focus();
      }
    }, 60);
  }

  // Função para fechar o modal
  function closeModal() {
    // 1. Sincroniza classe de exibição
    modalBackdrop.classList.remove('active');
    document.body.classList.remove('modal-open');

    // 2. Sincroniza aria-hidden
    modalBackdrop.setAttribute('aria-hidden', 'true');

    // 3. Sincroniza hidden
    modalBackdrop.setAttribute('hidden', '');
    modalBackdrop.hidden = true;
    modalBackdrop.style.display = 'none';

    // 4. Devolve o foco ao botão que abriu o modal
    if (lastActiveTrigger && typeof lastActiveTrigger.focus === 'function') {
      try {
        lastActiveTrigger.focus();
      } catch (err) {}
    }
  }

  // Expor globalmente na window para disparos diretos e compatibilidade total
  window.openAssessmentModal = function(region = '', trigger = null) {
    openModal(region, trigger);
  };
  window.closeAssessmentModal = closeModal;

  // Atualiza classes visuais nos cartões da pergunta especificada
  function updateCardSelection(groupName) {
    const radios = document.querySelectorAll(`input[name="${groupName}"]`);
    radios.forEach((radio) => {
      const card = radio.closest('.assessment-choice-card, .assessment-option');
      if (card) {
        if (radio.checked) {
          card.classList.add('selected');
        } else {
          card.classList.remove('selected');
        }
      }
    });
  }

  // Event listener para seleção dos cartões
  choiceCards.forEach((card) => {
    const radio = card.querySelector('input[type="radio"]');
    if (!radio) return;

    radio.addEventListener('change', () => {
      if (radio.checked) {
        updateCardSelection(radio.name);
      }
    });
  });

  // Atualização interativa da Escala de Desconforto (0 a 10)
  function updatePainScale(value) {
    const val = Math.min(10, Math.max(0, parseInt(value, 10) || 0));

    if (painCircle) painCircle.textContent = val;

    let badgeText = `Nível ${val} · Moderado`;
    let helpText = 'Desconforto que incomoda em tarefas cotidianas';

    if (val === 0) {
      badgeText = 'Nível 0 · Sem dor';
      helpText = 'Não sinto dor no momento, foco em prevenção e bem-estar';
    } else if (val >= 1 && val <= 3) {
      badgeText = `Nível ${val} · Leve`;
      helpText = 'Desconforto pontual que não interfere nas atividades diárias';
    } else if (val >= 4 && val <= 6) {
      badgeText = `Nível ${val} · Moderado`;
      helpText = 'Desconforto perceptível que limita o rendimento no dia a dia';
    } else if (val >= 7 && val <= 9) {
      badgeText = `Nível ${val} · Intenso`;
      helpText = 'Dor expressiva com restrições importantes de movimento';
    } else if (val === 10) {
      badgeText = 'Nível 10 · Muito intenso';
      helpText = 'Dor aguda incapacitante com forte limitação postural e física';
    }

    if (painText) painText.textContent = badgeText;
    if (painHelp) painHelp.textContent = helpText;

    // Atualiza o preenchimento em degradê do slider (turquesa preenchido)
    if (painInput) {
      const pct = (val / 10) * 100;
      painInput.style.background = `linear-gradient(to right, #0E9AA7 0%, #0E9AA7 ${pct}%, #E2E8F0 ${pct}%, #E2E8F0 100%)`;
      if (painInput.value !== String(val)) {
        painInput.value = val;
      }
    }

    // Atualiza botão numérico ativo
    painButtons.forEach((btn) => {
      const btnVal = parseInt(btn.getAttribute('data-value'), 10);
      btn.classList.toggle('active', btnVal === val);
    });
  }

  // Listener no slider
  if (painInput) {
    painInput.addEventListener('input', (e) => {
      updatePainScale(e.target.value);
    });
    // Inicialização da escala
    updatePainScale(painInput.value || 5);
  }

  // Listener nos botões numéricos rápidos
  painButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const val = btn.getAttribute('data-value');
      updatePainScale(val);
    });
  });

  // Máscara amigável para telefone/WhatsApp brasileiro: (XX) XXXXX-XXXX
  if (phoneInput) {
    phoneInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\D/g, '').substring(0, 11);
      if (value.length > 10) {
        // Formato com 9 dígitos: (XX) XXXXX-XXXX
        value = value.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
      } else if (value.length > 6) {
        // Formato intermediário: (XX) XXXX-XXXX
        value = value.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
      } else if (value.length > 2) {
        value = value.replace(/^(\d{2})(\d{0,5})$/, '($1) $2');
      } else if (value.length > 0) {
        value = value.replace(/^(\d*)$/, '($1');
      }
      e.target.value = value;

      if (phoneError) phoneError.classList.remove('visible');
    });
  }

  if (nameInput) {
    nameInput.addEventListener('input', () => {
      if (nameError) nameError.classList.remove('visible');
    });
  }

  // Delegação central de eventos no document para capturar qualquer elemento de abertura
  // (Reconhece cliques em textos, ícones SVG e elementos aninhados e evita listeners duplicados)
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest(triggerSelectors);
    if (trigger) {
      e.preventDefault();
      const region = trigger.getAttribute('data-region') || trigger.getAttribute('data-service') || '';
      openModal(region, trigger);
    }
  });

  // Listener de fechamento
  closeButton.addEventListener('click', closeModal);

  // Fechar ao clicar no backdrop escuro
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
      closeModal();
    }
  });

  // Fechar com a tecla ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBackdrop.classList.contains('active')) {
      closeModal();
    }
  });

  // Envio do formulário formatado para o WhatsApp oficial
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      let hasError = false;

      // Validação do Nome
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name || name.length < 2) {
        if (nameError) nameError.classList.add('visible');
        if (nameInput) nameInput.focus();
        hasError = true;
      }

      // Validação do WhatsApp (mínimo 10 dígitos com DDD)
      const rawPhone = phoneInput ? phoneInput.value.replace(/\D/g, '') : '';
      if (!rawPhone || rawPhone.length < 10) {
        if (phoneError) phoneError.classList.add('visible');
        if (!hasError && phoneInput) phoneInput.focus();
        hasError = true;
      }

      // Validação do Consentimento
      if (consentInput && !consentInput.checked) {
        showToast('Por favor, confirme a concordância para prosseguir ao WhatsApp.');
        hasError = true;
      }

      if (hasError) return;

      // Coleta das respostas
      const regionChecked = document.querySelector('input[name="region"]:checked');
      const region = regionChecked ? regionChecked.value : 'Geral';

      const durationChecked = document.querySelector('input[name="duration"]:checked');
      const duration = durationChecked ? durationChecked.value : 'Recente';

      const painLevel = painInput ? painInput.value : '5';

      const goalChecked = document.querySelector('input[name="goal"]:checked');
      const goal = goalChecked ? goalChecked.value : 'Aliviar a dor e me movimentar melhor';

      // Monta a mensagem rigorosamente no formato especificado:
      const formattedPhone = phoneInput ? phoneInput.value.trim() : rawPhone;

      const message = `Olá, equipe do Espaço Ligia de Mayor!\n` +
        `Preenchi o questionário no site e gostaria de solicitar minha avaliação.\n\n` +
        `Nome: ${name}\n` +
        `WhatsApp: ${formattedPhone}\n` +
        `Região ou necessidade: ${region}\n` +
        `Tempo de desconforto: ${duration}\n` +
        `Intensidade do desconforto: ${painLevel}/10\n` +
        `Principal objetivo: ${goal}\n\n` +
        `Gostaria de saber os horários disponíveis para minha avaliação individual.`;

      const whatsappNumber = '5521997172737';
      const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

      // Feedback toast amigável e abertura do WhatsApp
      showToast('Abrindo o WhatsApp com sua mensagem preenchida...');

      // Fecha o modal após confirmação do clique
      setTimeout(() => {
        closeModal();
      }, 300);

      // Abre no WhatsApp sem persistência em localStorage ou logs
      try {
        const link = document.createElement('a');
        link.href = whatsappUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      }
    });
  }
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
