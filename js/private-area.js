/**
 * ============================================================================
 * ESPAÇO LIGIA DE MAYOR - ÁREA PRIVADA DOS PROFISSIONAIS
 * ============================================================================
 * Integração completa com Supabase (Auth, PostgreSQL com Restrição de Exclusão,
 * RLS e Realtime) para reserva de salas e estúdios.
 * 
 * Regras principais:
 * - Apenas profissionais ativos autorizados pela administração
 * - Sem cadastro público (somente login e recuperação de senha)
 * - Perfis: Administrador ('admin') e Profissional ('professional')
 * - Fuso horário oficial: America/Sao_Paulo
 * - Disponibilidade pública de terceiros exibida apenas como "Indisponível"
 *   sem expor nomes de profissionais ou pacientes
 * - Proteção atômica de concorrência com tratamento do erro 23P01:
 *   "Este horário acabou de ser reservado. Escolha outro horário."
 * - Atualização em tempo real via Supabase Realtime Channels
 * ============================================================================
 */

(function () {
  'use strict';

  // Fuso oficial da clínica
  const TIMEZONE = 'America/Sao_Paulo';

  // Estado da aplicação da Área Privada
  const state = {
    supabaseClient: null,
    session: null,
    profile: null, // { id, full_name, role, is_active }
    spaces: [],
    selectedSpaceId: null,
    selectedDate: getTodayDateStringSP(),
    availabilitySlots: [],
    myReservations: [],
    adminBlocks: [],
    realtimeChannel: null,
    realtimeStatus: 'disconnected', // 'connected', 'connecting', 'disconnected', 'error'
    currentTab: 'schedule', // 'schedule', 'my_reservations', 'admin_blocks'
    isLoading: false,
    lastActiveTrigger: null
  };

  // --------------------------------------------------------------------------
  // UTILITÁRIOS DE DATA E HORA (AMERICA/SAO_PAULO)
  // --------------------------------------------------------------------------

  function getTodayDateStringSP() {
    try {
      const now = new Date();
      // Formata a data atual no fuso de São Paulo: YYYY-MM-DD
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return formatter.format(now);
    } catch (e) {
      return new Date().toISOString().split('T')[0];
    }
  }

  function formatDateFriendly(dateStr) {
    if (!dateStr) return '';
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(year, month - 1, day, 12, 0, 0);
      const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(d);
      const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
      return `${capitalize(weekday)}, ${dayMonth}`;
    } catch (e) {
      return dateStr;
    }
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function formatTimeSP(isoString) {
    if (!isoString) return '--:--';
    try {
      const d = new Date(isoString);
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(d);
    } catch (e) {
      return '--:--';
    }
  }

  function getDayOfWeek(dateStr) {
    if (!dateStr) return 1;
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d, 12, 0, 0);
    return date.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  }

  function getOperatingHoursForDate(dateStr) {
    const dow = getDayOfWeek(dateStr);
    if (dow === 0) {
      return { isOpen: false, startHour: 0, endHour: 0, label: 'Fechado aos domingos' };
    }
    if (dow === 6) {
      return { isOpen: true, startHour: 7, endHour: 14, label: 'Sábado: 07:00 às 14:00' };
    }
    return { isOpen: true, startHour: 7, endHour: 21, label: 'Segunda a Sexta: 07:00 às 21:00' };
  }

  function buildIsoStringSP(dateStr, timeStr) {
    // Converte YYYY-MM-DD e HH:MM para timestamptz ISO considerando o offset de São Paulo
    // O fuso padrão de Brasília (America/Sao_Paulo) é UTC-03:00 (sem horário de verão atual)
    return `${dateStr}T${timeStr}:00-03:00`;
  }

  // --------------------------------------------------------------------------
  // INICIALIZAÇÃO DO CLIENTE SUPABASE
  // --------------------------------------------------------------------------

  function getSupabaseClient() {
    if (state.supabaseClient) return state.supabaseClient;

    if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
      console.warn('[Espaço Ligia] SDK do Supabase não detectado globalmente.');
      return null;
    }

    const config = window.SUPABASE_CONFIG;
    if (!config || !config.isConfigured()) {
      return null;
    }

    try {
      state.supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      return state.supabaseClient;
    } catch (err) {
      console.error('[Espaço Ligia] Erro ao instanciar cliente Supabase:', err);
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // GERENCIAMENTO DO MODAL DA ÁREA PRIVADA
  // --------------------------------------------------------------------------

  function openPrivateArea(triggerElement = null) {
    const modal = document.getElementById('privateAreaModal');
    if (!modal) return;

    if (triggerElement) {
      state.lastActiveTrigger = triggerElement;
    } else if (document.activeElement && document.activeElement !== document.body) {
      state.lastActiveTrigger = document.activeElement;
    }

    modal.removeAttribute('hidden');
    modal.hidden = false;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('active');
    document.body.classList.add('modal-open');

    // Inicializa ou sincroniza a sessão
    checkAuthAndInit();
  }

  function closePrivateArea() {
    const modal = document.getElementById('privateAreaModal');
    if (!modal) return;

    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('hidden', '');
    modal.hidden = true;
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');

    // Desconecta canal realtime para economizar recursos enquanto fechado
    unsubscribeRealtime();

    if (state.lastActiveTrigger && typeof state.lastActiveTrigger.focus === 'function') {
      try {
        state.lastActiveTrigger.focus();
      } catch (e) {}
    }
  }

  // --------------------------------------------------------------------------
  // FLUXO DE AUTENTICAÇÃO E PERFIL
  // --------------------------------------------------------------------------

  async function checkAuthAndInit() {
    const client = getSupabaseClient();
    
    // Se o Supabase ainda não está configurado com as chaves reais
    if (!client) {
      showPanel('panelConfigHelp');
      return;
    }

    setLoading(true);
    try {
      const { data: { session }, error } = await client.auth.getSession();
      if (error || !session) {
        state.session = null;
        state.profile = null;
        showPanel('panelLogin');
      } else {
        state.session = session;
        const valid = await fetchUserProfile(session.user.id);
        if (valid) {
          showPanel('panelDashboard');
          await loadSpaces();
          await refreshSchedule();
          setupRealtime();
        } else {
          // Usuário autenticado mas sem perfil ativo autorizado
          await client.auth.signOut();
          state.session = null;
          state.profile = null;
          showPanel('panelLogin');
          showAuthError('Acesso restrito: seu cadastro de profissional precisa ser ativado pela administração do Espaço Ligia de Mayor.');
        }
      }
    } catch (err) {
      console.error('[Espaço Ligia] Falha ao verificar autenticação:', err);
      showPanel('panelLogin');
    } finally {
      setLoading(false);
    }
  }

  async function fetchUserProfile(userId) {
    const client = getSupabaseClient();
    if (!client) return false;

    try {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, role, is_active, phone')
        .eq('id', userId)
        .single();

      if (error || !data) {
        console.warn('[Espaço Ligia] Perfil não encontrado para o usuário:', error);
        return false;
      }

      if (!data.is_active) {
        console.warn('[Espaço Ligia] Profissional inativo no cadastro.');
        return false;
      }

      state.profile = data;
      renderUserHeader();
      return true;
    } catch (err) {
      console.error('[Espaço Ligia] Erro ao buscar perfil:', err);
      return false;
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    const errorEl = document.getElementById('loginErrorMsg');

    if (errorEl) errorEl.style.display = 'none';

    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!email || !password) {
      showAuthError('Por favor, preencha seu e-mail e senha cadastrados.');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showPanel('panelConfigHelp');
      return;
    }

    setLoading(true, 'Entrando na Área dos Profissionais...');
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        let msg = 'E-mail ou senha incorretos. Confira suas credenciais.';
        if (error.message && error.message.includes('Invalid login credentials')) {
          msg = 'Credenciais não encontradas ou senha incorreta. Contate a administração se ainda não tiver cadastro.';
        } else if (error.message && error.message.includes('Email not confirmed')) {
          msg = 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.';
        }
        showAuthError(msg);
        return;
      }

      state.session = data.session;
      const valid = await fetchUserProfile(data.user.id);
      if (valid) {
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
        showPanel('panelDashboard');
        await loadSpaces();
        await refreshSchedule();
        setupRealtime();
      } else {
        await client.auth.signOut();
        showAuthError('Acesso não autorizado: seu cadastro de profissional precisa ser ativado pela administração do Espaço Ligia de Mayor.');
      }
    } catch (err) {
      console.error('[Espaço Ligia] Erro no login:', err);
      showAuthError('Ocorreu um erro ao conectar. Verifique sua conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
    unsubscribeRealtime();
    state.session = null;
    state.profile = null;
    state.spaces = [];
    state.availabilitySlots = [];
    state.myReservations = [];
    showPanel('panelLogin');
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    const emailInput = document.getElementById('resetEmailInput');
    const msgEl = document.getElementById('resetMsg');
    const email = emailInput ? emailInput.value.trim() : '';

    if (!email) {
      if (msgEl) {
        msgEl.className = 'pa-alert pa-alert-error';
        msgEl.textContent = 'Informe seu e-mail cadastrado.';
        msgEl.style.display = 'block';
      }
      return;
    }

    const client = getSupabaseClient();
    if (!client) return;

    setLoading(true, 'Enviando instruções de recuperação...');
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });

      if (msgEl) {
        msgEl.style.display = 'block';
        if (error) {
          msgEl.className = 'pa-alert pa-alert-error';
          msgEl.textContent = 'Não foi possível enviar o e-mail: ' + (error.message || 'tente novamente.');
        } else {
          msgEl.className = 'pa-alert pa-alert-success';
          msgEl.textContent = 'Se o e-mail estiver cadastrado, você receberá um link seguro para redefinir sua senha em instantes.';
          if (emailInput) emailInput.value = '';
        }
      }
    } catch (err) {
      console.error('[Espaço Ligia] Erro no reset de senha:', err);
    } finally {
      setLoading(false);
    }
  }

  function showAuthError(msg) {
    const errorEl = document.getElementById('loginErrorMsg');
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
    }
  }

  // --------------------------------------------------------------------------
  // CARREGAMENTO DE ESPAÇOS E DISPONIBILIDADE
  // --------------------------------------------------------------------------

  async function loadSpaces() {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const { data, error } = await client
        .from('spaces')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) {
        console.error('[Espaço Ligia] Erro ao carregar espaços:', error);
        return;
      }

      state.spaces = data || [];
      if (state.spaces.length > 0 && !state.selectedSpaceId) {
        state.selectedSpaceId = state.spaces[0].id;
      }

      renderSpacesSelector();
    } catch (err) {
      console.error('[Espaço Ligia] Falha ao carregar espaços:', err);
    }
  }

  async function refreshSchedule() {
    if (!state.selectedSpaceId || !state.selectedDate) return;
    const client = getSupabaseClient();
    if (!client) return;

    const opHours = getOperatingHoursForDate(state.selectedDate);
    const container = document.getElementById('scheduleSlotsContainer');
    const headerInfo = document.getElementById('scheduleDateHeaderInfo');

    if (headerInfo) {
      headerInfo.textContent = formatDateFriendly(state.selectedDate);
    }

    const operatingBadge = document.getElementById('operatingHoursBadge');
    if (operatingBadge) {
      operatingBadge.textContent = opHours.label;
      operatingBadge.className = opHours.isOpen ? 'pa-badge pa-badge-teal' : 'pa-badge pa-badge-closed';
    }

    if (!opHours.isOpen) {
      if (container) {
        container.innerHTML = `
          <div class="pa-empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
            </svg>
            <h4>Espaço fechado aos domingos</h4>
            <p>O Espaço Ligia de Mayor não realiza atendimentos nem locações aos domingos. Selecione outro dia.</p>
          </div>
        `;
      }
      return;
    }

    if (container) {
      container.innerHTML = `
        <div class="pa-loading-indicator">
          <div class="pa-spinner"></div>
          <span>Consultando disponibilidade com segurança...</span>
        </div>
      `;
    }

    try {
      // Chama a função SQL get_space_availability(p_space_id, p_date)
      // Esta função é uma SECURITY DEFINER que mascara horários ocupados como "busy"
      // sem jamais vazar quem reservou ou detalhes de pacientes
      const { data, error } = await client.rpc('get_space_availability', {
        p_space_id: state.selectedSpaceId,
        p_date: state.selectedDate
      });

      if (error) {
        console.error('[Espaço Ligia] Erro RPC get_space_availability:', error);
        if (container) {
          container.innerHTML = `
            <div class="pa-alert pa-alert-error">
              Não foi possível carregar a disponibilidade: ${error.message}
            </div>
          `;
        }
        return;
      }

      state.availabilitySlots = data || [];
      renderScheduleList();
    } catch (err) {
      console.error('[Espaço Ligia] Falha ao atualizar horários:', err);
      if (container) {
        container.innerHTML = `
          <div class="pa-alert pa-alert-error">
            Falha na conexão com a agenda. Verifique sua internet e clique em Atualizar.
          </div>
        `;
      }
    }
  }

  // --------------------------------------------------------------------------
  // RENDERIZAÇÃO DA AGENDA (MOBILE-FIRST - LISTA VERTICAL POR DIA)
  // --------------------------------------------------------------------------

  function renderScheduleList() {
    const container = document.getElementById('scheduleSlotsContainer');
    if (!container) return;

    const opHours = getOperatingHoursForDate(state.selectedDate);
    if (!opHours.isOpen) return;

    const currentSpace = state.spaces.find(s => s.id === state.selectedSpaceId);
    const spaceName = currentSpace ? currentSpace.name : 'Espaço selecionado';

    // Monta a grade contínua de horários do dia de 1 em 1 hora (07h às 21h ou 14h)
    const slots = [];
    for (let h = opHours.startHour; h < opHours.endHour; h++) {
      const startH = String(h).padStart(2, '0') + ':00';
      const endH = String(h + 1).padStart(2, '0') + ':00';
      const startIso = buildIsoStringSP(state.selectedDate, startH);
      const endIso = buildIsoStringSP(state.selectedDate, endH);

      // Checa colisão com reservas existentes retornadas pelo get_space_availability
      const matching = state.availabilitySlots.find(slot => {
        const slotStart = new Date(slot.start_time).getTime();
        const slotEnd = new Date(slot.end_time).getTime();
        const myStart = new Date(startIso).getTime();
        const myEnd = new Date(endIso).getTime();
        // Sobreposição de intervalos [start, end)
        return slotStart < myEnd && slotEnd > myStart;
      });

      let status = 'free'; // 'free', 'mine', 'busy', 'blocked', 'past'
      let isMine = false;

      // Verifica se o horário já passou hoje
      const now = new Date();
      if (new Date(endIso) < now) {
        status = 'past';
      } else if (matching) {
        if (matching.slot_status === 'blocked') {
          status = 'blocked';
        } else if (matching.is_mine) {
          status = 'mine';
          isMine = true;
        } else {
          status = 'busy';
        }
      }

      slots.push({
        startH,
        endH,
        startIso,
        endIso,
        status,
        isMine,
        rawSlot: matching
      });
    }

    if (slots.length === 0) {
      container.innerHTML = `
        <div class="pa-empty-state">
          <p>Nenhum horário configurado para este dia.</p>
        </div>
      `;
      return;
    }

    let html = `
      <div class="pa-schedule-day-summary">
        <div class="pa-schedule-day-title">
          <strong>${escapeHtml(spaceName)}</strong> · ${formatDateFriendly(state.selectedDate)}
        </div>
        <div class="pa-schedule-legend">
          <span class="pa-legend-item"><span class="pa-legend-dot pa-dot-free"></span> Livre</span>
          <span class="pa-legend-item"><span class="pa-legend-dot pa-dot-mine"></span> Sua Reserva</span>
          <span class="pa-legend-item"><span class="pa-legend-dot pa-dot-busy"></span> Indisponível</span>
          <span class="pa-legend-item"><span class="pa-legend-dot pa-dot-blocked"></span> Bloqueado</span>
        </div>
      </div>
      <div class="pa-slots-vertical-list">
    `;

    slots.forEach(slot => {
      let statusBadge = '';
      let actionBtn = '';

      if (slot.status === 'free') {
        statusBadge = `<span class="pa-slot-badge pa-slot-free">Disponível</span>`;
        actionBtn = `
          <button type="button" class="pa-btn pa-btn-sm pa-btn-reserve" data-start="${slot.startH}" data-end="${slot.endH}">
            Reservar
          </button>
        `;
      } else if (slot.status === 'mine') {
        statusBadge = `<span class="pa-slot-badge pa-slot-mine">Sua Reserva</span>`;
        actionBtn = `
          <button type="button" class="pa-btn pa-btn-sm pa-btn-cancel-quick" data-time="${slot.startH}">
            Sua Reserva
          </button>
        `;
      } else if (slot.status === 'busy') {
        // SEGURANÇA E PRIVACIDADE: Mostra estritamente como "Indisponível",
        // sem expor dados pessoais de colegas ou pacientes
        statusBadge = `<span class="pa-slot-badge pa-slot-busy">Indisponível</span>`;
        actionBtn = `<span class="pa-slot-na">Ocupado</span>`;
      } else if (slot.status === 'blocked') {
        statusBadge = `<span class="pa-slot-badge pa-slot-blocked">Bloqueado</span>`;
        actionBtn = `<span class="pa-slot-na">Manutenção</span>`;
      } else if (slot.status === 'past') {
        statusBadge = `<span class="pa-slot-badge pa-slot-past">Encerrado</span>`;
        actionBtn = `<span class="pa-slot-na">-</span>`;
      }

      html += `
        <div class="pa-slot-card pa-slot-status-${slot.status}">
          <div class="pa-slot-time-col">
            <span class="pa-slot-hours">${slot.startH} - ${slot.endH}</span>
            <span class="pa-slot-duration">1 hora</span>
          </div>
          <div class="pa-slot-status-col">
            ${statusBadge}
          </div>
          <div class="pa-slot-action-col">
            ${actionBtn}
          </div>
        </div>
      `;
    });

    html += `
      </div>
      <div class="pa-custom-booking-cta">
        <button type="button" class="pa-btn pa-btn-secondary" id="btnOpenCustomBooking">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>Reservar Horário com Duração Personalizada</span>
        </button>
      </div>
    `;

    container.innerHTML = html;

    // Conecta botões de reserva rápida
    container.querySelectorAll('.pa-btn-reserve').forEach(btn => {
      btn.addEventListener('click', () => {
        const start = btn.getAttribute('data-start');
        const end = btn.getAttribute('data-end');
        openBookingModal(start, end);
      });
    });

    // Conecta botão de duração personalizada
    const customBtn = container.querySelector('#btnOpenCustomBooking');
    if (customBtn) {
      customBtn.addEventListener('click', () => {
        openBookingModal();
      });
    }

    // Botões que levam à aba Minhas Reservas
    container.querySelectorAll('.pa-btn-cancel-quick').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab('my_reservations');
      });
    });
  }

  // --------------------------------------------------------------------------
  // CRIAÇÃO DE RESERVA COM PROTEÇÃO ATÔMICA POSTGRESQL CONTRA CONFLITOS
  // --------------------------------------------------------------------------

  function openBookingModal(defaultStart = '', defaultEnd = '') {
    const modal = document.getElementById('bookingModalDrawer');
    if (!modal) return;

    const spaceSelect = document.getElementById('bookingSpaceSelect');
    const dateInput = document.getElementById('bookingDateInput');
    const startSelect = document.getElementById('bookingStartTime');
    const endSelect = document.getElementById('bookingEndTime');
    const notesInput = document.getElementById('bookingNotes');
    const errorAlert = document.getElementById('bookingErrorAlert');

    if (errorAlert) {
      errorAlert.style.display = 'none';
      errorAlert.textContent = '';
    }

    // Preenche espaços no select
    if (spaceSelect) {
      spaceSelect.innerHTML = state.spaces.map(s => 
        `<option value="${s.id}" ${s.id === state.selectedSpaceId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
      ).join('');
    }

    if (dateInput) {
      dateInput.value = state.selectedDate;
      dateInput.min = getTodayDateStringSP();
    }

    // Popula horários possíveis (07:00 às 21:00 em intervalos de 30min)
    populateTimeOptions(startSelect, endSelect, defaultStart, defaultEnd);

    if (notesInput) {
      notesInput.value = '';
    }

    modal.removeAttribute('hidden');
    modal.hidden = false;
    modal.style.display = 'flex';
    modal.classList.add('active');
  }

  function closeBookingModal() {
    const modal = document.getElementById('bookingModalDrawer');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('hidden', '');
    modal.hidden = true;
    modal.style.display = 'none';
  }

  function populateTimeOptions(startEl, endEl, defStart = '', defEnd = '') {
    if (!startEl || !endEl) return;

    const op = getOperatingHoursForDate(state.selectedDate);
    const times = [];
    for (let h = op.startHour; h <= op.endHour; h++) {
      times.push(String(h).padStart(2, '0') + ':00');
      if (h < op.endHour) {
        times.push(String(h).padStart(2, '0') + ':30');
      }
    }

    startEl.innerHTML = times.slice(0, -1).map(t => 
      `<option value="${t}" ${t === defStart ? 'selected' : ''}>${t}</option>`
    ).join('');

    endEl.innerHTML = times.slice(1).map(t => 
      `<option value="${t}" ${t === defEnd ? 'selected' : ''}>${t}</option>`
    ).join('');

    // Se defEnd não fornecido, define 1h após o início
    if (!defEnd && defStart) {
      const idx = times.indexOf(defStart);
      if (idx !== -1 && idx + 2 < times.length) {
        endEl.value = times[idx + 2];
      }
    }
  }

  async function handleConfirmBooking(e) {
    e.preventDefault();
    const spaceId = document.getElementById('bookingSpaceSelect')?.value;
    const dateStr = document.getElementById('bookingDateInput')?.value;
    const startTimeStr = document.getElementById('bookingStartTime')?.value;
    const endTimeStr = document.getElementById('bookingEndTime')?.value;
    const notes = document.getElementById('bookingNotes')?.value.trim();
    const errorAlert = document.getElementById('bookingErrorAlert');

    if (errorAlert) errorAlert.style.display = 'none';

    if (!spaceId || !dateStr || !startTimeStr || !endTimeStr) {
      showBookingError('Por favor, informe o espaço, a data e os horários de início e término.');
      return;
    }

    if (startTimeStr >= endTimeStr) {
      showBookingError('O horário de término deve ser posterior ao horário de início.');
      return;
    }

    const startIso = buildIsoStringSP(dateStr, startTimeStr);
    const endIso = buildIsoStringSP(dateStr, endTimeStr);

    const client = getSupabaseClient();
    if (!client || !state.session) {
      showBookingError('Sessão expirada. Faça login novamente.');
      return;
    }

    setLoading(true, 'Confirmando reserva com proteção atômica...');
    try {
      const { data, error } = await client
        .from('reservations')
        .insert({
          space_id: spaceId,
          professional_id: state.session.user.id,
          start_time: startIso,
          end_time: endIso,
          notes: notes || null,
          status: 'confirmed'
        })
        .select()
        .single();

      if (error) {
        console.error('[Espaço Ligia] Erro ao criar reserva:', error);
        
        // MENSAGEM OBRIGATÓRIA DA ESPECIFICAÇÃO PARA CONFLITOS DE CONCORRÊNCIA:
        // "Este horário acabou de ser reservado. Escolha outro horário."
        const isConflict = 
          error.code === '23P01' || // exclusion_violation
          error.code === '23505' || // unique_violation
          (error.message && (
            error.message.includes('no_overlapping_reservations') ||
            error.message.includes('conflicts with existing') ||
            error.message.includes('bloqueio administrativo') ||
            error.message.includes('sobreposição')
          ));

        if (isConflict) {
          showBookingError('Este horário acabou de ser reservado. Escolha outro horário.');
        } else if (error.message && error.message.includes('domingos')) {
          showBookingError('O Espaço Ligia de Mayor não funciona aos domingos.');
        } else if (error.message && error.message.includes('sábados')) {
          showBookingError('Aos sábados, o horário de funcionamento é das 07:00 às 14:00.');
        } else if (error.message && error.message.includes('horários passados')) {
          showBookingError('Não é permitido criar reservas para horários passados.');
        } else {
          showBookingError('Não foi possível confirmar: ' + (error.message || 'tente novamente.'));
        }
        return;
      }

      // Sucesso na reserva
      closeBookingModal();
      showToast('Reserva confirmada com sucesso!');
      await refreshSchedule();
      await loadMyReservations();
    } catch (err) {
      console.error('[Espaço Ligia] Exceção ao reservar:', err);
      showBookingError('Erro de conexão ao confirmar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  function showBookingError(msg) {
    const errorAlert = document.getElementById('bookingErrorAlert');
    if (errorAlert) {
      errorAlert.textContent = msg;
      errorAlert.style.display = 'block';
    }
  }

  // --------------------------------------------------------------------------
  // MINHAS RESERVAS E CANCELAMENTO
  // --------------------------------------------------------------------------

  async function loadMyReservations() {
    const client = getSupabaseClient();
    if (!client || !state.session) return;

    const listEl = document.getElementById('myReservationsList');
    if (listEl) {
      listEl.innerHTML = `
        <div class="pa-loading-indicator">
          <div class="pa-spinner"></div>
          <span>Carregando suas reservas...</span>
        </div>
      `;
    }

    try {
      const { data, error } = await client
        .from('reservations')
        .select(`
          id,
          space_id,
          start_time,
          end_time,
          status,
          notes,
          created_at,
          spaces (name)
        `)
        .eq('professional_id', state.session.user.id)
        .order('start_time', { ascending: false });

      if (error) {
        console.error('[Espaço Ligia] Erro ao buscar reservas do profissional:', error);
        if (listEl) {
          listEl.innerHTML = `<div class="pa-alert pa-alert-error">Erro ao carregar reservas: ${error.message}</div>`;
        }
        return;
      }

      state.myReservations = data || [];
      renderMyReservations();
    } catch (err) {
      console.error('[Espaço Ligia] Falha ao listar reservas:', err);
    }
  }

  function renderMyReservations() {
    const listEl = document.getElementById('myReservationsList');
    if (!listEl) return;

    if (state.myReservations.length === 0) {
      listEl.innerHTML = `
        <div class="pa-empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <h4>Nenhuma reserva encontrada</h4>
          <p>Você ainda não realizou agendamentos de espaços. Use a aba "Agenda" para reservar um horário.</p>
        </div>
      `;
      return;
    }

    const now = new Date();
    let html = '<div class="pa-reservations-cards-col">';

    state.myReservations.forEach(r => {
      const startD = new Date(r.start_time);
      const isPast = startD < now;
      const isConfirmed = r.status === 'confirmed';
      const spaceName = r.spaces ? r.spaces.name : 'Espaço';
      const dateFormatted = new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIMEZONE,
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).format(startD);

      const startH = formatTimeSP(r.start_time);
      const endH = formatTimeSP(r.end_time);

      let statusBadge = '';
      if (!isConfirmed) {
        statusBadge = `<span class="pa-badge pa-badge-cancelled">Cancelada</span>`;
      } else if (isPast) {
        statusBadge = `<span class="pa-badge pa-badge-past">Concluída</span>`;
      } else {
        statusBadge = `<span class="pa-badge pa-badge-confirmed">Confirmada</span>`;
      }

      let cancelAction = '';
      if (isConfirmed && !isPast) {
        cancelAction = `
          <button type="button" class="pa-btn pa-btn-danger-outline pa-btn-sm btn-cancel-res" data-id="${r.id}">
            Cancelar Reserva
          </button>
        `;
      }

      html += `
        <div class="pa-reservation-card ${!isConfirmed ? 'pa-res-cancelled' : ''}">
          <div class="pa-res-top-row">
            <span class="pa-res-space">${escapeHtml(spaceName)}</span>
            ${statusBadge}
          </div>
          <div class="pa-res-datetime">
            <span class="pa-res-date">${dateFormatted}</span>
            <span class="pa-res-time">${startH} às ${endH}</span>
          </div>
          ${r.notes ? `<div class="pa-res-notes">Obs: ${escapeHtml(r.notes)}</div>` : ''}
          <div class="pa-res-footer">
            ${cancelAction}
          </div>
        </div>
      `;
    });

    html += '</div>';
    listEl.innerHTML = html;

    // Listeners nos botões de cancelamento
    listEl.querySelectorAll('.btn-cancel-res').forEach(btn => {
      btn.addEventListener('click', async () => {
        const resId = btn.getAttribute('data-id');
        await promptCancelReservation(resId);
      });
    });
  }

  async function promptCancelReservation(reservationId) {
    const ok = window.confirm('Deseja realmente cancelar esta reserva? O horário será liberado imediatamente para outros colegas.');
    if (!ok) return;

    const client = getSupabaseClient();
    if (!client) return;

    setLoading(true, 'Cancelando reserva...');
    try {
      const { error } = await client
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('id', reservationId);

      if (error) {
        alert('Não foi possível cancelar: ' + error.message);
        return;
      }

      showToast('Reserva cancelada com sucesso!');
      await loadMyReservations();
      await refreshSchedule();
    } catch (err) {
      console.error('[Espaço Ligia] Falha ao cancelar reserva:', err);
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------------------------------
  // SUPABASE REALTIME: SINCRONIZAÇÃO INSTANTÂNEA E INDICADOR VISUAL
  // --------------------------------------------------------------------------

  function setupRealtime() {
    const client = getSupabaseClient();
    if (!client) return;

    unsubscribeRealtime();
    updateRealtimeStatus('connecting');

    try {
      state.realtimeChannel = client
        .channel('espaco-ligia-schedule-realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'reservations' },
          (payload) => {
            handleRealtimeEvent('reservations', payload);
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'space_blocks' },
          (payload) => {
            handleRealtimeEvent('space_blocks', payload);
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            updateRealtimeStatus('connected');
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            updateRealtimeStatus('disconnected');
          }
        });
    } catch (err) {
      console.error('[Espaço Ligia] Erro ao subscrever Realtime:', err);
      updateRealtimeStatus('error');
    }
  }

  function unsubscribeRealtime() {
    if (state.realtimeChannel && state.supabaseClient) {
      try {
        state.supabaseClient.removeChannel(state.realtimeChannel);
      } catch (e) {}
      state.realtimeChannel = null;
    }
    updateRealtimeStatus('disconnected');
  }

  function handleRealtimeEvent(table, payload) {
    // Alerta discreto na interface
    showRealtimeNotification('A agenda de espaços foi atualizada em tempo real.');

    // Atualiza disponibilidade silenciosamente
    refreshSchedule();
    if (state.currentTab === 'my_reservations') {
      loadMyReservations();
    }
  }

  function updateRealtimeStatus(status) {
    state.realtimeStatus = status;
    const badge = document.getElementById('realtimeStatusBadge');
    if (!badge) return;

    if (status === 'connected') {
      badge.innerHTML = `<span class="pa-dot pa-dot-live"></span> Conectado em tempo real`;
      badge.className = 'pa-realtime-badge pa-rt-connected';
      badge.title = 'Sincronização atômica ativa com o banco PostgreSQL';
    } else if (status === 'connecting') {
      badge.innerHTML = `<span class="pa-dot pa-dot-connecting"></span> Reconectando...`;
      badge.className = 'pa-realtime-badge pa-rt-connecting';
    } else {
      badge.innerHTML = `<span class="pa-dot pa-dot-off"></span> Offline (clique para sincronizar)`;
      badge.className = 'pa-realtime-badge pa-rt-offline';
      badge.onclick = () => {
        setupRealtime();
        refreshSchedule();
      };
    }
  }

  function showRealtimeNotification(msg) {
    const banner = document.getElementById('realtimeNoticeBanner');
    if (!banner) return;
    banner.textContent = msg;
    banner.classList.add('visible');
    setTimeout(() => {
      banner.classList.remove('visible');
    }, 4500);
  }

  // --------------------------------------------------------------------------
  // CONTROLES DE INTERFACE, ABAS E FORMULÁRIOS
  // --------------------------------------------------------------------------

  function showPanel(panelId) {
    const panels = ['panelLogin', 'panelForgotPassword', 'panelDashboard', 'panelConfigHelp'];
    panels.forEach(id => {
      const p = document.getElementById(id);
      if (p) p.style.display = (id === panelId) ? 'block' : 'none';
    });
  }

  function switchTab(tabId) {
    state.currentTab = tabId;
    const tabSchedule = document.getElementById('tabContentSchedule');
    const tabMy = document.getElementById('tabContentMyReservations');
    const tabAdmin = document.getElementById('tabContentAdmin');

    const btnSchedule = document.getElementById('tabBtnSchedule');
    const btnMy = document.getElementById('tabBtnMyReservations');
    const btnAdmin = document.getElementById('tabBtnAdmin');

    if (tabSchedule) tabSchedule.style.display = (tabId === 'schedule') ? 'block' : 'none';
    if (tabMy) tabMy.style.display = (tabId === 'my_reservations') ? 'block' : 'none';
    if (tabAdmin) tabAdmin.style.display = (tabId === 'admin_blocks') ? 'block' : 'none';

    if (btnSchedule) btnSchedule.classList.toggle('active', tabId === 'schedule');
    if (btnMy) btnMy.classList.toggle('active', tabId === 'my_reservations');
    if (btnAdmin) btnAdmin.classList.toggle('active', tabId === 'admin_blocks');

    if (tabId === 'schedule') {
      refreshSchedule();
    } else if (tabId === 'my_reservations') {
      loadMyReservations();
    } else if (tabId === 'admin_blocks') {
      loadAdminBlocks();
    }
  }

  function renderUserHeader() {
    const nameEl = document.getElementById('paUserFullName');
    const roleEl = document.getElementById('paUserRoleBadge');
    const adminTabBtn = document.getElementById('tabBtnAdmin');

    if (nameEl && state.profile) {
      nameEl.textContent = state.profile.full_name || 'Profissional';
    }

    if (roleEl && state.profile) {
      const isAdmin = state.profile.role === 'admin';
      roleEl.textContent = isAdmin ? 'Administrador' : 'Profissional';
      roleEl.className = isAdmin ? 'pa-badge pa-badge-admin' : 'pa-badge pa-badge-pro';
      
      // Aba administrativa visível apenas para perfil admin
      if (adminTabBtn) {
        adminTabBtn.style.display = isAdmin ? 'inline-flex' : 'none';
      }
    }
  }

  function renderSpacesSelector() {
    const container = document.getElementById('spacesPillsContainer');
    if (!container) return;

    container.innerHTML = state.spaces.map(s => `
      <button type="button" class="pa-space-pill ${s.id === state.selectedSpaceId ? 'active' : ''}" data-id="${s.id}">
        <span class="pa-space-dot"></span>
        <span class="pa-space-name">${escapeHtml(s.name)}</span>
      </button>
    `).join('');

    container.querySelectorAll('.pa-space-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        state.selectedSpaceId = pill.getAttribute('data-id');
        container.querySelectorAll('.pa-space-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        refreshSchedule();
      });
    });
  }

  async function loadAdminBlocks() {
    const client = getSupabaseClient();
    if (!client || !state.profile || state.profile.role !== 'admin') return;

    const listEl = document.getElementById('adminBlocksList');
    if (listEl) {
      listEl.innerHTML = `<div class="pa-loading-indicator"><div class="pa-spinner"></div><span>Carregando bloqueios...</span></div>`;
    }

    try {
      const { data, error } = await client
        .from('space_blocks')
        .select(`
          id,
          space_id,
          title,
          start_time,
          end_time,
          reason,
          created_at,
          spaces (name)
        `)
        .order('start_time', { ascending: false });

      if (error) {
        if (listEl) listEl.innerHTML = `<div class="pa-alert pa-alert-error">${error.message}</div>`;
        return;
      }

      state.adminBlocks = data || [];
      renderAdminBlocks();
    } catch (err) {
      console.error('[Espaço Ligia] Falha ao listar bloqueios:', err);
    }
  }

  function renderAdminBlocks() {
    const listEl = document.getElementById('adminBlocksList');
    if (!listEl) return;

    if (state.adminBlocks.length === 0) {
      listEl.innerHTML = `<div class="pa-empty-state"><p>Nenhum bloqueio cadastrado pela administração.</p></div>`;
      return;
    }

    let html = '<div class="pa-reservations-cards-col">';
    state.adminBlocks.forEach(b => {
      const spaceName = b.spaces ? b.spaces.name : 'Espaço';
      const startFormatted = new Date(b.start_time).toLocaleString('pt-BR', { timeZone: TIMEZONE });
      const endFormatted = new Date(b.end_time).toLocaleString('pt-BR', { timeZone: TIMEZONE });

      html += `
        <div class="pa-reservation-card pa-res-blocked">
          <div class="pa-res-top-row">
            <span class="pa-res-space">${escapeHtml(spaceName)}</span>
            <span class="pa-badge pa-badge-blocked">Bloqueio</span>
          </div>
          <div class="pa-res-datetime">
            <strong>${escapeHtml(b.title)}</strong>
            <span>${startFormatted} até ${endFormatted}</span>
          </div>
          ${b.reason ? `<div class="pa-res-notes">${escapeHtml(b.reason)}</div>` : ''}
          <div class="pa-res-footer">
            <button type="button" class="pa-btn pa-btn-danger-outline pa-btn-sm btn-delete-block" data-id="${b.id}">
              Remover Bloqueio
            </button>
          </div>
        </div>
      `;
    });
    html += '</div>';
    listEl.innerHTML = html;

    listEl.querySelectorAll('.btn-delete-block').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!confirm('Deseja remover este bloqueio administrativo?')) return;
        const client = getSupabaseClient();
        if (!client) return;

        setLoading(true, 'Removendo bloqueio...');
        try {
          await client.from('space_blocks').delete().eq('id', id);
          showToast('Bloqueio removido com sucesso!');
          await loadAdminBlocks();
          await refreshSchedule();
        } finally {
          setLoading(false);
        }
      });
    });
  }

  async function handleCreateBlock(e) {
    e.preventDefault();
    const spaceId = document.getElementById('adminBlockSpace')?.value;
    const title = document.getElementById('adminBlockTitle')?.value.trim();
    const startIso = document.getElementById('adminBlockStart')?.value;
    const endIso = document.getElementById('adminBlockEnd')?.value;
    const reason = document.getElementById('adminBlockReason')?.value.trim();

    if (!spaceId || !title || !startIso || !endIso) {
      alert('Preencha os campos obrigatórios do bloqueio.');
      return;
    }

    const client = getSupabaseClient();
    if (!client) return;

    setLoading(true, 'Salvando bloqueio...');
    try {
      const { error } = await client.from('space_blocks').insert({
        space_id: spaceId,
        title,
        start_time: new Date(startIso).toISOString(),
        end_time: new Date(endIso).toISOString(),
        reason: reason || null,
        created_by: state.session.user.id
      });

      if (error) {
        alert('Erro ao criar bloqueio: ' + error.message);
        return;
      }

      showToast('Bloqueio administrativo criado com sucesso!');
      e.target.reset();
      await loadAdminBlocks();
      await refreshSchedule();
    } catch (err) {
      console.error('[Espaço Ligia] Erro ao criar bloqueio:', err);
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------------------------------
  // CONTROLE DE LOADING E FEEDBACKS
  // --------------------------------------------------------------------------

  function setLoading(isLoading, text = 'Carregando...') {
    state.isLoading = isLoading;
    const overlay = document.getElementById('paLoadingOverlay');
    const textEl = document.getElementById('paLoadingText');
    if (overlay) {
      overlay.style.display = isLoading ? 'flex' : 'none';
    }
    if (textEl && text) {
      textEl.textContent = text;
    }
  }

  function showToast(msg) {
    let toast = document.getElementById('paToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'paToast';
      toast.className = 'pa-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => {
      toast.classList.remove('visible');
    }, 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --------------------------------------------------------------------------
  // INICIALIZAÇÃO DE EVENTOS DO DOCUMENTO
  // --------------------------------------------------------------------------

  function initPrivateArea() {
    // 1. Gatilho no rodapé: "Área dos profissionais"
    const footerLink = document.getElementById('btnOpenPrivateArea');
    if (footerLink) {
      footerLink.addEventListener('click', (e) => {
        e.preventDefault();
        openPrivateArea(footerLink);
      });
    }

    // 2. Botão de fechar modal
    const closeBtn = document.getElementById('closePrivateAreaModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', closePrivateArea);
    }

    // Fechar ao clicar no backdrop escuro
    const modal = document.getElementById('privateAreaModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closePrivateArea();
        }
      });
    }

    // Tecla Escape para fechar
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const pModal = document.getElementById('privateAreaModal');
        if (pModal && pModal.classList.contains('active')) {
          const bModal = document.getElementById('bookingModalDrawer');
          if (bModal && bModal.classList.contains('active')) {
            closeBookingModal();
          } else {
            closePrivateArea();
          }
        }
      }
    });

    // Formulário de Login
    const loginForm = document.getElementById('paLoginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', handleLogin);
    }

    // Botão de Logout
    const logoutBtn = document.getElementById('btnLogoutPA');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }

    // Link "Esqueci minha senha"
    const forgotLink = document.getElementById('btnForgotPassword');
    if (forgotLink) {
      forgotLink.addEventListener('click', (e) => {
        e.preventDefault();
        showPanel('panelForgotPassword');
      });
    }

    // Voltar do Esqueci Minha Senha
    const backToLoginBtn = document.getElementById('btnBackToLogin');
    if (backToLoginBtn) {
      backToLoginBtn.addEventListener('click', () => {
        showPanel('panelLogin');
      });
    }

    // Formulário de recuperação de senha
    const forgotForm = document.getElementById('paForgotPasswordForm');
    if (forgotForm) {
      forgotForm.addEventListener('submit', handleForgotPassword);
    }

    // Navegação entre abas
    document.getElementById('tabBtnSchedule')?.addEventListener('click', () => switchTab('schedule'));
    document.getElementById('tabBtnMyReservations')?.addEventListener('click', () => switchTab('my_reservations'));
    document.getElementById('tabBtnAdmin')?.addEventListener('click', () => switchTab('admin_blocks'));

    // Navegação de Datas
    const dateInput = document.getElementById('scheduleDateInput');
    if (dateInput) {
      dateInput.value = state.selectedDate;
      dateInput.min = getTodayDateStringSP();
      dateInput.addEventListener('change', (e) => {
        state.selectedDate = e.target.value;
        refreshSchedule();
      });
    }

    document.getElementById('btnPrevDay')?.addEventListener('click', () => {
      const [y, m, d] = state.selectedDate.split('-').map(Number);
      const prev = new Date(y, m - 1, d - 1, 12, 0, 0);
      state.selectedDate = prev.toISOString().split('T')[0];
      if (dateInput) dateInput.value = state.selectedDate;
      refreshSchedule();
    });

    document.getElementById('btnNextDay')?.addEventListener('click', () => {
      const [y, m, d] = state.selectedDate.split('-').map(Number);
      const next = new Date(y, m - 1, d + 1, 12, 0, 0);
      state.selectedDate = next.toISOString().split('T')[0];
      if (dateInput) dateInput.value = state.selectedDate;
      refreshSchedule();
    });

    document.getElementById('btnToday')?.addEventListener('click', () => {
      state.selectedDate = getTodayDateStringSP();
      if (dateInput) dateInput.value = state.selectedDate;
      refreshSchedule();
    });

    // Botão de Atualização manual
    document.getElementById('btnRefreshSchedule')?.addEventListener('click', () => {
      refreshSchedule();
      if (state.currentTab === 'my_reservations') loadMyReservations();
      showToast('Agenda atualizada com o banco!');
    });

    // Formulário de Reserva Drawer
    const bookingForm = document.getElementById('bookingDrawerForm');
    if (bookingForm) {
      bookingForm.addEventListener('submit', handleConfirmBooking);
    }

    document.getElementById('btnCloseBookingDrawer')?.addEventListener('click', closeBookingModal);
    document.getElementById('btnCancelBookingDrawer')?.addEventListener('click', closeBookingModal);

    // Formulário de Bloqueio Admin
    const blockForm = document.getElementById('adminBlockForm');
    if (blockForm) {
      blockForm.addEventListener('submit', handleCreateBlock);
    }

    // Configuração manual de chaves Supabase (se ainda estiver em placeholder)
    const configForm = document.getElementById('paCustomConfigForm');
    if (configForm) {
      configForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = document.getElementById('customSupabaseUrl')?.value.trim();
        const key = document.getElementById('customSupabaseKey')?.value.trim();
        if (url && key) {
          window.SUPABASE_CONFIG.saveCustomConfig(url, key);
          state.supabaseClient = null;
          showToast('Credenciais salvas com sucesso!');
          checkAuthAndInit();
        }
      });
    }

    // Resiliência de Conexão: Atualiza ao retornar para a aba ou restabelecer internet
    window.addEventListener('focus', () => {
      if (document.getElementById('privateAreaModal')?.classList.contains('active')) {
        refreshSchedule();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && document.getElementById('privateAreaModal')?.classList.contains('active')) {
        refreshSchedule();
      }
    });

    window.addEventListener('online', () => {
      setupRealtime();
      refreshSchedule();
    });
  }

  // Expor globalmente na window
  window.openPrivateArea = openPrivateArea;
  window.closePrivateArea = closePrivateArea;

  // Inicialização segura
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPrivateArea, { once: true });
  } else {
    initPrivateArea();
  }

})();
