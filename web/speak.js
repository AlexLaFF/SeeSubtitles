// The translation, spoken: each sentence read aloud once it has settled, in headphones, a few seconds behind the
// speaker — an interpreter's channel made of the subtitles that already exist. The voices are the system's own
// (the Web Speech API here, AVSpeechSynthesizer in the iOS app), so it costs nothing beyond the subtitles.
//
// Two halves. `Queue` is the policy — what is spoken, in what order, how fast, and what is skipped — and is pure, so
// it is tested in Node and mirrored in Swift (ios/…/Speech/SpeechQueue.swift; ios/scripts/export-schema.mjs writes
// the scenarios both must agree on). `Speaker` drives the browser's speechSynthesis with it.
//
// The policy, and why:
//  - Only settled sentences. A draft is rewritten three or four times before it settles, and sound cannot be rewritten.
//  - Never the past. Turning it on speaks what settles from then on, not the transcript so far.
//  - It must not fall behind. A translation often takes longer to say than the original took. One sentence waiting:
//    speak faster. More than `maxWaiting`: drop the oldest and say the newest — a gap is heard once; drift never ends.
//  - Nothing to say when the subtitles are the words as spoken: an echo a few seconds late helps no one.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Speak = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const DEFAULTS = { rate: 1.1, maxWaiting: 2, hurry: 1.15, rush: 1.3, maxRate: 1.6 };
  // What a talk's subtitle language is called by a speech engine. Anything missing is passed through as it is.
  const VOICE_LANG = { zh: 'zh-CN', zh_en: 'zh-CN', yue: 'zh-HK', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES',
    pt: 'pt-BR', it: 'it-IT', ru: 'ru-RU', ar: 'ar-SA', hi: 'hi-IN', th: 'th-TH', vi: 'vi-VN', id: 'id-ID', ms: 'ms-MY', tr: 'tr-TR', pl: 'pl-PL',
    nl: 'nl-NL', cs: 'cs-CZ', he: 'he-IL', uk: 'uk-UA' };
  const voiceLang = (code) => VOICE_LANG[code] || code;
  // Apple ships two families nobody wants to be read to by for an hour: the robotic "Eloquence" set, which exists
  // in every language and sorts first by name, and the novelty voices. They stay available, at the bottom.
  const QUIRKY = ['Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley', 'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos',
    'Good News', 'Jester', 'Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Fred', 'Junior', 'Kathy', 'Ralph'];
  const isQuirky = (name) => QUIRKY.some((q) => name === q || name.startsWith(`${q} (`));

  /** What to say for a line, or '' when there is nothing worth saying aloud. */
  function textToSpeak(line) {
    if (!line || !line.ended || line.kind === 'reply') return '';
    const target = String(line.targetText || '').trim();
    const source = String(line.sourceText || '').trim();
    return target && target !== source ? target : '';
  }

  class Queue {
    constructor(options = {}) {
      this.options = { ...DEFAULTS, ...options };
      this.waiting = []; // { id, text }
      this.known = new Set(); // every sentence that has been offered, spoken or not: a sentence is said once
      this.speaking = null;
      this.spoken = 0;
      this.skipped = 0;
      this.on = false;
    }

    /** Begin. Everything already in the transcript is the past. */
    start(existingIds = []) {
      this.on = true;
      this.waiting = []; this.speaking = null;
      for (const id of existingIds) this.known.add(id);
    }

    /** End, dropping whatever was waiting. The driver silences the sentence in progress. */
    stop() { this.on = false; this.waiting = []; this.speaking = null; }

    /** A line changed or arrived. Returns the ids dropped to keep up (usually none). */
    offer(line) {
      if (!this.on || !line || this.known.has(line.id)) return [];
      if (!line.ended) return [];
      this.known.add(line.id); // settled: whatever happens next, it will not be offered again
      const text = textToSpeak(line);
      if (!text) return [];
      this.waiting.push({ id: line.id, text });
      const dropped = [];
      while (this.waiting.length > this.options.maxWaiting) { dropped.push(this.waiting.shift().id); this.skipped++; }
      return dropped;
    }

    /** The next thing to say, and how fast — or null when there is nothing, or something is being said. */
    next() {
      if (!this.on || this.speaking || !this.waiting.length) return null;
      const item = this.waiting.shift();
      const behind = this.waiting.length; // sentences still waiting behind this one
      const o = this.options;
      const rate = Math.min(o.maxRate, o.rate * (behind >= 2 ? o.rush : behind === 1 ? o.hurry : 1));
      this.speaking = item.id;
      return { id: item.id, text: item.text, rate: Math.round(rate * 1000) / 1000 };
    }

    /** The sentence in progress is over, however it ended. */
    finished(id) { if (this.speaking === id) { this.speaking = null; this.spoken++; } }

    get behind() { return this.waiting.length + (this.speaking ? 1 : 0); }
  }

  /** The browser's voices for a language, best first: the system's own before a network one, enhanced before plain. */
  function voicesFor(lang, all) {
    const want = voiceLang(lang).toLowerCase();
    const base = want.split('-')[0];
    const score = (v) => (isQuirky(v.name) ? -8 : 0) + (v.lang.toLowerCase() === want ? 4 : 0) + (v.localService ? 2 : 0) + (/premium|enhanced|natural|siri/i.test(v.name) ? 1 : 0);
    return (all || []).filter((v) => v.lang.toLowerCase() === want || (base !== 'zh' && v.lang.toLowerCase().split('-')[0] === base)).sort((a, b) => score(b) - score(a));
  }

  /** Drives window.speechSynthesis with a Queue. `onChange` is called whenever what it is doing changes. */
  class Speaker {
    constructor({ lang, rate, voiceName = '', onChange = () => {}, synth = (typeof window === 'object' ? window.speechSynthesis : null), Utterance = (typeof window === 'object' ? window.SpeechSynthesisUtterance : null) } = {}) {
      this.queue = new Queue(rate ? { rate } : {});
      this.lang = lang; this.voiceName = voiceName; this.onChange = onChange;
      this.synth = synth; this.Utterance = Utterance;
    }

    get supported() { return !!(this.synth && this.Utterance); }
    get on() { return this.queue.on; }
    voices() { return this.supported ? voicesFor(this.lang, this.synth.getVoices()) : []; }

    start(existingIds) { if (!this.supported) return false; this.queue.start(existingIds); this.onChange(); return true; }
    stop() { this.queue.stop(); if (this.supported) this.synth.cancel(); this.onChange(); }
    setLanguage(lang) { if (lang !== this.lang) { this.lang = lang; if (this.on && this.supported) this.synth.cancel(); } }

    offer(line) { this.queue.offer(line); this._pump(); }

    _pump() {
      const item = this.queue.next();
      if (!item) return;
      const u = new this.Utterance(item.text);
      u.lang = voiceLang(this.lang);
      const voice = this.voices().find((v) => v.name === this.voiceName) || this.voices()[0];
      if (voice) u.voice = voice;
      u.rate = item.rate;
      const done = () => { this.queue.finished(item.id); this.onChange(); this._pump(); };
      u.onend = done; u.onerror = done;
      this.synth.speak(u);
      this.onChange();
    }
  }

  return { Queue, Speaker, textToSpeak, voiceLang, voicesFor, isQuirky, DEFAULTS, VOICE_LANG, QUIRKY };
});
