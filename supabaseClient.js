/**
 * ============================================================
 * supabaseClient.js — Inicialização do Supabase
 * ============================================================
 *
 * Este arquivo configura a conexão com o Supabase.
 * Importado pelo authService.js e pelo app principal.
 *
 * IMPORTANTE: Este app DEVE ser servido via HTTP (localhost:8899)
 * e NÃO pelo protocolo file://. Fetch requests falham em file://.
 * ============================================================
 */

// --- Credenciais do projeto Supabase (sa-east-1 / São Paulo) ---
const SUPABASE_URL = 'https://mfxbmnkkggkvmfijdsis.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1meGJtbmtrZ2drdm1maWpkc2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNzA2NDcsImV4cCI6MjA5MDg0NjY0N30.NwUM92SAjpnJ1vD1Nzjk6G-suZLbzdqkmeQrcw15ywk';

// --- URL do app (para redirects de e-mail/reset) ---
const APP_URL = (window.location.protocol.startsWith('file'))
  ? 'http://localhost:8899/receitas-sem-gluten-app.html'
  : window.location.origin + window.location.pathname;

/**
 * Inicializa o cliente Supabase.
 * Retorna null se a lib não carregou (CDN offline, file://, etc.)
 */
function initSupabase() {
  if (typeof supabase === 'undefined') {
    console.error('[supabaseClient] Supabase JS lib não encontrada. Verifique o CDN.');
    return null;
  }
  try {
    const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Persiste sessão no localStorage do browser
        persistSession: true,
        // Detecta sessão automaticamente na URL (ex: após confirmar e-mail)
        detectSessionInUrl: true,
        // Storage padrão (localStorage)
        storage: window.localStorage,
        // Auto-refresh do token antes de expirar
        autoRefreshToken: true,
      }
    });
    console.log('[supabaseClient] Cliente inicializado com sucesso');
    return client;
  } catch (err) {
    console.error('[supabaseClient] Erro ao inicializar:', err);
    return null;
  }
}

/**
 * Testa se o Supabase está acessível fazendo uma request leve.
 * Útil para detectar problemas de rede antes do usuário tentar logar.
 *
 * @param {object} sb - Cliente Supabase
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function testConnection(sb) {
  if (!sb) return { ok: false, error: 'Cliente Supabase não inicializado' };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(SUPABASE_URL + '/rest/v1/', {
      method: 'HEAD',
      headers: { 'apikey': SUPABASE_ANON_KEY },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { ok: res.ok || res.status === 200 || res.status === 404 };
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'Timeout — servidor não respondeu em 5s'
      : 'Sem conexão com o servidor Supabase';
    return { ok: false, error: msg };
  }
}

// Exporta globalmente (para uso em scripts não-module)
window.SupabaseClient = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  APP_URL,
  initSupabase,
  testConnection,
};
