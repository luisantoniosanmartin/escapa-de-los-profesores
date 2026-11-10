/* ============================================================================
   MUSICA DE PERSECUCION
   Un tema procedural distinto para cada profesor. No usa archivos de audio:
   todo se genera con Web Audio y se activa cuando un profesor persigue al
   jugador (o cuando el jugador profesor persigue a un alumno).
   ============================================================================ */
(function () {
  'use strict';

  const STORAGE_KEY = 'escapaProfesores.audio.v1';
  const THEME_IDS = ['jose', 'ovidio', 'segundo'];
  const THEME_META = {
    jose: { name: 'Rojas', short: 'La agenda', color: '#ff5d5d' },
    ovidio: { name: 'Cáceres', short: 'El grito', color: '#e35d8a' },
    segundo: { name: 'Quispe', short: 'El peine regla', color: '#c77dff' }
  };

  let ac = null;
  let master = null;
  let compressor = null;
  let noiseBuffer = null;
  let timer = null;
  let suspendTimer = null;
  let muted = false;
  let activeId = null;
  let lastIntensity = -1;
  let lastUpdateAt = 0;
  const themes = {};

  try {
    muted = localStorage.getItem(STORAGE_KEY) === 'off';
  } catch (e) {
    muted = false;
  }

  function clamp01(v) {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  function persistMute() {
    try { localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on'); } catch (e) {}
  }

  function midi(n) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  function createNoise() {
    const len = Math.max(1, Math.floor(ac.sampleRate * 1.2));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function ramp(param, value, seconds) {
    if (!ac) return;
    const now = ac.currentTime;
    try {
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
      else {
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
      }
    } catch (e) {}
    param.linearRampToValueAtTime(value, now + seconds);
  }

  function makeTheme(id) {
    const bus = ac.createGain();
    const tone = ac.createGain();
    const filter = ac.createBiquadFilter();
    bus.gain.value = 0;
    tone.gain.value = 1;
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.9;
    tone.connect(filter);
    filter.connect(bus);
    bus.connect(master);
    return {
      id, bus, tone, filter,
      step: 0, nextTime: 0, tailUntil: 0,
      on: false, level: 0
    };
  }

  function ensureContext() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume().catch(function () {});
      return true;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return false;
    try {
      ac = new AudioCtor();
      compressor = ac.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 7;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.24;

      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.68;
      master.connect(compressor);
      compressor.connect(ac.destination);

      noiseBuffer = createNoise();
      for (const id of THEME_IDS) themes[id] = makeTheme(id);
      startTimer();
      return true;
    } catch (e) {
      ac = null;
      master = null;
      return false;
    }
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(scheduler, 40);
  }

  function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function suspendSoon() {
    if (!ac || suspendTimer) return;
    suspendTimer = setTimeout(function () {
      suspendTimer = null;
      if (activeId || !ac || ac.state !== 'running') return;
      ac.suspend().catch(function () {});
      stopTimer();
    }, 900);
  }

  function resumeContext() {
    if (!ac) return;
    if (suspendTimer) {
      clearTimeout(suspendTimer);
      suspendTimer = null;
    }
    if (ac.state === 'suspended') ac.resume().catch(function () {});
    startTimer();
  }

  /* ----------------------------- instrumentos ----------------------------- */

  function envelope(gain, time, peak, attack, release) {
    const a = attack || 0.008;
    const d = release || 0.18;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + a + d);
    return a + d;
  }

  function note(dest, time, freq, dur, peak, type, opts) {
    opts = opts || {};
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type || 'sawtooth';
    osc.frequency.setValueAtTime(Math.max(20, freq), time);
    if (opts.glideTo) {
      const glideEnd = time + Math.max(0.03, dur * (opts.glideAt === undefined ? 0.65 : opts.glideAt));
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.glideTo), glideEnd);
    }
    if (opts.detune) osc.detune.value = opts.detune;
    const total = envelope(g, time, peak, opts.attack, dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + total + 0.03);
    osc.onended = function () {
      try { osc.disconnect(); g.disconnect(); } catch (e) {}
    };
  }

  function noise(dest, time, dur, peak, hp, type) {
    if (!noiseBuffer) return;
    const src = ac.createBufferSource();
    const filter = ac.createBiquadFilter();
    const g = ac.createGain();
    src.buffer = noiseBuffer;
    filter.type = type || 'highpass';
    filter.frequency.setValueAtTime(hp || 1400, time);
    const total = envelope(g, time, peak, 0.004, dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start(time);
    src.stop(time + total + 0.03);
    src.onended = function () {
      try { src.disconnect(); filter.disconnect(); g.disconnect(); } catch (e) {}
    };
  }

  function kick(th, time, peak) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(155, time);
    osc.frequency.exponentialRampToValueAtTime(43, time + 0.16);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
    osc.connect(g);
    g.connect(th.bus);
    osc.start(time);
    osc.stop(time + 0.28);
    osc.onended = function () {
      try { osc.disconnect(); g.disconnect(); } catch (e) {}
    };
  }

  function snare(th, time, peak, body) {
    noise(th.bus, time, 0.13, peak, 1500, 'highpass');
    if (body !== false) {
      note(th.bus, time, 180, 0.09, peak * 0.32, 'triangle', { attack: 0.002 });
    }
  }

  function clap(th, time, peak) {
    noise(th.bus, time, 0.10, peak, 900, 'bandpass');
    noise(th.bus, time + 0.045, 0.09, peak * 0.65, 1200, 'bandpass');
  }

  function hat(th, time, peak, open) {
    noise(th.bus, time, open ? 0.10 : 0.032, peak, open ? 6000 : 7500, 'highpass');
  }

  function click(th, time, peak, freq) {
    note(th.bus, time, freq || 1500, 0.024, peak, 'square', { attack: 0.001 });
  }

  function bass(th, time, midiNote, dur, peak) {
    note(th.tone, time, midi(midiNote), dur, peak, 'triangle', { attack: 0.012, detune: -2 });
  }

  function lead(th, time, midiNote, dur, peak, type) {
    note(th.tone, time, midi(midiNote), dur, peak, type || 'square', { attack: 0.006 });
  }

  function siren(th, time, dur, peak) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const lfo = ac.createOscillator();
    const lfoGain = ac.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(230, time);
    osc.frequency.exponentialRampToValueAtTime(820, time + dur * 0.42);
    osc.frequency.exponentialRampToValueAtTime(285, time + dur);
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(5.8, time);
    lfoGain.gain.setValueAtTime(20, time);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.34);
    g.gain.setValueAtTime(peak, time + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(th.tone);
    osc.start(time);
    lfo.start(time);
    osc.stop(time + dur + 0.04);
    lfo.stop(time + dur + 0.04);
    osc.onended = function () {
      try {
        osc.disconnect(); g.disconnect();
        lfo.disconnect(); lfoGain.disconnect();
      } catch (e) {}
    };
  }

  function pad(th, time, notes, dur, peak) {
    for (const n of notes) {
      note(th.tone, time, midi(n), dur, peak, 'sine', { attack: 0.42 });
    }
  }

  function combScrape(th, time, peak) {
    noise(th.bus, time, 0.075, peak, 3200, 'bandpass');
    note(th.bus, time, 2100, 0.07, peak * 0.55, 'triangle', {
      attack: 0.002, glideTo: 430, glideAt: 0.9
    });
  }

  /* ------------------------------- patrones ------------------------------- */

  function joseStep(th, time, step) {
    const s = step % 16;
    const loop = step % 32;

    if (s === 0 || s === 3 || s === 8 || s === 11 || s === 14) {
      kick(th, time, s === 0 ? 0.42 : 0.30);
    }
    if (s === 4 || s === 12) snare(th, time, 0.24);
    if ((s & 1) === 0) hat(th, time, s % 4 === 0 ? 0.050 : 0.030);
    if (s === 2 || s === 6 || s === 10 || s === 14) click(th, time, 0.055, 1480);

    if ((s & 1) === 0) {
      const bassLine = [38, 38, 41, 38, 43, 41, 38, 36];
      bass(th, time, bassLine[(step >> 1) % bassLine.length], 0.17, 0.19);
    }

    const leadLine = {
      0: 62, 3: 65, 6: 69, 10: 65, 14: 62,
      16: 60, 19: 63, 22: 67, 26: 70, 30: 67
    };
    if (leadLine[loop]) lead(th, time, leadLine[loop], 0.13, 0.072, 'square');

    if (loop === 0) {
      pad(th, time, [50, 53, 57], 0.55, 0.022);
    }
  }

  function ovidioStep(th, time, step) {
    const s = step % 16;
    const loop = step % 32;
    const bar = Math.floor(step / 16) % 4;

    if (s === 0 || s === 6 || s === 8 || s === 14) kick(th, time, 0.33);
    if (s === 4 || s === 12) clap(th, time, 0.23);
    if (s === 2 || s === 6 || s === 10 || s === 14) hat(th, time, 0.028);

    if (s === 0) {
      const roots = [38, 34, 36, 33];
      bass(th, time, roots[bar], 1.05, 0.20);
    }
    if (s === 8) bass(th, time, 45, 0.45, 0.10);

    if (loop === 0) {
      siren(th, time, 1.85, 0.100);
      pad(th, time, [50, 53, 57, 62], 2.20, 0.018);
    }

    const leadLine = {
      0: 62, 4: 65, 7: 63, 11: 69,
      16: 62, 20: 65, 23: 70, 27: 69
    };
    if (leadLine[loop]) lead(th, time, leadLine[loop], 0.32, 0.055, 'triangle');
  }

  function segundoStep(th, time, step) {
    const s = step % 16;

    if (s === 0 || s === 4 || s === 8 || s === 12) kick(th, time, 0.36);
    if (s === 4 || s === 12) snare(th, time, 0.23);
    if ((s & 1) === 0) hat(th, time, s % 4 === 0 ? 0.042 : 0.026);
    if (s % 4 === 2) click(th, time, 0.045, 2100);

    const bassLine = [38, 38, 41, 38, 43, 38, 46, 43, 38, 38, 41, 38, 45, 43, 41, 38];
    bass(th, time, bassLine[s], 0.075, 0.145);

    const arp = [74, 77, 81, 77, 74, 72, 69, 72, 74, 77, 82, 81, 77, 74, 72, 69];
    if ((s & 1) === 0) lead(th, time, arp[s], 0.075, 0.047, 'triangle');
    if (s === 7 || s === 15) combScrape(th, time, 0.095);
  }

  function scheduleStep(th, stepIndex, time) {
    if (th.id === 'jose') joseStep(th, time, stepIndex);
    else if (th.id === 'ovidio') ovidioStep(th, time, stepIndex);
    else segundoStep(th, time, stepIndex);
  }

  function scheduler() {
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    let any = false;
    for (const id of THEME_IDS) {
      const th = themes[id];
      if (!th) continue;
      if (!th.on && now >= th.tailUntil) continue;
      any = true;
      if (th.nextTime < now - 0.12) th.nextTime = now;
      while (th.nextTime < now + 0.14) {
        scheduleStep(th, th.step, th.nextTime);
        th.step++;
        th.nextTime += 60 / (th.id === 'jose' ? 134 : (th.id === 'ovidio' ? 112 : 152)) / 4;
      }
    }
    if (!any) stopTimer();
  }

  /* ------------------------------- control -------------------------------- */

  function setOn(id, level) {
    const th = themes[id];
    if (!th) return;
    const lvl = clamp01(level);
    const now = ac.currentTime;
    th.on = true;
    th.tailUntil = now + 1.1;
    th.level = lvl;
    if (th.nextTime < now || th.nextTime > now + 0.4) {
      th.nextTime = now + 0.04;
      th.step = 0;
    }
    ramp(th.bus.gain, 0.30 + lvl * 0.24, 0.26);
    th.filter.frequency.setTargetAtTime(900 + lvl * 4200, now, 0.22);
    startTimer();
  }

  function setLevel(id, level) {
    const th = themes[id];
    if (!th) return;
    const lvl = clamp01(level);
    if (Math.abs(lvl - th.level) < 0.035) return;
    th.level = lvl;
    const now = ac.currentTime;
    th.bus.gain.setTargetAtTime(0.30 + lvl * 0.24, now, 0.16);
    th.filter.frequency.setTargetAtTime(900 + lvl * 4200, now, 0.20);
  }

  function setOff(id) {
    const th = themes[id];
    if (!th) return;
    th.on = false;
    if (ac) th.tailUntil = ac.currentTime + 0.85;
    ramp(th.bus.gain, 0, 0.34);
  }

  function stopTheme() {
    if (activeId) {
      setOff(activeId);
      activeId = null;
    }
    for (const id of THEME_IDS) {
      const th = themes[id];
      if (th && th.on) setOff(id);
    }
    lastIntensity = -1;
  }

  function unlock() {
    const ok = ensureContext();
    if (ok) resumeContext();
    return ok;
  }

  function update(payload) {
    lastUpdateAt = performance.now();
    const active = !!(payload && payload.active && payload.id && THEME_META[payload.id]);
    if (!active || muted) {
      stopTheme();
      suspendSoon();
      return;
    }
    if (suspendTimer) {
      clearTimeout(suspendTimer);
      suspendTimer = null;
    }
    if (!ensureContext()) return;
    const id = payload.id;
    const level = clamp01(payload.intensity === undefined ? 0.65 : payload.intensity);

    if (activeId !== id) {
      if (activeId) setOff(activeId);
      activeId = id;
      setOn(id, level);
      lastIntensity = level;
    } else {
      setLevel(id, level);
      lastIntensity = level;
    }
  }

  function stop() {
    stopTheme();
    suspendSoon();
  }

  function pause() {
    stopTheme();
    suspendSoon();
  }

  function resume() {
    if (ac) resumeContext();
  }

  function reset() {
    stopTheme();
  }

  function setMuted(value) {
    muted = !!value;
    persistMute();
    if (master && ac) {
      if (!muted) resumeContext();
      ramp(master.gain, muted ? 0 : 0.68, 0.14);
    }
    if (muted) {
      stopTheme();
      suspendSoon();
    }
  }

  function toggleMuted() {
    setMuted(!muted);
    return muted;
  }

  function themeMeta(id) {
    return THEME_META[id] || null;
  }

  function getState() {
    return {
      supported: !!(window.AudioContext || window.webkitAudioContext),
      context: ac ? ac.state : 'none',
      muted,
      activeId,
      lastIntensity,
      lastUpdateAt,
      levels: THEME_IDS.reduce(function (out, id) {
        const th = themes[id];
        out[id] = th ? { on: th.on, gain: th.bus.gain.value, level: th.level } : null;
        return out;
      }, {})
    };
  }

  window.ChaseMusic = {
    unlock,
    update,
    stop,
    pause,
    resume,
    reset,
    setMuted,
    toggleMuted,
    isMuted: function () { return muted; },
    themeMeta,
    getState
  };
})();
