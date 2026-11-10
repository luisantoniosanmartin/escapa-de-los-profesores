/* Acceso mediante nickname + contraseña y sincronización de progreso con Supabase.
   Se usa un correo interno técnico generado desde el nickname porque Supabase Auth
   requiere un identificador tipo email para signInWithPassword. El jugador nunca lo ve.
*/
(() => {
  'use strict';
  const SUPABASE_URL = 'https://knfinafzdksyltljzcgo.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aHoNGEdF9ZxizYyJQjb9BQ_0a1O0E79';
  const SAVE_KEY = 'escapaProfesores.progreso.v1';
  const TABLE = 'player_progress';
  const $ = id => document.getElementById(id);
  const gate = $('account-gate'), form = $('auth-form');
  const nickname = $('auth-nickname'), password = $('auth-password');
  const message = $('auth-message'), submit = $('auth-submit'), toggle = $('auth-toggle');
  const accountBar = $('account-bar'), accountName = $('account-name');
  if (!form || !nickname || !password || !message || !submit || !toggle) {
    console.error('Faltan elementos del formulario de acceso en index.html');
    return;
  }
  let client = null, currentUser = null, signupMode = false, saveTimer = null;
  let lastSavedJson = null, scriptsStarted = false, syncInterval = null;
  function say(text) { message.textContent = text; }
  function cleanNick(value) { return value.trim().toLowerCase(); }
  // Dirección técnica no visible. Requiere desactivar la confirmación de email en Supabase.
  function internalEmail(value) { return cleanNick(value) + '@players.escapaprofesores.com'; }
  function loadGame() {
    if (scriptsStarted) return;
    scriptsStarted = true;
    const files = ['js/data.js', 'js/music.js', 'js/game.js'];
    const next = i => {
      if (i >= files.length) return;
      const script = document.createElement('script'); script.src = files[i];
      script.onload = () => next(i + 1);
      script.onerror = () => {
        console.error('No se pudo cargar ' + files[i]);
        if (files[i] === 'js/music.js') next(i + 1);
        else say('No se pudo cargar ' + files[i] + '. Comprueba que el archivo exista en GitHub.');
      };
      document.body.appendChild(script);
    };
    next(0);
  }
  async function getCloudProgress(userId) {
    const { data, error } = await client.from(TABLE).select('progress').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data ? data.progress : null;
  }
  async function saveCloudProgress() {
    if (!client || !currentUser) return;
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw || raw === lastSavedJson) return;
    let progress;
    try { progress = JSON.parse(raw); } catch (e) { console.warn('Progreso local no válido', e); return; }
    const name = currentUser.user_metadata?.username || 'Jugador';
    const { error } = await client.from(TABLE).upsert({
      user_id: currentUser.id, username: name, progress, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) { console.error('Error guardando progreso:', error); say('No se pudo sincronizar el progreso. Revisa la tabla y RLS.'); return; }
    lastSavedJson = raw; say('Progreso sincronizado.');
  }
  function queueSave() {
    if (!currentUser) return;
    clearTimeout(saveTimer); saveTimer = setTimeout(() => saveCloudProgress().catch(console.error), 900);
  }
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);
    if (key === SAVE_KEY) queueSave();
  };
  async function enterGame(user) {
    currentUser = user; say('Cargando tu progreso...');
    try {
      const cloud = await getCloudProgress(user.id);
      const local = localStorage.getItem(SAVE_KEY);
      if (cloud !== null) {
        const json = JSON.stringify(cloud); originalSetItem.call(localStorage, SAVE_KEY, json); lastSavedJson = json;
      } else if (local) { lastSavedJson = null; await saveCloudProgress(); }
    } catch (err) {
      console.error(err); currentUser = null;
      say('No se pudo leer la base de datos. Ejecuta las consultas SQL y revisa RLS.'); return;
    }
    gate.hidden = true; accountBar.hidden = false;
    accountName.textContent = user.user_metadata?.username || 'Jugador';
    loadGame();
    if (!syncInterval) syncInterval = setInterval(() => saveCloudProgress().catch(console.error), 4000);
  }
  async function init() {
    if (!window.supabase) { say('No se pudo cargar Supabase. Comprueba tu conexión.'); return; }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const { data, error } = await client.auth.getSession();
    if (error) say(error.message);
    if (data.session?.user) await enterGame(data.session.user);
  }
  // El botón secundario SOLO cambia entre los modos de acceso.
  // El botón principal ejecuta el registro o el inicio de sesión.
  function changeAuthMode() {
    signupMode = !signupMode;
    submit.textContent = signupMode ? 'Crear cuenta' : 'Iniciar sesión';
    toggle.textContent = signupMode ? 'Ya tengo cuenta' : 'No tengo cuenta';
    password.autocomplete = signupMode ? 'new-password' : 'current-password';
    const description = $('auth-description');
    if (description) description.textContent = signupMode
      ? 'Elige un nickname y una contraseña para crear tu cuenta.'
      : 'Inicia sesión con tu nickname y contraseña para recuperar tu progreso.';
    say(signupMode ? 'Modo de registro activado. Completa los datos y pulsa «Crear cuenta».' : 'Modo de inicio de sesión.');
  }
  if (toggle) {
    toggle.type = 'button';
    // Asignación directa para que el clic quede enlazado explícitamente.
    toggle.onclick = changeAuthMode;
  } else {
    console.error('No se encontró el botón #auth-toggle');
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) { say('No se pudo conectar con Supabase.'); return; }
    const nick = nickname.value.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(nick)) { say('El nickname debe tener entre 3 y 20 caracteres: letras, números o _.'); return; }
    if (password.value.length < 8) { say('La contraseña debe tener al menos 8 caracteres.'); return; }
    submit.disabled = true; say(signupMode ? 'Creando cuenta...' : 'Iniciando sesión...');
    try {
      let result;
      if (signupMode) {
        result = await client.auth.signUp({
          email: internalEmail(nick), password: password.value,
          options: { data: { username: nick } }
        });
        if (result.error) {
          console.error('Supabase signup error:', result.error);
          const raw = result.error.message || '';
          if (/already registered|already exists|duplicate/i.test(raw)) throw new Error('Ese nickname ya está registrado. Prueba con otro.');
          if (/invalid email/i.test(raw)) throw new Error('Supabase rechazó el identificador interno. Verifica que el proveedor Email esté ACTIVADO en Authentication > Sign In / Providers.');
          throw result.error;
        }
        if (!result.data.session) throw new Error('La cuenta se creó, pero Supabase no inició sesión. Mantén Email ACTIVADO y desactiva Confirm email en Authentication > Sign In / Providers > Email.');
      } else {
        result = await client.auth.signInWithPassword({ email: internalEmail(nick), password: password.value });
        if (result.error) throw new Error('Nickname o contraseña incorrectos.');
      }
      if (result.data.user) await enterGame(result.data.user);
    } catch (err) {
      const msg = err.message || 'No se pudo completar el acceso.';
      console.error('Error de acceso:', err);
      say(msg.includes('duplicate') || msg.includes('already') ? 'Ese nickname ya está ocupado. Prueba con otro.' : msg);
    } finally { submit.disabled = false; }
  });
  $('auth-logout').addEventListener('click', async () => {
    await saveCloudProgress().catch(console.error);
    const { error } = await client.auth.signOut();
    if (error) { say(error.message); return; }
    location.reload();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveCloudProgress().catch(console.error); });
  window.addEventListener('pagehide', () => saveCloudProgress().catch(console.error));
  init();
})();
