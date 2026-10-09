/**
 * ============================================================================
 * CAMPANHA DO GUIA GRATUITO: "ROTINA MATINAL DE 7 MINUTOS"
 * Espaço Lígia de Mayor - Fisioterapia e Pilates
 * ============================================================================
 * 
 * Regras de Negócio e Acessibilidade:
 * 1. Abertura automática ao carregar se nenhuma outra modal estiver ativa.
 * 2. Exibição única por sessão (sessionStorage).
 * 3. Se o visitante fechar ("Agora não" ou X ou ESC), não reabre automaticamente na mesma sessão.
 * 4. Se o visitante concluir o fluxo (clicar em baixar ou WhatsApp), suspende abertura por 30 dias (localStorage: ebook_lead_dismissed_until).
 * 5. Reabertura manual livre via botão da seção permanente ([data-open-ebook]).
 * 6. Validação do primeiro nome (mínimo 2 letras, sem persistência em disco ou logs).
 * 7. Tela de confirmação com 2 opções claras:
 *    - "Abrir WhatsApp e solicitar meu guia"
 *    - "Baixar o guia agora"
 *    - Convite secundário: "Quer um cuidado individualizado?" -> "Quero minha avaliação"
 * 8. Foco acessível com captura, restauração do gatilho anterior, fechar com ESC e aria-modal.
 * 9. Não abre simultaneamente com o modal de avaliação ou modal da área privada.
 * ============================================================================
 */

