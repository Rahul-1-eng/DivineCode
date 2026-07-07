/**
 * @file voice.ts
 * @author Rahul
 * @description Shared text-to-speech engine with every known Chrome
 * speechSynthesis workaround baked in. The naive `new Utterance → speak()`
 * pattern silently fails all the time: the voice list is empty on first call,
 * speak() right after cancel() is dropped, and Chrome kills any utterance
 * longer than ~15 seconds. Every voice surface (interview mock, AI recruiter
 * session, practice workspace) must speak through this file.
 */

type SpeakOptions = {
  rate?: number;
  pitch?: number;
  onStart?: () => void;
  onEnd?: () => void;
  /** Fired once when the browser refuses to speak (autoplay policy) — show a "tap to listen" affordance. */
  onBlocked?: () => void;
};

let cachedVoices: SpeechSynthesisVoice[] = [];
let keepAlive: ReturnType<typeof setInterval> | null = null;
let generation = 0; // bumped by stopSpeaking() so stale chunk queues die
let unlockArmed = false;

function synthAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Voice list is loaded asynchronously by the browser — wait for it (max 2s). */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    if (!synthAvailable()) return resolve([]);
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) { cachedVoices = existing; return resolve(existing); }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cachedVoices = window.speechSynthesis.getVoices();
      resolve(cachedVoices);
    };
    window.speechSynthesis.onvoiceschanged = finish;
    setTimeout(finish, 2000); // some browsers never fire voiceschanged
  });
}

/**
 * Chrome and Safari refuse speechSynthesis until the user has interacted with
 * the page at all ("not-allowed"). That activation is sticky — one real tap
 * or keypress anywhere is enough — so all we do on the first gesture is nudge
 * a possibly-paused queue with resume().
 *
 * NEVER speak a dummy utterance here (even muted): TTS output steals the
 * audio focus from SpeechRecognition, so the mic drops the instant it opens,
 * and a zero-volume utterance can wedge Chrome's synthesis queue for the
 * whole page.
 */
function armAudioUnlock() {
  if (unlockArmed || typeof window === 'undefined') return;
  unlockArmed = true;
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    if (!synthAvailable()) return;
    try {
      window.speechSynthesis.resume();
    } catch { /* unlock is best-effort */ }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return (
    voices.find(v => /Google UK English Female|Google US English|Microsoft (Ava|Aria|Jenny)/i.test(v.name)) ||
    voices.find(v => v.lang === 'en-IN') ||
    voices.find(v => v.lang.startsWith('en')) ||
    voices[0] ||
    null
  );
}

/**
 * Chrome hard-stops any single utterance after ~15s of audio. Splitting on
 * sentence boundaries into ≤180-char chunks keeps every chunk well under the
 * limit; the queue plays them back seamlessly.
 */
function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > 180 && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function startKeepAlive() {
  // Chrome pauses long TTS sessions in the background; a periodic resume()
  // nudge keeps the queue flowing. Cleared when speech finishes.
  if (keepAlive) clearInterval(keepAlive);
  keepAlive = setInterval(() => {
    if (!synthAvailable()) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) return;
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
  }, 5000);
}

function stopKeepAlive() {
  if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
}

/** Immediately stop all speech and invalidate any queued chunks. */
export function stopSpeaking(): void {
  generation += 1;
  stopKeepAlive();
  if (synthAvailable()) window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return synthAvailable() && window.speechSynthesis.speaking;
}

/**
 * Speak text reliably. Returns false when the browser has no TTS at all
 * (onEnd still fires so UI state never wedges).
 */
export function speakText(text: string, opts: SpeakOptions = {}): boolean {
  if (!synthAvailable() || !text || !text.trim()) {
    opts.onEnd?.();
    return false;
  }

  const myGeneration = ++generation;
  window.speechSynthesis.cancel();

  // speak() issued synchronously after cancel() is silently dropped in
  // Chrome/Edge — give the engine a tick to actually flush.
  setTimeout(async () => {
    if (myGeneration !== generation) return; // superseded meanwhile

    const voices = cachedVoices.length ? cachedVoices : await loadVoices();
    if (myGeneration !== generation) return;

    const voice = pickVoice(voices);
    const chunks = chunkText(text);
    if (chunks.length === 0) { opts.onEnd?.(); return; }

    let started = false;
    let blockedNotified = false;
    let remaining = chunks.length;
    const notifyBlocked = () => {
      if (blockedNotified) return;
      blockedNotified = true;
      opts.onBlocked?.();
    };

    for (const chunk of chunks) {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) u.voice = voice;
      u.rate = opts.rate ?? 1.0;
      u.pitch = opts.pitch ?? 1.0;
      u.lang = voice?.lang || 'en-US';
      u.onstart = () => {
        if (!started) { started = true; startKeepAlive(); opts.onStart?.(); }
      };
      const settle = () => {
        remaining -= 1;
        if (remaining <= 0 && myGeneration === generation) {
          stopKeepAlive();
          opts.onEnd?.();
        }
      };
      u.onend = settle;
      u.onerror = (e: SpeechSynthesisErrorEvent) => {
        // Autoplay policy: the page has no user activation yet, so the browser
        // drops the utterance. Tell the caller so it can offer a replay tap.
        if (e.error === 'not-allowed') notifyBlocked();
        settle();
      };
      window.speechSynthesis.speak(u);
    }

    // Watchdog: if nothing started within 3s (engine wedged or silently
    // blocked), reset it once and surface the blocked state to the caller.
    setTimeout(() => {
      if (myGeneration === generation && !started && !window.speechSynthesis.speaking) {
        notifyBlocked();
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
      }
    }, 3000);
  }, 80);

  return true;
}

/**
 * Warm the voice list early and arm the first-gesture audio unlock
 * (call once on mount) so first speech is instant and never policy-blocked.
 */
export function primeVoices(): void {
  armAudioUnlock();
  if (synthAvailable()) void loadVoices();
}
