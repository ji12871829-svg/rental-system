// Browser-native speech synthesis for read-aloud replies. Free OS/browser
// feature — no key, no backend, no quota.
//
// Dictation deliberately does NOT use the browser's built-in speech
// recognition: it garbled even short English queries on real devices.
// Voice input records audio and sends it to Groq Whisper server-side
// (POST /api/assistant/transcribe) instead — see AssistantChat.
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
