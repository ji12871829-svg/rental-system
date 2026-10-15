// Browser-native voice: speech-to-text for the mic button, speechSynthesis
// for read-aloud replies. Both are free OS/browser features — no key, no
// backend, no quota. Chrome/Edge support recognition; elsewhere the mic
// hides (getSpeechRecognitionCtor() === null) and typing still works.
// (Not exported: knip flags unused exported types, and no consumer imports
// this directly — use SpeechRecognitionCtor / ReturnType instead.)
interface SpeechRecognitionAlternative {
  transcript: string;
}

// A recognition result: array-like alternatives plus the final flag.
// isFinal lives on the RESULT (results[i]), not on the alternative —
// putting it on the wrong level silently turns every result interim.
interface SpeechRecognitionResultLike extends Array<SpeechRecognitionAlternative> {
  isFinal: boolean;
}

interface SpeechRecognitionLike {
  lang: string;
  // Continuous mode keeps listening across pauses until stop() — without it
  // the recognizer ends at the first silence (the "mic dies after a second"
  // bug). Interim results stream live text while final ones accumulate.
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: SpeechRecognitionResultLike[]; resultIndex: number }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function supportsSpeechSynthesis(): boolean {
  // Check the value, not just `'speechSynthesis' in window`: the key can be
  // present with an undefined value (e.g. vi.stubGlobal in tests), which
  // must count as unsupported so speak() stays a silent no-op.
  return typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis !== null;
}

// Cancels any in-progress utterance, then reads the text aloud. Silent
// no-op where synthesis is unsupported.
export function speak(text: string): void {
  if (!supportsSpeechSynthesis()) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
