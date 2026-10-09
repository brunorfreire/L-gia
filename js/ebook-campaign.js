/**
 * ============================================================================
 * CAMPANHA DO GUIA GRATUITO: "ROTINA MATINAL DE 7 MINUTOS"
 * Espaço Lígia de Mayor - Fisioterapia e Pilates (Copacabana, RJ)
 * ============================================================================
 * 
 * Fluxo Direto:
 * 1. Visitante informa o primeiro nome e clica em "Quero meu guia gratuito" (ou pressiona Enter).
 * 2. Validação: se vazio, exibe "Informe seu primeiro nome para solicitar o guia" e foca o campo.
 * 3. Se preenchido, navega diretamente na mesma aba para o WhatsApp oficial (5521997172737)
 *    com mensagem pré-preenchida e codificada com encodeURIComponent.
 * 4. Popup em etapa única: sem segunda tela de sucesso, sem botões de download.
 * 5. Frequência:
 *    - Visitante novo: abertura automática após ~1 segundo do DOM pronto.
 *    - Visitante que fechou ou clicou para WhatsApp: não reabre na mesma sessão.
 *    - Sem bloqueio de 30 dias (apenas inicia a solicitação, não considera lead concluído).
 *    - Parâmetro ?previewEbook=1 para teste forçado sem gravação de flags.
 *    - Reabertura manual sempre permitida pelos botões [data-open-ebook].
 * ============================================================================
 */

