/**
 * ============================================================
 * authService.js — Serviço completo de autenticação
 * ============================================================
 *
 * Todas as funções de auth em um lugar:
 *   - signUp (criar conta)
 *   - signIn (login com email/senha)
 *   - signOut (logout)
 *   - getSession (sessão atual)
 *   - resetPassword (recuperar senha)
 *   - onAuthChange (listener de mudança de estado)
 *   - getProfile / updateProfile (perfil do usuário)
 *
 * Cada função retorna { success, data?, error? } padronizado.
 * ============================================================
 */

const AuthService = (function () {
  let _sb = null;       // cliente Supabase
  let _user = null;     // usuário logado
  let _profile = null;  // perfil da tabela profiles

  // ─── INICIALIZAÇÃO ────────────────────────────────────

  /**
   * Inicializa o serviço com o cliente Supabase.
   * Deve ser chamado uma vez no carregamento do app.
   */
  function init(supabaseClient) {
    _sb = supabaseClient;
    if (!_sb) console.warn('[AuthService] Inicializado sem cliente Supabase');
  }

  // ─── HELPERS DE ERRO ─────────────────────────────────

  /**
   * Traduz erros do Supabase para mensagens amigáveis em PT-BR.
   * Cobre TODOS os erros comuns de auth.
   */
  function _translateError(error) {
    if (!error) return 'Erro desconhecido';
    const msg = (error.message || '').toLowerCase();
    const code = error.code || error.status || '';

    // --- Erros de rede ---
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('fetch'))
      return 'Sem conexão com o servidor. Certifique-se de abrir o app via http://localhost:8899 (não como arquivo direto).';

    if (msg.includes('timeout') || msg.includes('aborted'))
      return 'Servidor não respondeu. Verifique sua internet.';

    // --- Erros de signup ---
    if (msg.includes('already registered') || msg.includes('user already registered'))
      return 'Este e-mail já possui uma conta. Use a aba "Entrar".';

    if (msg.includes('password') && (msg.includes('least') || msg.includes('short') || msg.includes('weak')))
      return 'Senha muito fraca. Use pelo menos 6 caracteres com letras e números.';

    if (msg.includes('valid email') || msg.includes('invalid email') || msg.includes('unable to validate'))
      return 'Endereço de e-mail inválido.';

    if (msg.includes('signup') && msg.includes('disabled'))
      return 'Cadastro de novos usuários está desabilitado.';

    // --- Erros de login ---
    if (msg.includes('invalid login') || msg.includes('invalid_credentials') || msg.includes('wrong password'))
      return 'E-mail ou senha incorretos.';

    if (msg.includes('email not confirmed'))
      return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';

    if (msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('429'))
      return 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.';

    if (msg.includes('user not found'))
      return 'Nenhuma conta encontrada com este e-mail.';

    if (msg.includes('user banned') || msg.includes('banned'))
      return 'Esta conta foi suspensa. Entre em contato com o suporte.';

    // --- Erros de sessão ---
    if (msg.includes('refresh_token') || msg.includes('session expired') || msg.includes('not authenticated'))
      return 'Sua sessão expirou. Faça login novamente.';

    // --- Erros de rede genéricos ---
    if (msg.includes('network') || msg.includes('connection'))
      return 'Erro de conexão. Verifique sua internet.';

    // --- Fallback: retorna a mensagem original ---
    return error.message || 'Erro inesperado. Tente novamente.';
  }

  // ─── SIGNUP (CRIAR CONTA) ────────────────────────────

  /**
   * Cria uma nova conta com e-mail e senha.
   *
   * @param {string} email       - E-mail do usuário
   * @param {string} password    - Senha (mínimo 6 caracteres)
   * @param {object} metadata    - Dados extras: { full_name, ... }
   * @returns {Promise<{success, data?, error?, needsConfirmation?}>}
   *
   * IMPORTANTE:
   * - Se "Confirm email" estiver ativado no dashboard do Supabase,
   *   o usuário receberá um e-mail de confirmação e 'needsConfirmation' será true.
   * - Se estiver desativado, o usuário já entra logado direto.
   */
  async function signUp(email, password, metadata = {}) {
    if (!_sb) return { success: false, error: 'Servidor não conectado. Abra via http://localhost:8899' };

    // Validação local (antes de chamar a API)
    if (!email || !email.trim()) return { success: false, error: 'Informe seu e-mail.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
      return { success: false, error: 'E-mail inválido.' };
    if (!password) return { success: false, error: 'Crie uma senha.' };
    if (password.length < 6) return { success: false, error: 'Senha muito curta — mínimo 6 caracteres.' };

    try {
      const { data, error } = await _sb.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          data: metadata,  // { full_name: "João Silva" }
          emailRedirectTo: window.SupabaseClient?.APP_URL || window.location.href,
        }
      });

      if (error) return { success: false, error: _translateError(error) };

      const user = data?.user;
      const session = data?.session;

      // Detectar se precisa confirmar e-mail
      // Quando email confirmation está ON: user existe mas session é null
      const needsConfirmation = user && !session;

      if (needsConfirmation) {
        return {
          success: true,
          needsConfirmation: true,
          email: email.trim(),
          data: { user }
        };
      }

      // Email confirmation OFF — usuário já está logado
      _user = user;

      // Inserir/atualizar perfil na tabela profiles
      if (user) {
        await _ensureProfile(user, metadata);
      }

      return { success: true, needsConfirmation: false, data: { user, session } };

    } catch (err) {
      console.error('[AuthService.signUp] Exception:', err);
      return { success: false, error: _translateError(err) };
    }
  }

  // ─── SIGN IN (LOGIN) ─────────────────────────────────

  /**
   * Login com e-mail e senha.
   *
   * @param {string} email    - E-mail cadastrado
   * @param {string} password - Senha
   * @returns {Promise<{success, data?, error?}>}
   */
  async function signIn(email, password) {
    if (!_sb) return { success: false, error: 'Servidor não conectado. Abra via http://localhost:8899' };

    if (!email || !email.trim()) return { success: false, error: 'Informe seu e-mail.' };
    if (!password) return { success: false, error: 'Informe sua senha.' };

    try {
      const { data, error } = await _sb.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (error) return { success: false, error: _translateError(error) };

      _user = data?.user;
      const session = data?.session;

      // Carregar perfil
      if (_user) {
        await _loadProfile(_user.id);
      }

      return { success: true, data: { user: _user, session, profile: _profile } };

    } catch (err) {
      console.error('[AuthService.signIn] Exception:', err);
      return { success: false, error: _translateError(err) };
    }
  }

  // ─── SIGN OUT (LOGOUT) ───────────────────────────────

  /**
   * Faz logout do usuário e limpa o estado.
   */
  async function signOut() {
    if (!_sb) return { success: false, error: 'Servidor não conectado' };

    try {
      const { error } = await _sb.auth.signOut();
      _user = null;
      _profile = null;
      if (error) return { success: false, error: _translateError(error) };
      return { success: true };
    } catch (err) {
      // Mesmo com erro, limpa estado local
      _user = null;
      _profile = null;
      return { success: false, error: _translateError(err) };
    }
  }

  // ─── SESSÃO PERSISTENTE ──────────────────────────────

  /**
   * Verifica se já existe sessão ativa.
   * Chame no carregamento do app para auto-login.
   *
   * @returns {Promise<{loggedIn: boolean, user?, profile?, session?}>}
   */
  async function getSession() {
    if (!_sb) return { loggedIn: false };

    try {
      const { data: { session }, error } = await _sb.auth.getSession();

      if (error || !session || !session.user) {
        return { loggedIn: false };
      }

      // Verificar se e-mail foi confirmado (quando confirmation está ON)
      if (!session.user.email_confirmed_at) {
        return { loggedIn: false, reason: 'email_not_confirmed' };
      }

      _user = session.user;
      await _loadProfile(_user.id);

      return {
        loggedIn: true,
        user: _user,
        profile: _profile,
        session: session,
      };

    } catch (err) {
      console.warn('[AuthService.getSession] Error:', err);
      return { loggedIn: false };
    }
  }

  /**
   * Registra um listener para mudanças de estado de auth.
   * Eventos: SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, etc.
   *
   * @param {function} callback - Função (event, session) => void
   * @returns {object|null} - subscription (chamar .unsubscribe() para remover)
   */
  function onAuthChange(callback) {
    if (!_sb) return null;

    const { data: { subscription } } = _sb.auth.onAuthStateChange(async (event, session) => {
      console.log('[AuthService] Auth event:', event);

      if (event === 'SIGNED_IN' && session?.user) {
        _user = session.user;
        await _loadProfile(_user.id);
      } else if (event === 'SIGNED_OUT') {
        _user = null;
        _profile = null;
      }

      callback(event, session);
    });

    return subscription;
  }

  // ─── RECUPERAÇÃO DE SENHA ────────────────────────────

  /**
   * Envia e-mail de recuperação de senha.
   *
   * @param {string} email - E-mail da conta
   * @returns {Promise<{success, error?}>}
   */
  async function resetPassword(email) {
    if (!_sb) return { success: false, error: 'Servidor não conectado' };
    if (!email || !email.trim()) return { success: false, error: 'Informe seu e-mail.' };

    try {
      const { error } = await _sb.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.SupabaseClient?.APP_URL || window.location.href,
      });

      if (error) return { success: false, error: _translateError(error) };
      return { success: true };

    } catch (err) {
      return { success: false, error: _translateError(err) };
    }
  }

  /**
   * Reenviar e-mail de confirmação (quando confirmation está ON).
   */
  async function resendConfirmation(email) {
    if (!_sb) return { success: false, error: 'Servidor não conectado' };

    try {
      const { error } = await _sb.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: window.SupabaseClient?.APP_URL || window.location.href }
      });
      if (error) return { success: false, error: _translateError(error) };
      return { success: true };
    } catch (err) {
      return { success: false, error: _translateError(err) };
    }
  }

  // ─── PERFIL DO USUÁRIO ───────────────────────────────

  /**
   * Garante que o perfil existe na tabela 'profiles'.
   * Chamado internamente após signup.
   */
  async function _ensureProfile(user, metadata) {
    if (!_sb || !user) return;

    try {
      // Tenta carregar perfil existente (trigger pode já ter criado)
      const { data: existing } = await _sb.from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();

      if (!existing) {
        // Inserir novo perfil
        await _sb.from('profiles').insert({
          id: user.id,
          name: metadata.full_name || user.email?.split('@')[0] || 'Usuário',
          username: user.email?.split('@')[0]?.replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
        });
      } else if (metadata.full_name) {
        // Atualizar nome se o perfil já existia (criado por trigger)
        await _sb.from('profiles').update({
          name: metadata.full_name,
        }).eq('id', user.id);
      }

      await _loadProfile(user.id);
    } catch (err) {
      console.warn('[AuthService._ensureProfile] Error:', err);
    }
  }

  /**
   * Carrega perfil da tabela 'profiles'.
   */
  async function _loadProfile(userId) {
    if (!_sb || !userId) return;

    try {
      const { data, error } = await _sb.from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (!error && data) _profile = data;
    } catch (err) {
      console.warn('[AuthService._loadProfile] Error:', err);
    }
  }

  /**
   * Retorna o perfil atual (do cache).
   */
  function getProfile() {
    return _profile;
  }

  /**
   * Atualiza campos do perfil do usuário logado.
   * @param {object} fields - { name, bio, avatar_url, ... }
   */
  async function updateProfile(fields) {
    if (!_sb || !_user) return { success: false, error: 'Não logado' };

    try {
      const { data, error } = await _sb.from('profiles')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', _user.id)
        .select()
        .single();

      if (error) return { success: false, error: _translateError(error) };
      _profile = data;
      return { success: true, data };
    } catch (err) {
      return { success: false, error: _translateError(err) };
    }
  }

  // ─── GETTERS ─────────────────────────────────────────

  function getUser() { return _user; }
  function isLoggedIn() { return !!_user; }

  // ─── API PÚBLICA ─────────────────────────────────────

  return {
    init,
    signUp,
    signIn,
    signOut,
    getSession,
    onAuthChange,
    resetPassword,
    resendConfirmation,
    getUser,
    getProfile,
    updateProfile,
    isLoggedIn,
  };

})();

// Exporta globalmente
window.AuthService = AuthService;