(function () {
  'use strict';

  // Chaves de controle de exibição
  const SESSION_SHOWN_KEY = 'elm_ebook_shown_session';
  const DISMISSED_UNTIL_KEY = 'elm_ebook_dismissed_until';

  // Estado interno da campanha
  const state = {
    isOpen: false,
    step: 'capture', // 'capture' | 'confirmed'
    firstName: '',
    lastActiveTrigger: null,
    pdfStatusChecked: false,
    pdfAvailable: false
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
   * Verifica se o PDF está acessível na URL configurada
   */
  async function checkPdfAvailability() {
    const config = getConfig();
    const targetUrl = config.pdfUrl || './assets/rotina-matinal-7-minutos.pdf';
    try {
      const response = await fetch(targetUrl, { method: 'HEAD' });
      const contentType = response.headers.get('content-type') || '';
      // Se retornar 200 e não for página HTML 404
      if (response.ok && !contentType.includes('text/html')) {
        state.pdfAvailable = true;
      } else {
        state.pdfAvailable = false;
      }
    } catch (e) {
      state.pdfAvailable = false;
    }
    state.pdfStatusChecked = true;
  }

  /**
   * Checa se outra modal já está aberta na página
   */
  function isAnyOtherModalOpen() {
    // 1. Questionário de avaliação
    const assessmentModal = document.getElementById('assessmentModal') || document.getElementById('bookingModal');
    if (assessmentModal && (assessmentModal.classList.contains('active') || assessmentModal.style.display === 'flex' || assessmentModal.getAttribute('aria-hidden') === 'false')) {
      return true;
    }

    // 2. Área privada de profissionais
    const privateAreaModal = document.getElementById('privateAreaModal');
    if (privateAreaModal && (privateAreaModal.classList.contains('active') || privateAreaModal.style.display === 'flex' || privateAreaModal.getAttribute('aria-hidden') === 'false')) {
      return true;
    }

    return false;
  }

  /**
   * Verifica se a abertura automática está permitida
   */
  function canAutoOpen() {
    try {
      // 1. Se já foi exibido nesta sessão
      if (sessionStorage.getItem(SESSION_SHOWN_KEY) === 'true') {
        return false;
      }

      // 2. Se o visitante concluiu o fluxo nos últimos 30 dias
      const dismissedUntil = localStorage.getItem(DISMISSED_UNTIL_KEY);
      if (dismissedUntil) {
        const timestamp = parseInt(dismissedUntil, 10);
        if (Number.isFinite(timestamp) && Date.now() < timestamp) {
          return false;
        }
      }

      // 3. Se outra modal estiver aberta
      if (isAnyOtherModalOpen()) {
        return false;
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Marca como exibido na sessão atual
   */
  function markShownInSession() {
    try {
      sessionStorage.setItem(SESSION_SHOWN_KEY, 'true');
    } catch (e) {}
  }

  /**
   * Suspende a abertura automática por 30 dias após conversão
   */
  function markDismissedLongTerm() {
    try {
      const config = getConfig();
      const days = config.autoOpenDismissDays || 30;
      const expireTime = Date.now() + (days * 24 * 60 * 60 * 1000);
      localStorage.setItem(DISMISSED_UNTIL_KEY, expireTime.toString());
      sessionStorage.setItem(SESSION_SHOWN_KEY, 'true');
    } catch (e) {}
  }

  /**
   * Abre o popup do Ebook
   */
  function openEbookModal(triggerElement = null) {
    if (!modalBackdrop) return;

    // Se outra modal estiver aberta, não abre
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

    // Exibe a modal
    modalBackdrop.removeAttribute('hidden');
    modalBackdrop.hidden = false;
    modalBackdrop.style.display = 'flex';
    modalBackdrop.setAttribute('aria-hidden', 'false');
    modalBackdrop.classList.add('active');
    document.body.classList.add('modal-open');
    state.isOpen = true;

    // Marca como exibido na sessão
    markShownInSession();

    // Se ainda não verificou o status do PDF, faz a checagem em segundo plano
    if (!state.pdfStatusChecked) {
      checkPdfAvailability().then(updateDownloadButtonState);
    }

    // Foco acessível no primeiro input ou fechar
    setTimeout(() => {
      if (state.step === 'capture' && nameInput) {
        nameInput.focus();
      } else if (closeBtn) {
        closeBtn.focus();
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

    // Se nenhuma outra modal estiver aberta, remove lock de rolagem
    if (!isAnyOtherModalOpen()) {
      document.body.classList.remove('modal-open');
    }

    // Restaura o foco para o elemento disparador
    if (state.lastActiveTrigger && typeof state.lastActiveTrigger.focus === 'function') {
      try {
        state.lastActiveTrigger.focus();
      } catch (e) {}
    }
  }

  /**
   * Altera a etapa visível dentro da modal
   */
  function setStep(newStep) {
    state.step = newStep;
    if (captureStep && confirmedStep) {
      if (newStep === 'confirmed') {
        captureStep.style.display = 'none';
        confirmedStep.style.display = 'block';
        updateConfirmationButtons();
        setTimeout(() => {
          if (whatsappBtn) whatsappBtn.focus();
        }, 60);
      } else {
        captureStep.style.display = 'block';
        confirmedStep.style.display = 'none';
        if (nameInput) nameInput.focus();
      }
    }
  }

  /**
   * Atualiza o estado visual do botão de download de acordo com a disponibilidade real do PDF
   */
  function updateDownloadButtonState() {
    if (!downloadBtn || !downloadNotice) return;
    const config = getConfig();
    const pdfUrl = config.pdfUrl || './assets/rotina-matinal-7-minutos.pdf';

    if (state.pdfAvailable) {
      downloadBtn.href = pdfUrl;
      downloadBtn.setAttribute('download', 'rotina-matinal-7-minutos.pdf');
      downloadBtn.classList.remove('disabled');
      downloadBtn.removeAttribute('aria-disabled');
      downloadNotice.style.display = 'none';
    } else {
      // Se não estiver disponível no servidor local, desativa o download direto e orienta WhatsApp
      downloadBtn.removeAttribute('download');
      downloadBtn.href = '#indisponivel';
      downloadBtn.classList.add('disabled');
      downloadBtn.setAttribute('aria-disabled', 'true');
      downloadNotice.style.display = 'block';
      downloadNotice.textContent = 'O download direto do PDF aguarda ativação de hospedagem. Utilize a opção acima para receber o arquivo completo diretamente pelo WhatsApp da equipe.';
    }
  }

  /**
   * Atualiza os botões da tela de confirmação com o link dinâmico do WhatsApp e download
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
    // Validação básica do primeiro nome (pelo menos 2 caracteres alfabéticos)
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

    // Suspende a abertura automática por 30 dias após o usuário avançar
    markDismissedLongTerm();

    // Avança para a tela de confirmação
    setStep('confirmed');
  }

  /**
   * Inicialização dos eventos do modal e da seção permanente
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

    // Estado inicial estritamente oculto
    modalBackdrop.setAttribute('hidden', '');
    modalBackdrop.hidden = true;
    modalBackdrop.style.display = 'none';
    modalBackdrop.setAttribute('aria-hidden', 'true');

    // Submissão do formulário
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }

    // Botão de fechar (X)
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

    // Fechar ao clicar fora no backdrop
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
        markDismissedLongTerm();
      });
    }

    // Clique no botão de download do PDF
    if (downloadBtn) {
      downloadBtn.addEventListener('click', (e) => {
        markDismissedLongTerm();
        if (!state.pdfAvailable) {
          e.preventDefault();
          alert('O arquivo do guia em PDF está aguardando publicação na hospedagem estática. Por gentileza, solicite diretamente pelo WhatsApp da equipe no botão acima.');
        }
      });
    }

    // Convite secundário: "Quero minha avaliação" fecha o popup do ebook e abre o questionário
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

    // Gatilhos da seção permanente e links pelo site ([data-open-ebook])
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-ebook]');
      if (trigger) {
        e.preventDefault();
        // Permite reabrir a qualquer momento, resetando para o passo inicial
        setStep('capture');
        if (nameInput) nameInput.value = '';
        if (nameError) nameError.style.display = 'none';
        openEbookModal(trigger);
      }
    });

    // Checagem de disponibilidade do PDF
    checkPdfAvailability().then(updateDownloadButtonState);

    // Abertura automática ao carregar a página
    if (canAutoOpen()) {
      // Pequeno timeout suave para garantir que layout e fontes estejam estáveis
      setTimeout(() => {
        if (canAutoOpen() && !state.isOpen) {
          openEbookModal(null);
        }
      }, 800);
    }
  }

  // Expor API global
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
