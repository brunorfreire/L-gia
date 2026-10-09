/**
 * ============================================================================
 * ESPAÇO LIGIA DE MAYOR - ÁREA PRIVADA DOS PROFISSIONAIS
 * ============================================================================
 * Integração completa com Supabase (Auth, PostgreSQL com Restrição de Exclusão,
 * RLS e Realtime) para reserva das salas:
 * - Sala de Pilates
 * - Sala de massoterapia
 * 
 * Regras principais:
 * - Apenas profissionais ativos autorizados pela administração
 * - Sem cadastro público (somente login e recuperação de senha)
 * - Perfis: Administrador ('admin') e Profissional ('professional')
 * - Fuso horário oficial: America/Sao_Paulo
 * - Horários de funcionamento gerenciados dinamicamente por sala pelo admin
 * - Disponibilidade pública de terceiros exibida apenas como "Indisponível"
 *   sem expor nomes de profissionais ou pacientes
 * - Proteção atômica de concorrência com tratamento do erro 23P01:
 *   "Este horário acabou de ser reservado. Escolha outro horário."
 * - Atualização em tempo real via tabela availability_revisions (dados anônimos)
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
    operatingHours: [],
    selectedSpaceId: null,
    selectedDate: getTodayDateStringSP(),
    availabilitySlots: [],
    myReservations: [],
    adminBlocks: [],
    adminUsers: [],
    realtimeChannel: null,
    realtimeStatus: 'disconnected', // 'connected', 'connecting', 'disconnected', 'error'
    currentTab: 'schedule', // 'schedule', 'my_reservations', 'admin'
    adminSubTab: 'hours', // 'hours', 'blocks', 'users'
    isLoading: false,
    lastActiveTrigger: null
  };

  // --------------------------------------------------------------------------
  // UTILITÁRIOS DE DATA E HORA (AMERICA/SAO_PAULO)
  // --------------------------------------------------------------------------

  function getTodayDateStringSP() {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return formatter.format(now);
    } catch (e) {
      const d = new Date();
      return d.toISOString().split('T')[0];
    }
  }

  function formatDateFriendly(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0);
    const dayOfWeek = days[dateObj.getDay()];
    const monthName = months[Number(m) - 1];
    return `${dayOfWeek}, ${d} de ${monthName}`;
  }

  function getDayOfWeek(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d, 12, 0, 0);
    return date.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  }

  function getOperatingHoursForDate(dateStr, spaceId) {
    const targetSpaceId = spaceId || state.selectedSpaceId;
    const dow = getDayOfWeek(dateStr);
    const found = state.operatingHours.find(h => h.space_id === targetSpaceId && h.day_of_week === dow);

    if (!found) {
      return {
        isOpen: false,
        startHour: 7,
        endHour: 21,
        openingTime: '07:00',
        closingTime: '21:00',
        label: 'Horário de funcionamento não configurado pela administração'
      };
    }

    const openH = parseInt(found.opening_time.split(':')[0], 10);
    const closeH = parseInt(found.closing_time.split(':')[0], 10);
    const openStr = found.opening_time.substring(0, 5);
    const closeStr = found.closing_time.substring(0, 5);

    return {
      isOpen: found.is_open,
      startHour: openH,
      endHour: closeH,
      openingTime: openStr,
      closingTime: closeStr,
      label: found.is_open ? `${openStr} às ${closeStr}` : 'Espaço fechado nesta data'
    };
  }

  function buildIsoStringSP(dateStr, timeStr) {
    // Converte YYYY-MM-DD e HH:MM para timestamptz ISO considerando offset de Brasília (UTC-03:00)
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

    // Fecha o menu mobile se estiver aberto no celular
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

    modal.removeAttribute('hidden');
    modal.hidden = false;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('active');
    document.body.classList.add('modal-open');

    // Executa checagem de autenticação ao abrir
    checkAuthAndInit();

    setTimeout(() => {
      const closeBtn = document.getElementById('btnClosePrivateArea');
      if (closeBtn) closeBtn.focus();
    }, 60);
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

    closeBookingModal();

    if (state.lastActiveTrigger && typeof state.lastActiveTrigger.focus === 'function') {
      try {
        state.lastActiveTrigger.focus();
      } catch (e) {}
    }
  }

  function isModalOpen() {
    const modal = document.getElementById('privateAreaModal');
    return modal && modal.classList.contains('active');
  }

  // --------------------------------------------------------------------------
  // NAVEGAÇÃO ENTRE PAINÉIS (LOGIN / ESQUECI SENHA / DASHBOARD / NÃO CONFIGURADO)
  // --------------------------------------------------------------------------

  function showPanel(panelId) {
    const panels = ['panelUnavailable', 'panelLogin', 'panelForgotPassword', 'panelDashboard'];
    panels.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = id === panelId ? 'block' : 'none';
      }
    });

    // Se estiver no dashboard, renderiza dados do usuário
    if (panelId === 'panelDashboard') {
      renderUserProfile();
    }
  }

  // --------------------------------------------------------------------------
  // AUTENTICAÇÃO E PERFIL DO PROFISSIONAL
  // --------------------------------------------------------------------------

  async function checkAuthAndInit() {
    const config = window.SUPABASE_CONFIG;
    if (!config || !config.isConfigured()) {
      showPanel('panelUnavailable');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showPanel('panelUnavailable');
      return;
    }

    setLoading(true, 'Verificando credenciais...');

    try {
      const { data: { session }, error } = await client.auth.getSession();
      if (error) throw error;

      if (session && session.user) {
        state.session = session;
        const valid = await fetchUserProfile(session.user.id);
        if (valid) {
          showPanel('panelDashboard');
          await loadSpaces();
          await loadOperatingHours();
          await refreshSchedule();
          setupRealtime();
        } else {
          // Usuário autenticado mas sem perfil ativo autorizado
          await client.auth.signOut();
          state.session = null;
          state.profile = null;
          showPanel('panelLogin');
          showAuthError('Seu perfil de profissional ainda não foi aprovado pela administração do Espaço Lígia de Mayor.');
        }
      } else {
        state.session = null;
        state.profile = null;
        showPanel('panelLogin');
      }
    } catch (err) {
      console.error('[Espaço Ligia] Erro ao verificar sessão:', err);
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

      state.profile = data;

      // REQUISITO DE SEGURANÇA: Somente profissionais ativos podem usar o sistema
      return data.is_active === true;
    } catch (err) {
      console.error('[Espaço Ligia] Falha ao consultar perfil:', err);
      return false;
    }
  }

  function renderUserProfile() {
    const nameEl = document.getElementById('paUserName');
    const roleBadge = document.getElementById('paUserRoleBadge');
    const adminTabBtn = document.getElementById('tabBtnAdmin');

    if (nameEl && state.profile) {
      nameEl.textContent = state.profile.full_name || 'Profissional';
    }

    const isAdmin = state.profile && state.profile.role === 'admin';

    if (roleBadge) {
      if (isAdmin) {
        roleBadge.textContent = 'Administrador';
        roleBadge.className = 'pa-badge pa-badge-admin';
      } else {
        roleBadge.textContent = 'Profissional';
        roleBadge.className = 'pa-badge pa-badge-professional';
      }
    }

    if (adminTabBtn) {
      adminTabBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }
  }

  // --------------------------------------------------------------------------
  // FORMULÁRIOS DE LOGIN E RECUPERAÇÃO DE SENHA
  // --------------------------------------------------------------------------

  async function handleLoginSubmit(e) {
    e.preventDefault();
    clearAuthMessages();

    const emailInput = document.getElementById('paLoginEmail');
    const passwordInput = document.getElementById('paLoginPassword');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!email || !password) {
      showAuthError('Informe o seu e-mail e sua senha de acesso.');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showAuthError('Serviço de agendamento não configurado.');
      return;
    }

    setLoading(true, 'Entrando na Área Privada...');

    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          showAuthError('E-mail ou senha incorretos. Verifique suas credenciais.');
        } else {
          showAuthError('Falha no login: ' + error.message);
        }
        return;
      }

      state.session = data.session;
      const valid = await fetchUserProfile(data.user.id);

      if (valid) {
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
        showPanel('panelDashboard');
        await loadSpaces();
        await loadOperatingHours();
        await refreshSchedule();
        setupRealtime();
      } else {
        await client.auth.signOut();
        showAuthError('Acesso não autorizado: seu cadastro de profissional precisa ser ativado pela administração do Espaço Ligia de Mayor.');
      }
    } catch (err) {
      console.error('[Espaço Ligia] Erro no login:', err);
      showAuthError('Erro de conexão ao autenticar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPasswordSubmit(e) {
    e.preventDefault();
    clearAuthMessages();

    const emailInput = document.getElementById('paForgotEmail');
    const email = emailInput ? emailInput.value.trim() : '';

    if (!email) {
      showForgotError('Informe o e-mail cadastrado na clínica.');
      return;
    }

    const client = getSupabaseClient();
    if (!client) return;

    setLoading(true, 'Enviando link de recuperação...');

    try {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });

      if (error) {
        showForgotError('Erro ao solicitar redefinição: ' + error.message);
        return;
      }

      showForgotSuccess('Link de recuperação enviado com sucesso para seu e-mail. Verifique sua caixa de entrada.');
      if (emailInput) emailInput.value = '';
    } catch (err) {
      console.error('[Espaço Ligia] Erro na recuperação de senha:', err);
      showForgotError('Erro de conexão ao processar solicitação.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    const client = getSupabaseClient();
    setLoading(true, 'Saindo da Área Privada...');

    try {
      if (client) {
        await client.auth.signOut();
      }
    } catch (e) {
    } finally {
      unsubscribeRealtime();
      state.session = null;
      state.profile = null;
      state.spaces = [];
      state.availabilitySlots = [];
      state.myReservations = [];
      setLoading(false);
      showPanel('panelLogin');
    }
  }

  function showAuthError(msg) {
    const el = document.getElementById('loginErrorMessage');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  function showForgotError(msg) {
    const err = document.getElementById('forgotErrorMessage');
    const succ = document.getElementById('forgotSuccessMessage');
    if (err) {
      err.textContent = msg;
      err.style.display = 'block';
    }
    if (succ) succ.style.display = 'none';
  }

  function showForgotSuccess(msg) {
    const err = document.getElementById('forgotErrorMessage');
    const succ = document.getElementById('forgotSuccessMessage');
    if (succ) {
      succ.textContent = msg;
      succ.style.display = 'block';
    }
    if (err) err.style.display = 'none';
  }

  function clearAuthMessages() {
    const lErr = document.getElementById('loginErrorMessage');
    const fErr = document.getElementById('forgotErrorMessage');
    const fSucc = document.getElementById('forgotSuccessMessage');
    if (lErr) lErr.style.display = 'none';
    if (fErr) fErr.style.display = 'none';
    if (fSucc) fSucc.style.display = 'none';
  }

  // --------------------------------------------------------------------------
  // CARREGAMENTO DE ESPAÇOS E HORÁRIOS DE FUNCIONAMENTO
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

      // Seleciona a Sala de Pilates por padrão, se disponível
      if (state.spaces.length > 0) {
        const pilates = state.spaces.find(s => s.name.toLowerCase().includes('pilates'));
        state.selectedSpaceId = pilates ? pilates.id : state.spaces[0].id;
      }

      renderSpacesSelector();
      populateSpaceSelects();
    } catch (err) {
      console.error('[Espaço Ligia] Falha ao carregar salas:', err);
    }
  }

  async function loadOperatingHours() {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const { data, error } = await client
        .from('operating_hours')
        .select('*')
        .order('day_of_week', { ascending: true });

      if (!error && data) {
        state.operatingHours = data;
      }
    } catch (err) {
      console.error('[Espaço Ligia] Erro ao carregar horários de funcionamento:', err);
    }
  }

  function renderSpacesSelector() {
    const container = document.getElementById('spacesPillsContainer');
    if (!container) return;

    container.innerHTML = '';
    state.spaces.forEach(space => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pa-space-pill ${space.id === state.selectedSpaceId ? 'active' : ''}`;
      btn.setAttribute('data-id', space.id);
      btn.innerHTML = `
        <span class="pa-space-pill-title">${escapeHtml(space.name)}</span>
        ${space.description ? `<span class="pa-space-pill-desc">${escapeHtml(space.description)}</span>` : ''}
      `;
      btn.addEventListener('click', () => {
        if (state.selectedSpaceId !== space.id) {
          state.selectedSpaceId = space.id;
          renderSpacesSelector();
          refreshSchedule();
        }
      });
      container.appendChild(btn);
    });
  }

  function populateSpaceSelects() {
    const selects = ['bookingSpaceSelect', 'adminBlockSpace', 'adminHoursSpaceSelect'];
    selects.forEach(selectId => {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      sel.innerHTML = '';
      state.spaces.forEach(sp => {
        const opt = document.createElement('option');
        opt.value = sp.id;
        opt.textContent = sp.name;
        sel.appendChild(opt);
      });
      if (state.selectedSpaceId) {
        sel.value = state.selectedSpaceId;
      }
    });
  }

  // --------------------------------------------------------------------------
  // CONTROLE DE DATA E DISPONIBILIDADE (AMERICA/SAO_PAULO)
  // --------------------------------------------------------------------------

  function initDateControls() {
    const dateInput = document.getElementById('scheduleDateInput');
    const btnPrev = document.getElementById('btnPrevDay');
    const btnNext = document.getElementById('btnNextDay');
    const btnToday = document.getElementById('btnToday');

    if (dateInput) {
      dateInput.value = state.selectedDate;
      dateInput.min = getTodayDateStringSP();
      dateInput.addEventListener('change', (e) => {
        if (e.target.value) {
          state.selectedDate = e.target.value;
          refreshSchedule();
        }
      });
    }

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        changeDateByDays(-1);
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        changeDateByDays(1);
      });
    }

    if (btnToday) {
      btnToday.addEventListener('click', () => {
        state.selectedDate = getTodayDateStringSP();
        if (dateInput) dateInput.value = state.selectedDate;
        refreshSchedule();
      });
    }
  }

  function changeDateByDays(delta) {
    const [y, m, d] = state.selectedDate.split('-').map(Number);
    const date = new Date(y, m - 1, d, 12, 0, 0);
    date.setDate(date.getDate() + delta);

    const newY = date.getFullYear();
    const newM = String(date.getMonth() + 1).padStart(2, '0');
    const newD = String(date.getDate()).padStart(2, '0');
    const newDateStr = `${newY}-${newM}-${newD}`;

    const todayStr = getTodayDateStringSP();
    if (newDateStr < todayStr && delta < 0) {
      showToast('Não é permitido agendar em datas passadas.');
      return;
    }

    state.selectedDate = newDateStr;
    const dateInput = document.getElementById('scheduleDateInput');
    if (dateInput) dateInput.value = newDateStr;
    refreshSchedule();
  }

  async function refreshSchedule(isSilent = false) {
    if (!state.selectedSpaceId) return;

    const dateHeader = document.getElementById('scheduleDateHeaderInfo');
    const hoursBadge = document.getElementById('operatingHoursBadge');
    const container = document.getElementById('scheduleSlotsContainer');

    if (dateHeader) {
      dateHeader.textContent = formatDateFriendly(state.selectedDate);
    }

    const opHours = getOperatingHoursForDate(state.selectedDate, state.selectedSpaceId);
    if (hoursBadge) {
      hoursBadge.textContent = opHours.label;
      hoursBadge.className = opHours.isOpen ? 'pa-badge pa-badge-teal' : 'pa-badge pa-badge-closed';
    }

    if (!isSilent && container) {
      container.innerHTML = `
        <div class="pa-loading-indicator">
          <div class="pa-spinner"></div>
          <span>Consultando disponibilidade...</span>
        </div>
      `;
    }

    const client = getSupabaseClient();
    if (!client) return;

    try {
      // Chama a RPC get_space_availability (Segurança rigorosa: dados anônimos de colegas)
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

    const currentSpace = state.spaces.find(s => s.id === state.selectedSpaceId);
    const spaceName = currentSpace ? currentSpace.name : 'Espaço selecionado';
    const opHours = getOperatingHoursForDate(state.selectedDate, state.selectedSpaceId);

    // Se o espaço estiver fechado neste dia
    if (!opHours.isOpen) {
      container.innerHTML = `
        <div class="pa-empty-state">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔒</div>
          <h4>${escapeHtml(spaceName)}: Fechado</h4>
          <p>${escapeHtml(opHours.label)} para agendamentos em ${formatDateFriendly(state.selectedDate)}.</p>
        </div>
      `;
      return;
    }

    // Monta a grade contínua de horários do dia de 1 em 1 hora respeitando abertura e fechamento
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
        // Sobreposição estrita [start, end)
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
          <p>Nenhum horário disponível para este dia.</p>
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
          <button type="button" class="pa-btn pa-btn-sm pa-btn-outline btn-go-my-reservations">
            Minhas Reservas
          </button>
        `;
      } else if (slot.status === 'busy') {
        statusBadge = `<span class="pa-slot-badge pa-slot-busy">Indisponível</span>`;
        actionBtn = `<button type="button" class="pa-btn pa-btn-sm pa-btn-disabled" disabled>Ocupado</button>`;
      } else if (slot.status === 'blocked') {
        statusBadge = `<span class="pa-slot-badge pa-slot-blocked">Indisponível</span>`;
        actionBtn = `<button type="button" class="pa-btn pa-btn-sm pa-btn-disabled" disabled>Bloqueado</button>`;
      } else if (slot.status === 'past') {
        statusBadge = `<span class="pa-slot-badge pa-slot-past">Encerrado</span>`;
        actionBtn = `<button type="button" class="pa-btn pa-btn-sm pa-btn-disabled" disabled>Encerrado</button>`;
      }

      html += `
        <div class="pa-slot-card ${slot.status}">
          <div class="pa-slot-time-col">
            <span class="pa-slot-hours">${slot.startH} às ${slot.endH}</span>
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

    html += `</div>`;
    container.innerHTML = html;

    // Conecta botões "Reservar"
    container.querySelectorAll('.pa-btn-reserve').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const startH = e.currentTarget.getAttribute('data-start');
        const endH = e.currentTarget.getAttribute('data-end');
        openBookingModal(startH, endH);
      });
    });

    // Conecta botões "Minhas Reservas"
    container.querySelectorAll('.btn-go-my-reservations').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab('my_reservations');
      });
    });
  }

  // --------------------------------------------------------------------------
  // MODAL / DRAWER DE CRIAÇÃO DE RESERVA
  // --------------------------------------------------------------------------

  function openBookingModal(defaultStart = '07:00', defaultEnd = '08:00') {
    const drawer = document.getElementById('bookingModalDrawer');
    const spaceSelect = document.getElementById('bookingSpaceSelect');
    const dateInput = document.getElementById('bookingDateInput');
    const startSelect = document.getElementById('bookingStartTimeSelect');
    const endSelect = document.getElementById('bookingEndTimeSelect');
    const notesInput = document.getElementById('bookingNotesInput');
    const errorEl = document.getElementById('bookingFormError');

    if (!drawer) return;
    if (errorEl) errorEl.style.display = 'none';

    if (spaceSelect && state.selectedSpaceId) {
      spaceSelect.value = state.selectedSpaceId;
    }

    if (dateInput) {
      dateInput.value = state.selectedDate;
      dateInput.min = getTodayDateStringSP();
    }

    populateTimeOptions(startSelect, endSelect, defaultStart, defaultEnd);

    if (notesInput) {
      notesInput.value = '';
    }

    drawer.removeAttribute('hidden');
    drawer.hidden = false;
    drawer.style.display = 'flex';

    setTimeout(() => {
      if (notesInput) notesInput.focus();
    }, 60);
  }

  function closeBookingModal() {
    const drawer = document.getElementById('bookingModalDrawer');
    if (!drawer) return;
    drawer.setAttribute('hidden', '');
    drawer.hidden = true;
    drawer.style.display = 'none';
  }

  function populateTimeOptions(startSelect, endSelect, selectedStart = '07:00', selectedEnd = '08:00') {
    if (!startSelect || !endSelect) return;
    const opHours = getOperatingHoursForDate(state.selectedDate, state.selectedSpaceId);
    const startH = opHours.isOpen ? opHours.startHour : 7;
    const endH = opHours.isOpen ? opHours.endHour : 21;

    startSelect.innerHTML = '';
    endSelect.innerHTML = '';

    for (let h = startH; h < endH; h++) {
      const timeStr00 = String(h).padStart(2, '0') + ':00';
      const timeStr30 = String(h).padStart(2, '0') + ':30';
      startSelect.add(new Option(timeStr00, timeStr00));
      startSelect.add(new Option(timeStr30, timeStr30));
    }

    for (let h = startH; h <= endH; h++) {
      const timeStr00 = String(h).padStart(2, '0') + ':00';
      const timeStr30 = String(h).padStart(2, '0') + ':30';
      if (h > startH || timeStr00 > selectedStart) {
        endSelect.add(new Option(timeStr00, timeStr00));
      }
      if (h < endH) {
        endSelect.add(new Option(timeStr30, timeStr30));
      }
    }

    startSelect.value = selectedStart;
    endSelect.value = selectedEnd;

    // Atualiza opções de término ao mudar início
    startSelect.onchange = () => {
      const currentStart = startSelect.value;
      const currentEnd = endSelect.value;
      endSelect.innerHTML = '';

      for (let h = startH; h <= endH; h++) {
        const timeStr00 = String(h).padStart(2, '0') + ':00';
        const timeStr30 = String(h).padStart(2, '0') + ':30';
        if (timeStr00 > currentStart) {
          endSelect.add(new Option(timeStr00, timeStr00));
        }
        if (h < endH && timeStr30 > currentStart) {
          endSelect.add(new Option(timeStr30, timeStr30));
        }
      }

      if (currentEnd > currentStart) {
        endSelect.value = currentEnd;
      } else if (endSelect.options.length > 0) {
        endSelect.selectedIndex = 0;
      }
    };
  }

  async function handleConfirmBooking(e) {
    e.preventDefault();
    const spaceId = document.getElementById('bookingSpaceSelect')?.value;
    const dateStr = document.getElementById('bookingDateInput')?.value;
    const startTimeStr = document.getElementById('bookingStartTimeSelect')?.value;
    const endTimeStr = document.getElementById('bookingEndTimeSelect')?.value;
    const notes = document.getElementById('bookingNotesInput')?.value.trim();

    if (!spaceId || !dateStr || !startTimeStr || !endTimeStr) {
      showBookingError('Preencha todos os campos obrigatórios da reserva.');
      return;
    }

    if (startTimeStr >= endTimeStr) {
      showBookingError('O horário de término deve ser posterior ao horário de início.');
      return;
    }

    const startIso = buildIsoStringSP(dateStr, startTimeStr);
    const endIso = buildIsoStringSP(dateStr, endTimeStr);

    if (new Date(endIso) <= new Date()) {
      showBookingError('Não é permitido criar reservas para horários passados.');
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showBookingError('Serviço de agendamento não configurado.');
      return;
    }

    setLoading(true, 'Confirmando reserva no banco de dados...');

    try {
      const { data, error } = await client
        .from('reservations')
        .insert({
          space_id: spaceId,
          professional_id: state.session.user.id,
          start_time: startIso,
          end_time: endIso,
          status: 'confirmed',
          notes: notes || null
        })
        .select()
        .single();

      if (error) {
        console.error('[Espaço Ligia] Erro ao criar reserva:', error);

        // Tratamento estrito do erro de concorrência / colisão
        if (
          error.code === '23P01' ||
          (error.message && (
            error.message.includes('no_overlapping_reservations') ||
            error.message.includes('sobreposição') ||
            error.message.includes('bloqueio') ||
            error.message.includes('conflito')
          ))
        ) {
          showBookingError('Este horário acabou de ser reservado. Escolha outro horário.');
        } else if (error.message && error.message.includes('passados')) {
          showBookingError('Não é permitido criar reservas para horários passados.');
        } else if (error.message && error.message.includes('fechado')) {
          showBookingError('O espaço está fechado nesta data conforme configuração de horários.');
        } else if (error.message && error.message.includes('funcionamento')) {
          showBookingError('A reserva deve respeitar o horário de funcionamento do espaço.');
        } else if (error.message && error.message.includes('inativo')) {
          showBookingError('Acesso não autorizado: seu cadastro está inativo.');
        } else {
          showBookingError('Erro ao confirmar reserva: ' + error.message);
        }
        return;
      }

      showToast('Reserva confirmada com sucesso!');
      closeBookingModal();
      await refreshSchedule();
      if (state.currentTab === 'my_reservations') {
        await loadMyReservations();
      }
    } catch (err) {
      console.error('[Espaço Ligia] Erro inesperado na reserva:', err);
      showBookingError('Erro de conexão. Verifique sua internet e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  function showBookingError(msg) {
    const errorEl = document.getElementById('bookingFormError');
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
    }
  }

  // --------------------------------------------------------------------------
  // ABA: MINHAS RESERVAS E CANCELAMENTO ATÔMICO
  // --------------------------------------------------------------------------

  async function loadMyReservations() {
    const container = document.getElementById('myReservationsList');
    if (!container) return;

    container.innerHTML = `
      <div class="pa-loading-indicator">
        <div class="pa-spinner"></div>
        <span>Carregando suas reservas...</span>
      </div>
    `;

    const client = getSupabaseClient();
    if (!client) return;

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
          spaces ( name )
        `)
        .eq('professional_id', state.session.user.id)
        .order('start_time', { ascending: false });

      if (error) {
        container.innerHTML = `
          <div class="pa-alert pa-alert-error">
            Erro ao listar reservas: ${error.message}
          </div>
        `;
        return;
      }

      state.myReservations = data || [];
      renderMyReservations();
    } catch (err) {
      console.error('[Espaço Ligia] Erro ao carregar minhas reservas:', err);
      container.innerHTML = `
        <div class="pa-alert pa-alert-error">
          Erro de conexão ao carregar reservas.
        </div>
      `;
    }
  }

  function renderMyReservations() {
    const container = document.getElementById('myReservationsList');
    if (!container) return;

    if (state.myReservations.length === 0) {
      container.innerHTML = `
        <div class="pa-empty-state">
          <p>Você ainda não possui reservas registradas.</p>
        </div>
      `;
      return;
    }

    let html = `<div class="pa-reservations-cards-list">`;
    const now = new Date();

    state.myReservations.forEach(res => {
      const startDate = new Date(res.start_time);
      const isPast = startDate < now;
      const isCancelled = res.status === 'cancelled';
      const spaceName = res.spaces?.name || 'Espaço';

      const dateStr = formatDateFromIsoSP(res.start_time);
      const timeStr = formatTimeRangeSP(res.start_time, res.end_time);

      let statusBadge = '';
      if (isCancelled) {
        statusBadge = `<span class="pa-badge pa-badge-cancelled">Cancelada</span>`;
      } else if (isPast) {
        statusBadge = `<span class="pa-badge pa-badge-past">Realizada</span>`;
      } else {
        statusBadge = `<span class="pa-badge pa-badge-teal">Confirmada</span>`;
      }

      const canCancel = !isCancelled && !isPast;

      html += `
        <div class="pa-res-card ${isCancelled ? 'cancelled' : ''}">
          <div class="pa-res-card-header">
            <div>
              <span class="pa-res-space-name">${escapeHtml(spaceName)}</span>
              <div class="pa-res-datetime">
                <strong>${dateStr}</strong> · ${timeStr}
              </div>
            </div>
            ${statusBadge}
          </div>

          ${res.notes ? `<div class="pa-res-notes">Obs: ${escapeHtml(res.notes)}</div>` : ''}

          <div class="pa-res-card-actions">
            ${canCancel ? `
              <button type="button" class="pa-btn pa-btn-outline pa-btn-sm btn-cancel-res" data-id="${res.id}">
                Cancelar Reserva
              </button>
            ` : ''}
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;

    container.querySelectorAll('.btn-cancel-res').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const resId = e.currentTarget.getAttribute('data-id');
        handleCancelReservation(resId);
      });
    });
  }

  async function handleCancelReservation(reservationId) {
    if (!confirm('Deseja realmente cancelar esta reserva? O horário será liberado imediatamente para outros profissionais.')) {
      return;
    }

    const client = getSupabaseClient();
    if (!client) return;

    setLoading(true, 'Cancelando reserva no banco de dados...');

    try {
      // Atualiza apenas o status para 'cancelled' (respeitando o trigger do Postgres)
      const { error } = await client
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('id', reservationId);

      if (error) {
        alert('Erro ao cancelar reserva: ' + error.message);
        return;
      }

      showToast('Reserva cancelada com sucesso! O horário foi liberado.');
      await loadMyReservations();
      await refreshSchedule();
    } catch (err) {
      console.error('[Espaço Ligia] Erro no cancelamento:', err);
      alert('Erro inesperado ao cancelar reserva.');
    } finally {
      setLoading(false);
    }
  }

  function formatDateFromIsoSP(isoStr) {
    try {
      const date = new Date(isoStr);
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIMEZONE,
        weekday: 'short',
        day: '2-digit',
        month: 'short'
      }).format(date);
    } catch (e) {
      return isoStr.substring(0, 10);
    }
  }

  function formatTimeRangeSP(startIso, endIso) {
    try {
      const start = new Date(startIso);
      const end = new Date(endIso);
      const fmt = new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIMEZONE,
        hour: '2-digit',
        minute: '2-digit'
      });
      return `${fmt.format(start)} às ${fmt.format(end)}`;
    } catch (e) {
      return '';
    }
  }

  // --------------------------------------------------------------------------
  // ABA: ADMINISTRAÇÃO COMPLETA (HORÁRIOS, BLOQUEIOS E PROFISSIONAIS)
  // --------------------------------------------------------------------------

  function initAdminTabs() {
    document.getElementById('subtabBtnHours')?.addEventListener('click', () => switchAdminSubTab('hours'));
    document.getElementById('subtabBtnBlocks')?.addEventListener('click', () => switchAdminSubTab('blocks'));
    document.getElementById('subtabBtnUsers')?.addEventListener('click', () => switchAdminSubTab('users'));
    document.getElementById('adminHoursSpaceSelect')?.addEventListener('change', (e) => loadAdminHoursForSpace(e.target.value));
    document.getElementById('btnSaveOperatingHours')?.addEventListener('click', handleSaveOperatingHours);
  }

  function switchAdminSubTab(subTab) {
    state.adminSubTab = subTab;
    const btnHours = document.getElementById('subtabBtnHours');
    const btnBlocks = document.getElementById('subtabBtnBlocks');
    const btnUsers = document.getElementById('subtabBtnUsers');
    const secHours = document.getElementById('adminSectionHours');
    const secBlocks = document.getElementById('adminSectionBlocks');
    const secUsers = document.getElementById('adminSectionUsers');

    if (btnHours) btnHours.classList.toggle('active', subTab === 'hours');
    if (btnBlocks) btnBlocks.classList.toggle('active', subTab === 'blocks');
    if (btnUsers) btnUsers.classList.toggle('active', subTab === 'users');

    if (secHours) secHours.style.display = subTab === 'hours' ? 'block' : 'none';
    if (secBlocks) secBlocks.style.display = subTab === 'blocks' ? 'block' : 'none';
    if (secUsers) secUsers.style.display = subTab === 'users' ? 'block' : 'none';

    if (subTab === 'hours') {
      populateAdminHoursSpaceSelect();
    } else if (subTab === 'blocks') {
      loadAdminBlocks();
    } else if (subTab === 'users') {
      loadAdminUsers();
    }
  }

  function populateAdminHoursSpaceSelect() {
    const sel = document.getElementById('adminHoursSpaceSelect');
    if (!sel) return;
    sel.innerHTML = '';
    state.spaces.forEach(sp => {
      const opt = document.createElement('option');
      opt.value = sp.id;
      opt.textContent = sp.name;
      sel.appendChild(opt);
    });

    const targetSpace = state.selectedSpaceId || (state.spaces[0] ? state.spaces[0].id : null);
    if (targetSpace) {
      sel.value = targetSpace;
      loadAdminHoursForSpace(targetSpace);
    }
  }

  async function loadAdminHoursForSpace(spaceId) {
    const wrap = document.getElementById('adminHoursTableWrap');
    if (!wrap) return;

    wrap.innerHTML = `
      <div class="pa-loading-indicator">
        <div class="pa-spinner"></div>
        <span>Carregando horários da sala...</span>
      </div>
    `;

    const client = getSupabaseClient();
    if (!client) return;

    try {
      const { data, error } = await client
        .from('operating_hours')
        .select('*')
        .eq('space_id', spaceId)
        .order('day_of_week', { ascending: true });

      if (error) {
        wrap.innerHTML = `<div class="pa-alert pa-alert-error">Erro ao carregar horários: ${error.message}</div>`;
        return;
      }

      const daysNames = [
        'Domingo',
        'Segunda-feira',
        'Terça-feira',
        'Quarta-feira',
        'Quinta-feira',
        'Sexta-feira',
        'Sábado'
      ];

      let html = '';
      for (let day = 0; day <= 6; day++) {
        const existing = (data || []).find(d => d.day_of_week === day);
        const isOpen = existing ? existing.is_open : (day >= 1 && day <= 6);
        const openTime = existing ? existing.opening_time.substring(0, 5) : '07:00';
        const closeTime = existing ? existing.closing_time.substring(0, 5) : (day === 6 ? '13:00' : '21:00');

        html += `
          <div class="pa-hours-day-row" data-day="${day}">
            <div class="pa-hours-day-info">
              <input type="checkbox" id="checkDay_${day}" class="pa-checkbox" ${isOpen ? 'checked' : ''} />
              <label for="checkDay_${day}" class="pa-hours-day-label">${daysNames[day]}</label>
            </div>
            <div class="pa-hours-inputs">
              <input type="time" class="pa-hours-time-input pa-open-time" value="${openTime}" ${isOpen ? '' : 'disabled'} />
              <span style="font-size: 0.8125rem; color: #64748B;">até</span>
              <input type="time" class="pa-hours-time-input pa-close-time" value="${closeTime}" ${isOpen ? '' : 'disabled'} />
            </div>
          </div>
        `;
      }

      wrap.innerHTML = html;

      wrap.querySelectorAll('.pa-checkbox').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const row = e.target.closest('.pa-hours-day-row');
          if (row) {
            row.querySelectorAll('.pa-hours-time-input').forEach(input => {
              input.disabled = !e.target.checked;
            });
          }
        });
      });
    } catch (err) {
      wrap.innerHTML = `<div class="pa-alert pa-alert-error">Erro ao carregar: ${err.message}</div>`;
    }
  }

  async function handleSaveOperatingHours() {
    const spaceId = document.getElementById('adminHoursSpaceSelect')?.value;
    const feedback = document.getElementById('hoursSaveFeedback');
    if (!spaceId) return;

    const rows = document.querySelectorAll('.pa-hours-day-row');
    const upsertData = [];

    for (const row of rows) {
      const day = parseInt(row.getAttribute('data-day'), 10);
      const isOpen = row.querySelector('.pa-checkbox').checked;
      const openTime = row.querySelector('.pa-open-time').value || '07:00';
      const closeTime = row.querySelector('.pa-close-time').value || '21:00';

      if (isOpen && openTime >= closeTime) {
        const dayLabel = row.querySelector('.pa-hours-day-label')?.textContent || 'do dia selecionado';
        alert(`No dia ${dayLabel}, o horário de fechamento deve ser posterior ao de abertura.`);
        return;
      }

      upsertData.push({
        space_id: spaceId,
        day_of_week: day,
        is_open: isOpen,
        opening_time: openTime + ':00',
        closing_time: closeTime + ':00'
      });
    }

    const client = getSupabaseClient();
    if (!client) return;

    setLoading(true, 'Salvando horários da sala...');
    try {
      const { error } = await client
        .from('operating_hours')
        .upsert(upsertData, { onConflict: 'space_id,day_of_week' });

      if (error) {
        alert('Erro ao salvar horários: ' + error.message);
        return;
      }

      showToast('Horários da sala salvos com sucesso no banco!');
      if (feedback) {
        feedback.style.display = 'inline';
        feedback.textContent = 'Horários atualizados!';
        setTimeout(() => { feedback.style.display = 'none'; }, 4000);
      }

      await loadOperatingHours();
      if (state.selectedSpaceId === spaceId) {
        await refreshSchedule();
      }
    } catch (err) {
      console.error('[Espaço Ligia] Erro ao salvar horários:', err);
      alert('Erro inesperado ao salvar horários.');
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminBlocks() {
    const container = document.getElementById('adminBlocksList');
    if (!container) return;

    container.innerHTML = `
      <div class="pa-loading-indicator">
        <div class="pa-spinner"></div>
        <span>Carregando bloqueios...</span>
      </div>
    `;

    const client = getSupabaseClient();
    if (!client) return;

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
          spaces ( name )
        `)
        .order('start_time', { ascending: false });

      if (error) {
        container.innerHTML = `<div class="pa-alert pa-alert-error">Erro ao listar bloqueios: ${error.message}</div>`;
        return;
      }

      state.adminBlocks = data || [];
      renderAdminBlocks();
    } catch (err) {
      container.innerHTML = `<div class="pa-alert pa-alert-error">Erro de conexão ao carregar bloqueios.</div>`;
    }
  }

  function renderAdminBlocks() {
    const container = document.getElementById('adminBlocksList');
    if (!container) return;

    if (state.adminBlocks.length === 0) {
      container.innerHTML = `<div class="pa-empty-state"><p>Nenhum bloqueio cadastrado.</p></div>`;
      return;
    }

    let html = `<div class="pa-blocks-list">`;
    state.adminBlocks.forEach(block => {
      const spaceName = block.spaces?.name || 'Espaço';
      const dateStr = formatDateFromIsoSP(block.start_time);
      const timeStr = formatTimeRangeSP(block.start_time, block.end_time);

      html += `
        <div class="pa-block-card">
          <div class="pa-block-info">
            <strong>${escapeHtml(block.title)}</strong> (${escapeHtml(spaceName)})
            <div class="pa-block-time">${dateStr} · ${timeStr}</div>
            ${block.reason ? `<div class="pa-block-reason">Motivo: ${escapeHtml(block.reason)}</div>` : ''}
          </div>
          <button type="button" class="pa-btn pa-btn-outline pa-btn-sm btn-delete-block" data-id="${block.id}">
            Remover
          </button>
        </div>
      `;
    });
    html += `</div>`;
    container.innerHTML = html;

    container.querySelectorAll('.btn-delete-block').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const blockId = e.currentTarget.getAttribute('data-id');
        if (confirm('Deseja realmente remover este bloqueio?')) {
          await handleDeleteBlock(blockId);
        }
      });
    });
  }

  async function handleDeleteBlock(blockId) {
    const client = getSupabaseClient();
    if (!client) return;

    setLoading(true, 'Removendo bloqueio...');
    try {
      const { error } = await client.from('space_blocks').delete().eq('id', blockId);
      if (error) {
        alert('Erro ao excluir bloqueio: ' + error.message);
        return;
      }
      showToast('Bloqueio removido com sucesso!');
      await loadAdminBlocks();
      await refreshSchedule();
    } catch (err) {
      alert('Erro ao remover bloqueio.');
    } finally {
      setLoading(false);
    }
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
        if (error.code === '23P01' || error.message.includes('reservas confirmadas')) {
          alert('Não é possível criar o bloqueio: já existem reservas confirmadas no espaço para este período.');
        } else {
          alert('Erro ao criar bloqueio: ' + error.message);
        }
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

  async function loadAdminUsers() {
    const container = document.getElementById('adminUsersListContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="pa-loading-indicator">
        <div class="pa-spinner"></div>
        <span>Carregando profissionais cadastrados...</span>
      </div>
    `;

    const client = getSupabaseClient();
    if (!client) return;

    try {
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        container.innerHTML = `<div class="pa-alert pa-alert-error">Erro ao listar profissionais: ${error.message}</div>`;
        return;
      }

      if (!data || data.length === 0) {
        container.innerHTML = `<div class="pa-empty-state"><p>Nenhum profissional encontrado.</p></div>`;
        return;
      }

      let html = '<div class="pa-users-list">';
      data.forEach(user => {
        const isMe = user.id === state.session.user.id;
        const statusBadge = user.is_active 
          ? `<span class="pa-badge pa-badge-teal">Ativo</span>`
          : `<span class="pa-badge" style="background: #FEF3C7; color: #92400E;">Pendente / Inativo</span>`;
        const roleBadge = user.role === 'admin'
          ? `<span class="pa-badge" style="background: #123D63; color: #FFFFFF;">Administrador</span>`
          : `<span class="pa-badge" style="background: #E2E8F0; color: #334155;">Profissional</span>`;

        html += `
          <div class="pa-user-card">
            <div class="pa-user-card-info">
              <span class="pa-user-card-name">${escapeHtml(user.full_name)} ${isMe ? '(Você)' : ''}</span>
              <div class="pa-user-card-badges">
                ${statusBadge}
                ${roleBadge}
              </div>
            </div>
            <div class="pa-user-card-actions">
              ${!user.is_active ? `
                <button type="button" class="pa-btn-user-action activate" data-action="activate" data-id="${user.id}">
                  Aprovar / Ativar
                </button>
              ` : (!isMe ? `
                <button type="button" class="pa-btn-user-action deactivate" data-action="deactivate" data-id="${user.id}">
                  Desativar
                </button>
              ` : '')}
              ${!isMe ? (user.role === 'admin' ? `
                <button type="button" class="pa-btn-user-action" data-action="demote" data-id="${user.id}">
                  Tornar Profissional
                </button>
              ` : `
                <button type="button" class="pa-btn-user-action" data-action="promote" data-id="${user.id}">
                  Promover a Admin
                </button>
              `) : ''}
            </div>
          </div>
        `;
      });
      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll('.pa-btn-user-action').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const action = e.currentTarget.getAttribute('data-action');
          const id = e.currentTarget.getAttribute('data-id');
          if (action === 'activate') {
            await updateUserStatus(id, true);
          } else if (action === 'deactivate') {
            if (confirm('Deseja realmente desativar o acesso deste profissional?')) {
              await updateUserStatus(id, false);
            }
          } else if (action === 'promote') {
            if (confirm('Promover este profissional a Administrador?')) {
              await updateUserRole(id, 'admin');
            }
          } else if (action === 'demote') {
            if (confirm('Alterar o papel deste usuário para Profissional comum?')) {
              await updateUserRole(id, 'professional');
            }
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="pa-alert pa-alert-error">Erro: ${err.message}</div>`;
    }
  }

  async function updateUserStatus(userId, isActive) {
    const client = getSupabaseClient();
    if (!client) return;
    setLoading(true, 'Atualizando status do profissional...');
    try {
      const { error } = await client
        .from('profiles')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (error) {
        alert('Erro ao atualizar status: ' + error.message);
        return;
      }

      showToast(isActive ? 'Profissional aprovado e ativado!' : 'Profissional desativado.');
      await loadAdminUsers();
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateUserRole(userId, newRole) {
    const client = getSupabaseClient();
    if (!client) return;
    setLoading(true, 'Atualizando permissões...');
    try {
      const { error } = await client
        .from('profiles')
        .update({ role: newRole, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (error) {
        alert('Erro ao atualizar papel: ' + error.message);
        return;
      }

      showToast(`Papel alterado para ${newRole === 'admin' ? 'Administrador' : 'Profissional'}.`);
      await loadAdminUsers();
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------------------------------
  // NAVEGAÇÃO DE ABAS PRINCIPAIS
  // --------------------------------------------------------------------------

  function switchTab(tabName) {
    state.currentTab = tabName;
    const tabBtnSchedule = document.getElementById('tabBtnSchedule');
    const tabBtnMyReservations = document.getElementById('tabBtnMyReservations');
    const tabBtnAdmin = document.getElementById('tabBtnAdmin');

    const contentSchedule = document.getElementById('tabContentSchedule');
    const contentMyReservations = document.getElementById('tabContentMyReservations');
    const contentAdmin = document.getElementById('tabContentAdmin');

    if (tabBtnSchedule) {
      tabBtnSchedule.classList.toggle('active', tabName === 'schedule');
      tabBtnSchedule.setAttribute('aria-selected', tabName === 'schedule');
    }
    if (tabBtnMyReservations) {
      tabBtnMyReservations.classList.toggle('active', tabName === 'my_reservations');
      tabBtnMyReservations.setAttribute('aria-selected', tabName === 'my_reservations');
    }
    if (tabBtnAdmin) {
      tabBtnAdmin.classList.toggle('active', tabName === 'admin');
      tabBtnAdmin.setAttribute('aria-selected', tabName === 'admin');
    }

    if (contentSchedule) contentSchedule.style.display = tabName === 'schedule' ? 'block' : 'none';
    if (contentMyReservations) contentMyReservations.style.display = tabName === 'my_reservations' ? 'block' : 'none';
    if (contentAdmin) contentAdmin.style.display = tabName === 'admin' ? 'block' : 'none';

    if (tabName === 'schedule') {
      refreshSchedule();
    } else if (tabName === 'my_reservations') {
      loadMyReservations();
    } else if (tabName === 'admin') {
      switchAdminSubTab(state.adminSubTab || 'hours');
    }
  }

  // --------------------------------------------------------------------------
  // SUPABASE REALTIME: SINCRONIZAÇÃO EM TEMPO REAL ANÔNIMA E RESILIENTE
  // --------------------------------------------------------------------------

  function setupRealtime() {
    const client = getSupabaseClient();
    if (!client) return;

    unsubscribeRealtime();
    updateRealtimeStatus('connecting');

    try {
      state.realtimeChannel = client
        .channel('espaco-ligia-realtime-channel')
        // 1. Tabela anônima de revisões (notifica alterações de disponibilidade entre profissionais)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'availability_revisions' },
          (payload) => {
            console.log('[Espaço Ligia Realtime] Atualização de disponibilidade recebida:', payload);
            handleRealtimeEvent('availability_revisions', payload);
          }
        )
        // 2. Tabela de reservas (para atualizar "Minhas Reservas" do usuário)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'reservations' },
          (payload) => {
            handleRealtimeEvent('reservations', payload);
          }
        )
        // 3. Tabela de bloqueios
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'space_blocks' },
          (payload) => {
            handleRealtimeEvent('space_blocks', payload);
          }
        )
        // 4. Tabela de horários de funcionamento (recarrega agenda e horários)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'operating_hours' },
          (payload) => {
            handleRealtimeEvent('operating_hours', payload);
          }
        )
        // 5. Tabela de espaços (recarrega status ativo da sala)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'spaces' },
          (payload) => {
            handleRealtimeEvent('spaces', payload);
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
    if (!isModalOpen()) return;

    // Se horários ou salas mudarem, recarrega catálogo e horários
    if (table === 'operating_hours' || table === 'spaces') {
      loadSpaces()
        .then(() => loadOperatingHours())
        .then(() => {
          if (state.currentTab === 'schedule') {
            refreshSchedule(true);
          } else if (state.currentTab === 'admin' && state.adminSubTab === 'hours') {
            renderAdminHoursView();
          }
        });
      return;
    }

    // Se estiver na agenda, recarrega disponibilidade silenciosamente
    if (state.currentTab === 'schedule') {
      refreshSchedule(true);
    }

    // Se for reserva e estiver em Minhas Reservas, atualiza a lista
    if (table === 'reservations' && state.currentTab === 'my_reservations') {
      loadMyReservations();
    }

    // Se estiver na aba Admin e for bloqueio, atualiza lista de bloqueios
    if (table === 'space_blocks' && state.currentTab === 'admin' && state.adminSubTab === 'blocks') {
      loadAdminBlocks();
    }
  }

  function updateRealtimeStatus(status) {
    state.realtimeStatus = status;
    const badge = document.getElementById('paRealtimeBadge');
    if (!badge) return;

    if (status === 'connected') {
      badge.innerHTML = `<span class="pa-dot pa-dot-live"></span> Ao Vivo`;
      badge.className = 'pa-realtime-badge pa-rt-live';
    } else if (status === 'connecting') {
      badge.innerHTML = `<span class="pa-dot pa-dot-connecting"></span> Conectando...`;
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

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --------------------------------------------------------------------------
  // INICIALIZAÇÃO E BINDING DE EVENTOS
  // --------------------------------------------------------------------------

  function initPrivateArea() {
    // Gatilhos com [data-open-private-area] e id="btnOpenPrivateArea" (sem duplicações)
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-private-area], #btnOpenPrivateArea');
      if (trigger) {
        e.preventDefault();
        openPrivateArea(trigger);
        return;
      }

      const closeTrigger = e.target.closest('#btnClosePrivateArea, .btn-close-pa-panel');
      if (closeTrigger) {
        e.preventDefault();
        closePrivateArea();
        return;
      }
    });

    document.getElementById('privateAreaBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'privateAreaBackdrop' || e.target.id === 'privateAreaModal') {
        closePrivateArea();
      }
    });

    // Tecla ESC para fechar
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isModalOpen()) {
        const drawer = document.getElementById('bookingModalDrawer');
        if (drawer && !drawer.hidden && drawer.style.display !== 'none') {
          closeBookingModal();
        } else {
          closePrivateArea();
        }
      }
    });

    // Formulários de autenticação
    const loginForm = document.getElementById('paLoginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', handleLoginSubmit);
    }

    const forgotForm = document.getElementById('paForgotPasswordForm');
    if (forgotForm) {
      forgotForm.addEventListener('submit', handleForgotPasswordSubmit);
    }

    document.getElementById('btnGoToForgotPassword')?.addEventListener('click', (e) => {
      e.preventDefault();
      clearAuthMessages();
      showPanel('panelForgotPassword');
    });

    document.getElementById('btnBackToLogin')?.addEventListener('click', (e) => {
      e.preventDefault();
      clearAuthMessages();
      showPanel('panelLogin');
    });

    document.getElementById('btnLogoutPA')?.addEventListener('click', handleLogout);

    // Navegação de abas do dashboard
    document.getElementById('tabBtnSchedule')?.addEventListener('click', () => switchTab('schedule'));
    document.getElementById('tabBtnMyReservations')?.addEventListener('click', () => switchTab('my_reservations'));
    document.getElementById('tabBtnAdmin')?.addEventListener('click', () => switchTab('admin'));

    // Botão de refresh na agenda
    document.getElementById('btnRefreshSchedule')?.addEventListener('click', () => refreshSchedule(false));

    // Controles de data e administração
    initDateControls();
    initAdminTabs();

    // Formulário de reserva
    const bookingForm = document.getElementById('bookingConfirmForm');
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

    // Resiliência de Conexão: Atualiza ao retornar para a aba ou restabelecer internet
    window.addEventListener('focus', () => {
      if (isModalOpen() && state.currentTab === 'schedule') {
        refreshSchedule(true);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isModalOpen() && state.currentTab === 'schedule') {
        refreshSchedule(true);
      }
    });

    window.addEventListener('online', () => {
      setupRealtime();
      refreshSchedule(true);
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