(function () {
  'use strict';

  // Chaves de controle de sessão específicas e versionadas (v4)
  const STORAGE_KEYS = {
    SESSION_SHOWN: 'elm_rotina7m_v4_shown_session',
    SESSION_DISMISSED: 'elm_rotina7m_v4_dismissed_session'
  };

  // Tempo de espera para disparo automático (~1 segundo)
  const AUTO_OPEN_DELAY = 1000;

  // Armazenamento em memória caso cookies/storages estejam restritos (iframe / sandbox)
  const memoryStore = {
    session: {}
  };

  const safeStorage = {
    isSessionAvailable() {
      try {
        const testKey = '__elm_test_ss__';
        window.sessionStorage.setItem(testKey, '1');
        window.sessionStorage.removeItem(testKey);
        return true;
      } catch (e) {
        return false;
      }
    },
    getSession(key) {
      if (this.isSessionAvailable()) {
        try {
          return window.sessionStorage.getItem(key);
        } catch (e) {}
      }
      return memoryStore.session[key] || null;
    },
    setSession(key, value) {
      if (this.isSessionAvailable()) {
        try {
          window.sessionStorage.setItem(key, value);
        } catch (e) {}
      }
      memoryStore.session[key] = value;
    },
    removeSession(key) {
      try {
        if (this.isSessionAvailable()) {
          window.sessionStorage.removeItem(key);
        }
      } catch (e) {}
      delete memoryStore.session[key];
    }
  };

  // Estado interno da campanha
  const state = {
    isOpen: false,
    lastActiveTrigger: null,
    autoOpenScheduled: false,
    initialized: false
  };

  // Referências aos elementos do DOM
  let modalBackdrop = null;
  let modalCard = null;
  let closeBtn = null;
  let dismissBtn = null;
  let form = null;
  let nameInput = null;
  let nameError = null;
  let submitBtn = null;

  /**
   * Obtém configurações centrais
   */
  function getConfig() {
    return window.EBOOK_CONFIG || {
      whatsappNumber: '5521997172737'
    };
  }

  /**
   * Verifica se o parâmetro de teste ?previewEbook=1 está presente
   */
  function isPreviewMode() {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get('previewEbook') === '1' || searchParams.get('previewEbook') === 'true') {
        return true;
      }
      if (window.location.hash && (window.location.hash.includes('previewEbook=1') || window.location.hash.includes('previewEbook=true'))) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Verifica se outro modal está aberto na tela (questionário de avaliação ou área profissional)
   */
  function isAnyOtherModalOpen() {
    try {
      const assessmentModal = document.getElementById('assessmentModal') || document.getElementById('bookingModal');
      if (assessmentModal && assessmentModal.classList.contains('active')) {
        return true;
      }

      const privateAreaModal = document.getElementById('privateAreaModal');
      if (privateAreaModal && privateAreaModal.classList.contains('active')) {
        return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Verifica elegibilidade de disparo automático
   */
  function canAutoOpen() {
    // Modo de teste forçado: sempre permite
    if (isPreviewMode()) {
      return true;
    }

    try {
      // Visitante que fechou o popup nesta sessão: não reabrir
      if (safeStorage.getSession(STORAGE_KEYS.SESSION_DISMISSED) === 'true') {
        return false;
      }

      // Já foi apresentado nesta sessão: não reabrir
      if (safeStorage.getSession(STORAGE_KEYS.SESSION_SHOWN) === 'true') {
        return false;
      }

      // Se outro modal estiver aberto neste momento
      if (isAnyOtherModalOpen()) {
        return false;
      }

      return true;
    } catch (e) {
      return !memoryStore.session[STORAGE_KEYS.SESSION_SHOWN] && !memoryStore.session[STORAGE_KEYS.SESSION_DISMISSED];
    }
  }

  /**
   * Marca a oferta como exibida nesta sessão (após abertura efetiva)
   */
  function markShown() {
    if (isPreviewMode()) return;
    try {
      safeStorage.setSession(STORAGE_KEYS.SESSION_SHOWN, 'true');
    } catch (e) {}
  }

  /**
   * Marca a oferta como fechada nesta sessão para evitar repetição automática
   */
  function markDismissedSession() {
    if (isPreviewMode()) return;
    try {
      safeStorage.setSession(STORAGE_KEYS.SESSION_DISMISSED, 'true');
    } catch (e) {}
  }

  /**
   * Abre o popup do Ebook
   * Função única compartilhada pelo disparo automático e pelos botões da seção permanente
   */
  function openEbookModal(triggerElement = null) {
    if (!modalBackdrop) {
      modalBackdrop = document.getElementById('ebookLeadModal');
      if (!modalBackdrop) return;
    }

    // Se outro modal estiver aberto e for disparo automático, não sobrepõe
    if (isAnyOtherModalOpen() && !triggerElement) {
      return;
    }

    if (triggerElement) {
      state.lastActiveTrigger = triggerElement;
    } else if (document.activeElement && document.activeElement !== document.body) {
      state.lastActiveTrigger = document.activeElement;
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

    // Limpa erro anterior ao reabrir
    if (nameError) {
      nameError.style.display = 'none';
      nameError.textContent = '';
    }
    if (nameInput) {
      nameInput.removeAttribute('aria-invalid');
    }

    // Sincroniza estado de exibição
    modalBackdrop.removeAttribute('hidden');
    modalBackdrop.hidden = false;
    modalBackdrop.style.removeProperty('display');
    modalBackdrop.style.display = 'flex';
    modalBackdrop.setAttribute('aria-hidden', 'false');
    modalBackdrop.classList.add('active');
    if (document.body) {
      document.body.classList.add('modal-open');
    }
    state.isOpen = true;

    // Registra como exibido SOMENTE após o modal estar efetivamente aberto
    markShown();

    // Foco acessível sem rolar a página para fora da primeira seção
    setTimeout(() => {
      if (nameInput) {
        try {
          nameInput.focus({ preventScroll: true });
        } catch (e) {
          try { nameInput.focus(); } catch (e2) {}
        }
      } else if (closeBtn) {
        try {
          closeBtn.focus({ preventScroll: true });
        } catch (e) {
          try { closeBtn.focus(); } catch (e2) {}
        }
      }
    }, 60);
  }

  /**
   * Fecha o popup do Ebook
   */
  function closeEbookModal() {
    if (!modalBackdrop) return;

    modalBackdrop.classList.remove('active');
    modalBackdrop.setAttribute('aria-hidden', 'true');
    modalBackdrop.setAttribute('hidden', '');
    modalBackdrop.hidden = true;
    modalBackdrop.style.display = 'none';
    state.isOpen = false;

    // Marca como fechado nesta sessão para não reabrir automaticamente
    markDismissedSession();

    // Se nenhuma outra modal estiver aberta, restaura rolagem do body
    if (!isAnyOtherModalOpen() && document.body) {
      document.body.classList.remove('modal-open');
    }

    // Restaura o foco para o elemento disparador
    if (state.lastActiveTrigger && typeof state.lastActiveTrigger.focus === 'function') {
      try {
        state.lastActiveTrigger.focus({ preventScroll: true });
      } catch (e) {
        try {
          state.lastActiveTrigger.focus();
        } catch (e2) {}
      }
    }
  }

  /**
   * Validação e submissão do formulário de captação
   * Funciona tanto pelo clique no botão quanto pelo Enter no campo
   */
  function handleFormSubmit(e) {
    if (e) {
      e.preventDefault();
    }
    if (!nameInput) return;

    const rawName = (nameInput.value || '').trim();

    // Validação: campo não pode estar vazio
    if (!rawName) {
      if (nameError) {
        nameError.textContent = 'Informe seu primeiro nome para solicitar o guia';
        nameError.style.display = 'block';
      }
      nameInput.setAttribute('aria-invalid', 'true');
      try {
        nameInput.focus({ preventScroll: true });
      } catch (err) {
        nameInput.focus();
      }
      return;
    }

    if (nameError) {
      nameError.style.display = 'none';
      nameError.textContent = '';
    }
    nameInput.removeAttribute('aria-invalid');

    // Extrai o primeiro nome (preservando acentos e caracteres especiais)
    const firstName = rawName.split(/\s+/)[0];

    // Mensagem oficial exigida:
    // “Olá, equipe do Espaço Ligia de Mayor! Meu nome é [NOME]. Vim pelo site através da oferta do ebook gratuito ‘Rotina Matinal de 7 Minutos’ e gostaria de receber o material por aqui. 😊”
    const message = `Olá, equipe do Espaço Ligia de Mayor! Meu nome é ${firstName}. Vim pelo site através da oferta do ebook gratuito ‘Rotina Matinal de 7 Minutos’ e gostaria de receber o material por aqui. 😊`;

    const config = getConfig();
    const phone = config.whatsappNumber || '5521997172737';
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

    // Marca que o popup foi concluído nesta sessão para não reabrir automaticamente ao retornar
    markDismissedSession();

    // Navegação direta na mesma aba imediatamente no evento do usuário (sem timers/async)
    // para garantir abertura confiável e evitar bloqueadores de popups
    window.location.href = waUrl;
  }

  /**
   * Observa fechamento de outros modais para reavaliar abertura da oferta
   */
  function watchOtherModalsForClosing() {
    let checkInterval = null;
    let observer = null;

    function tryTriggerAfterOtherClosed() {
      if (!isAnyOtherModalOpen() && canAutoOpen() && !state.isOpen) {
        if (checkInterval) clearInterval(checkInterval);
        if (observer) observer.disconnect();
        setTimeout(() => {
          if (!isAnyOtherModalOpen() && canAutoOpen() && !state.isOpen) {
            openEbookModal(null);
          }
        }, 600);
      }
    }

    checkInterval = setInterval(tryTriggerAfterOtherClosed, 600);
    setTimeout(() => {
      if (checkInterval) clearInterval(checkInterval);
    }, 45000);

    if (window.MutationObserver) {
      observer = new MutationObserver(() => {
        tryTriggerAfterOtherClosed();
      });

      const assessmentModal = document.getElementById('assessmentModal') || document.getElementById('bookingModal');
      const privateAreaModal = document.getElementById('privateAreaModal');
      if (assessmentModal) {
        observer.observe(assessmentModal, { attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
      }
      if (privateAreaModal) {
        observer.observe(privateAreaModal, { attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
      }
    }
  }

  /**
   * Agenda abertura automática após ~1 segundo do DOM pronto
   */
  function scheduleAutoOpen() {
    if (state.autoOpenScheduled) return;
    state.autoOpenScheduled = true;

    setTimeout(() => {
      if (isAnyOtherModalOpen()) {
        watchOtherModalsForClosing();
        return;
      }

      if (canAutoOpen() && !state.isOpen) {
        openEbookModal(null);
      }
    }, AUTO_OPEN_DELAY);
  }

  /**
   * Inicialização do popup e eventos
   */
  function initEbookCampaign() {
    if (state.initialized) return;

    modalBackdrop = document.getElementById('ebookLeadModal');
    if (!modalBackdrop) return;
    state.initialized = true;

    modalCard = document.getElementById('ebookLeadCard');
    closeBtn = document.getElementById('closeEbookModal');
    dismissBtn = document.getElementById('btnDismissEbook');
    form = document.getElementById('ebookLeadForm');
    nameInput = document.getElementById('ebookUserName');
    nameError = document.getElementById('ebookNameError');
    submitBtn = document.getElementById('btnSubmitEbook');

    // Estado inicial estritamente oculto no HTML
    modalBackdrop.setAttribute('hidden', '');
    modalBackdrop.hidden = true;
    modalBackdrop.style.display = 'none';
    modalBackdrop.setAttribute('aria-hidden', 'true');

    // Submissão do formulário (trata clique no botão submit e Enter no campo)
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }

    // Limpa estado de erro assim que o usuário começa a digitar
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        if (nameInput.value.trim().length > 0) {
          if (nameError) {
            nameError.style.display = 'none';
            nameError.textContent = '';
          }
          nameInput.removeAttribute('aria-invalid');
        }
      });
    }

    // Botão fechar (X)
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeEbookModal();
      });
    }

    // Botão "Agora não"
    if (dismissBtn) {
      dismissBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeEbookModal();
      });
    }

    // Fechar ao clicar no backdrop escuro
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeEbookModal();
      }
    });

    // Fechar com a tecla Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.isOpen) {
        closeEbookModal();
      }
    });

    // Reabertura manual pelos botões da seção permanente ([data-open-ebook])
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-ebook]');
      if (trigger) {
        e.preventDefault();
        if (nameInput) nameInput.value = '';
        if (nameError) {
          nameError.style.display = 'none';
          nameError.textContent = '';
        }
        openEbookModal(trigger);
      }
    });

    // Agenda a abertura automática
    scheduleAutoOpen();
  }

  // Expor API global unificada
  window.openEbookModal = function (trigger = null) {
    if (nameInput) nameInput.value = '';
    if (nameError) {
      nameError.style.display = 'none';
      nameError.textContent = '';
    }
    openEbookModal(trigger);
  };
  window.closeEbookModal = closeEbookModal;

  // Inicialização segura
  if (document.getElementById('ebookLeadModal')) {
    initEbookCampaign();
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEbookCampaign);
    window.addEventListener('load', initEbookCampaign);
  } else {
    initEbookCampaign();
  }
})();
