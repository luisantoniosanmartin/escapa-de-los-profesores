/* Archivo de compatibilidad: el music.js original no venía incluido en los archivos enviados.
   Este reemplazo evita errores, pero no reproduce música. Sustitúyelo por el original si lo tienes. */
window.ChaseMusic = (() => {
  let muted = false;
  return {
    update() {}, unlock() {}, reset() {}, stop() {}, pause() {}, resume() {},
    isMuted() { return muted; },
    toggleMuted() { muted = !muted; return muted; }
  };
})();
