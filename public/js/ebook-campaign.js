/**
 * ============================================================================
 * CAMPANHA DO GUIA GRATUITO: "ROTINA MATINAL DE 7 MINUTOS"
 * Espaço Lígia de Mayor - Fisioterapia e Pilates (Copacabana, RJ)
 * ============================================================================
 * 
 * Regras de Negócio e Acessibilidade:
 * 1. Abertura automática cerca de 1 segundo após página pronta para novo visitante.
 * 2. Suporte a parâmetro de teste ?previewEbook=1 (força exibição sem gravar dados).
 * 3. Chaves versionadas (v2) com fallback em memória para evitar bloqueios por iframes.
 * 4. Não abre simultaneamente se questionário ou área de profissionais estiver aberta;
 *    observa e aguarda o fechamento para reavaliar a abertura da oferta.
 * 5. Visitante que fechou ("Agora não", X, ESC ou backdrop): não reabre na mesma sessão.
 * 6. Visitante que concluiu acesso: suspende abertura por 30 dias.
 * 7. Reabertura manual sempre permitida pelo botão da seção permanente ([data-open-ebook]).
 * 8. Não rola a página ao abrir (permanece sobre a primeira seção).
 * ============================================================================
 */

(function () {
  'use strict';

  // Chaves de controle específicas e versionadas (v2) para esta campanha
  const STORAGE_KEYS = {
    SESSION_SHOWN: 'elm_ebook_v2_shown',
    SESSION_DISMISSED: 'elm_ebook_v2_dismissed',
    CONVERTED_UNTIL: 'elm_ebook_v2_converted_until'
  };

  // Tempo de espera para disparo suave após DOM pronto (~1 segundo)
  const AUTO_OPEN_DELAY = 1000;

  // Armazenamento em memória caso localStorage/sessionStorage esteja inacessível (ex: iframe sandbox)
  const memoryStore = {
    session: {},
    local: {}
  };

  // Adaptador seguro contra restrições de terceiros / iframe / modo anônimo
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
    isLocalAvailable() {
      try {
        const testKey = '__elm_test_ls__';
        window.localStorage.setItem(testKey, '1');
        window.localStorage.removeItem(testKey);
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
    getLocal(key) {
      if (this.isLocalAvailable()) {
        try {
          return window.localStorage.getItem(key);
        } catch (e) {}
      }
      return memoryStore.local[key] || null;
    },
    setLocal(key, value) {
      if (this.isLocalAvailable()) {
        try {
          window.localStorage.setItem(key, value);
        } catch (e) {}
      }
      memoryStore.local[key] = value;
    }
  };

  // Estado interno da campanha
  const state = {
    isOpen: false,
    step: 'capture', // 'capture' | 'confirmed'
    firstName: '',
    lastActiveTrigger: null,
    pdfStatusChecked: false,
    pdfAvailable: true,
    autoOpenAttempted: false
  };

  // Referências aos elementos do DOM
  let modalBackdrop = null;
  let modalCard = null;
  let closeBtn = null;
  let dismissBtn = null;
  let captureStep = null;
  let confirmedStep = null;
  let form = null;
  let nameInput = null;
  let nameError = null;
  let whatsappBtn = null;
  let downloadBtn = null;
  let downloadNotice = null;
  let assessmentInviteBtn = null;

  /**
   * Obtém as configurações do ebook
   */
  function getConfig() {
    return window.EBOOK_CONFIG || {
      pdfUrl: './assets/rotina-matinal-7-minutos.pdf',
      pdfFallbackUrl: 'https://fisioligia.siteoficialpro.com/assets/rotina-matinal-7-minutos.pdf',
      whatsappNumber: '5521997172737',
      autoOpenDismissDays: 30
    };
  }

  /**
   * Verifica se o parâmetro de teste ?previewEbook=1 está presente na URL
   */
  function isPreviewMode() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('previewEbook') === '1';
    } catch (e) {
      return false;
    }
  }

  /**
   * Verifica se o PDF está acessível na URL configurada
   */
  async function checkPdfAvailability() {
    const config = getConfig();
    const targetUrl = config.pdfUrl || './assets/rotina-matinal-7-minutos.pdf';
    try {
      const response = await fetch(targetUrl, { method: 'HEAD' });
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && !contentType.includes('text/html')) {
        state.pdfAvailable = true;
      } else {
        // Se HEAD for bloqueado em ambiente estático, tenta GET leve ou mantém disponível
        state.pdfAvailable = true;
      }
    } catch (e) {
      state.pdfAvailable = true;
    }
    state.pdfStatusChecked = true;
  }

  /**
   * Checa se outra modal já está visível na tela
   */
  function isAnyOtherModalOpen() {
    // 1. Questionário de avaliação
    const assessmentModal = document.getElementById('assessmentModal') || document.getElementById('bookingModal');
    if (assessmentModal) {
      const isActive = assessmentModal.classList.contains('active');
      const isVisible = assessmentModal.style.display === 'flex' || assessmentModal.style.display === 'block';
      const isAriaOpen = assessmentModal.getAttribute('aria-hidden') === 'false';
      if (isActive || (isVisible && isAriaOpen)) {
        return true;
      }
    }

    // 2. Área privada de profissionais
    const privateAreaModal = document.getElementById('privateAreaModal');
    if (privateAreaModal) {
      const isActive = privateAreaModal.classList.contains('active');
      const isVisible = privateAreaModal.style.display === 'flex' || privateAreaModal.style.display === 'block';
      const isAriaOpen = privateAreaModal.getAttribute('aria-hidden') === 'false';
      if (isActive || (isVisible && isAriaOpen)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Verifica se a abertura automática está permitida pelas regras de frequência
   */
  function canAutoOpen() {
    // Modo de teste: sempre força a abertura para conferência
    if (isPreviewMode()) {
      return true;
    }

    try {
      // 1. Se o visitante fechou ou já viu nesta sessão
      if (safeStorage.getSession(STORAGE_KEYS.SESSION_DISMISSED) === 'true') {
        return false;
      }
      if (safeStorage.getSession(STORAGE_KEYS.SESSION_SHOWN) === 'true') {
        return false;
      }

      // 2. Se o visitante concluiu o fluxo de acesso nos últimos 30 dias
      const convertedUntil = safeStorage.getLocal(STORAGE_KEYS.CONVERTED_UNTIL);
      if (convertedUntil) {
        const timestamp = parseInt(convertedUntil, 10);
        if (Number.isFinite(timestamp) && Date.now() < timestamp) {
          return false;
        }
      }

      // 3. Se outra modal estiver aberta no momento
      if (isAnyOtherModalOpen()) {
        return false;
      }

      return true;
    } catch (e) {
      // Fallback em memória seguro
      return !memoryStore.session[STORAGE_KEYS.SESSION_SHOWN];
    }
  }

  /**
   * Registra que o popup foi efetivamente aberto nesta sessão
   */
  function markShown() {
    if (isPreviewMode()) return;
    try {
      safeStorage.setSession(STORAGE_KEYS.SESSION_SHOWN, 'true');
    } catch (e) {}
  }

  /**
   * Registra que o visitante fechou o popup (não reabrir na mesma sessão)
   */
  function markDismissedSession() {
    if (isPreviewMode()) return;
    try {
      safeStorage.setSession(STORAGE_KEYS.SESSION_DISMISSED, 'true');
    } catch (e) {}
  }

  /**
   * Registra a conversão (suspende a abertura automática por 30 dias)
   */
  function markConvertedLongTerm() {
    if (isPreviewMode()) return;
    try {
      const config = getConfig();
      const days = config.autoOpenDismissDays || 30;
      const expireTime = Date.now() + (days * 24 * 60 * 60 * 1000);
      safeStorage.setLocal(STORAGE_KEYS.CONVERTED_UNTIL, expireTime.toString());
      safeStorage.setSession(STORAGE_KEYS.SESSION_DISMISSED, 'true');
      safeStorage.setSession(STORAGE_KEYS.SESSION_SHOWN, 'true');
    } catch (e) {}
  }

  /**
   * Abre o popup do Ebook
   * Função única compartilhada pelo disparo automático e pelos botões manuais
   */
  function openEbookModal(triggerElement = null) {
    if (!modalBackdrop) {
      modalBackdrop = document.getElementById('ebookLeadModal');
      if (!modalBackdrop) return;
    }

    // Se outra modal estiver aberta no momento e for disparo automático, não abre
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

    // Exibe a modal garantindo atributos consistentes
    modalBackdrop.removeAttribute('hidden');
    modalBackdrop.hidden = false;
    modalBackdrop.style.display = 'flex';
    modalBackdrop.setAttribute('aria-hidden', 'false');
    modalBackdrop.classList.add('active');
    document.body.classList.add('modal-open');
    state.isOpen = true;

    // Registra como exibido SOMENTE após o modal estar efetivamente aberto
    markShown();

    // Checagem em segundo plano do PDF se ainda não feita
    if (!state.pdfStatusChecked) {
      checkPdfAvailability().then(updateDownloadButtonState);
    }

    // Foco acessível sem forçar rolagem na página (permanece sobre a primeira seção)
    setTimeout(() => {
      if (state.step === 'capture' && nameInput) {
        try {
          nameInput.focus({ preventScroll: true });
        } catch (e) {
          nameInput.focus();
        }
      } else if (closeBtn) {
        try {
          closeBtn.focus({ preventScroll: true });
        } catch (e) {
          closeBtn.focus();
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

    // Marca como fechado nesta sessão (evita reabertura automática na mesma visita)
    markDismissedSession();

    // Se nenhuma outra modal estiver aberta, restaura rolagem do body
    if (!isAnyOtherModalOpen()) {
      document.body.classList.remove('modal-open');
    }

    // Restaura o foco para o elemento disparador original
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
   * Altera a etapa visível dentro da modal ('capture' | 'confirmed')
   */
  function setStep(newStep) {
    state.step = newStep;
    if (captureStep && confirmedStep) {
      if (newStep === 'confirmed') {
        captureStep.style.display = 'none';
        confirmedStep.style.display = 'block';
        updateConfirmationButtons();
        setTimeout(() => {
          if (whatsappBtn) {
            try {
              whatsappBtn.focus({ preventScroll: true });
            } catch (e) {
              whatsappBtn.focus();
            }
          }
        }, 60);
      } else {
        captureStep.style.display = 'block';
        confirmedStep.style.display = 'none';
        if (nameInput) {
          try {
            nameInput.focus({ preventScroll: true });
          } catch (e) {
            nameInput.focus();
          }
        }
      }
    }
  }

  /**
   * Atualiza o estado visual do botão de download
   */
  function updateDownloadButtonState() {
    if (!downloadBtn) return;
    const config = getConfig();
    const pdfUrl = config.pdfUrl || './assets/rotina-matinal-7-minutos.pdf';

    downloadBtn.href = pdfUrl;
    downloadBtn.setAttribute('download', 'rotina-matinal-7-minutos.pdf');
    downloadBtn.classList.remove('disabled');
    downloadBtn.removeAttribute('aria-disabled');
    if (downloadNotice) {
      downloadNotice.style.display = 'none';
    }
  }

  /**
   * Atualiza os botões da tela de confirmação com link do WhatsApp e do PDF
   */
  function updateConfirmationButtons() {
    const config = getConfig();
    const cleanName = (state.firstName || 'Visitante').trim();

    // Mensagem exata solicitada:
    // “Olá, equipe do Espaço Ligia de Mayor! Meu nome é [NOME]. Vi o guia Rotina Matinal de 7 Minutos no site e gostaria de receber o material gratuito.”
    const text = `Olá, equipe do Espaço Ligia de Mayor! Meu nome é ${cleanName}. Vi o guia Rotina Matinal de 7 Minutos no site e gostaria de receber o material gratuito.`;
    const encodedText = encodeURIComponent(text);
    const waPhone = config.whatsappNumber || '5521997172737';
    const waUrl = `https://wa.me/${waPhone}?text=${encodedText}`;

    if (whatsappBtn) {
      whatsappBtn.href = waUrl;
    }

    updateDownloadButtonState();
  }

  /**
   * Validação e submissão do formulário de captação
   */
  function handleFormSubmit(e) {
    e.preventDefault();
    if (!nameInput) return;

    const rawName = nameInput.value.trim();
    // Validação básica do primeiro nome (mínimo 2 caracteres)
    if (!rawName || rawName.length < 2 || !/^[A-Za-zÀ-ÖØ-öø-ÿ\s'-]+$/.test(rawName)) {
      if (nameError) {
        nameError.style.display = 'block';
        nameError.textContent = 'Por favor, informe seu primeiro nome para continuarmos.';
      }
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return;
    }

    if (nameError) {
      nameError.style.display = 'none';
    }
    nameInput.removeAttribute('aria-invalid');

    // Captura apenas o primeiro nome em memória de execução
    const firstName = rawName.split(' ')[0];
    state.firstName = firstName;

    // Registra a conclusão da etapa de acesso (suspende por 30 dias)
    markConvertedLongTerm();

    // Avança para a etapa de confirmação
    setStep('confirmed');
  }

  /**
   * Observa fechamento de outros modais para reavaliar abertura se necessário
   */
  function watchOtherModalsForClosing() {
    const assessmentModal = document.getElementById('assessmentModal') || document.getElementById('bookingModal');
    const privateAreaModal = document.getElementById('privateAreaModal');

    function checkAndTrigger() {
      if (!state.isOpen && !isAnyOtherModalOpen() && canAutoOpen()) {
        setTimeout(() => {
          if (!state.isOpen && !isAnyOtherModalOpen() && canAutoOpen()) {
            openEbookModal(null);
          }
        }, 500);
      }
    }

    if (window.MutationObserver) {
      const observer = new MutationObserver(() => {
        checkAndTrigger();
      });

      if (assessmentModal) {
        observer.observe(assessmentModal, { attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
      }
      if (privateAreaModal) {
        observer.observe(privateAreaModal, { attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
      }
    }
  }

  /**
   * Agenda o disparo automático após o tempo especificado
   */
  function scheduleAutoOpen() {
    if (state.autoOpenAttempted) return;
    state.autoOpenAttempted = true;

    setTimeout(() => {
      // Se houver outro modal aberto no momento, inicia observação para disparar quando fechar
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
   * Inicialização dos elementos e eventos da campanha
   */
  function initEbookCampaign() {
    modalBackdrop = document.getElementById('ebookLeadModal');
    if (!modalBackdrop) return;

    modalCard = document.getElementById('ebookLeadCard');
    closeBtn = document.getElementById('closeEbookModal');
    dismissBtn = document.getElementById('btnDismissEbook');
    captureStep = document.getElementById('ebookStepCapture');
    confirmedStep = document.getElementById('ebookStepConfirmed');
    form = document.getElementById('ebookLeadForm');
    nameInput = document.getElementById('ebookUserName');
    nameError = document.getElementById('ebookNameError');
    whatsappBtn = document.getElementById('btnEbookWhatsApp');
    downloadBtn = document.getElementById('btnEbookDownload');
    downloadNotice = document.getElementById('ebookDownloadNotice');
    assessmentInviteBtn = document.getElementById('btnEbookToAssessment');

    // Estado inicial estritamente oculto no carregamento
    modalBackdrop.setAttribute('hidden', '');
    modalBackdrop.hidden = true;
    modalBackdrop.style.display = 'none';
    modalBackdrop.setAttribute('aria-hidden', 'true');

    // Submissão do formulário
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
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

    // Fechar ao clicar no backdrop (overlay)
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeEbookModal();
      }
    });

    // Tecla Escape para fechar
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.isOpen) {
        closeEbookModal();
      }
    });

    // Clique no botão de WhatsApp: abre em nova aba
    if (whatsappBtn) {
      whatsappBtn.addEventListener('click', () => {
        markConvertedLongTerm();
      });
    }

    // Clique no botão de download do PDF
    if (downloadBtn) {
      downloadBtn.addEventListener('click', (e) => {
        markConvertedLongTerm();
        if (!state.pdfAvailable) {
          e.preventDefault();
          if (downloadNotice) {
            downloadNotice.style.display = 'block';
            downloadNotice.textContent = 'O arquivo do guia em PDF está aguardando ativação no servidor estático. Por gentileza, solicite no WhatsApp da equipe no botão acima.';
          }
        }
      });
    }

    // Convite secundário: "Quero minha avaliação" fecha o popup do ebook e abre o questionário existente
    if (assessmentInviteBtn) {
      assessmentInviteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeEbookModal();
        if (typeof window.openAssessmentModal === 'function') {
          setTimeout(() => {
            window.openAssessmentModal('', assessmentInviteBtn);
          }, 100);
        }
      });
    }

    // Gatilhos manuais da seção permanente e links pelo site ([data-open-ebook])
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-ebook]');
      if (trigger) {
        e.preventDefault();
        // Abertura manual sempre permitida
        setStep('capture');
        if (nameInput) nameInput.value = '';
        if (nameError) nameError.style.display = 'none';
        openEbookModal(trigger);
      }
    });

    // Checagem em segundo plano da disponibilidade do PDF
    checkPdfAvailability().then(updateDownloadButtonState);

    // Dispara a rotina de abertura automática após ~1 segundo
    scheduleAutoOpen();
  }

  // Expor API global compartilhada
  window.openEbookModal = function (trigger = null) {
    setStep('capture');
    openEbookModal(trigger);
  };
  window.closeEbookModal = closeEbookModal;

  // Inicializa quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEbookCampaign);
  } else {
    initEbookCampaign();
  }
})();
