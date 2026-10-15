import { afterEach, describe, expect, it, vi } from 'vitest';
import { speak, supportsSpeechSynthesis } from './voice';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('voice helpers (read-aloud only — dictation records audio for server-side Whisper instead)', () => {
  it('speak() is a no-op without synthesis support and speaks once with it', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(() => speak('hi')).not.toThrow();
    const utterances: string[] = [];
    vi.stubGlobal('speechSynthesis', {
      cancel: vi.fn(),
      speak: vi.fn((u: { text: string }) => utterances.push(u.text)),
    });
    vi.stubGlobal('SpeechSynthesisUtterance', vi.fn(function (this: unknown, text: string) {
      (this as { text: string }).text = text;
    }));
    speak('hello there');
    expect(utterances).toEqual(['hello there']);
  });

  it('reports synthesis support truthfully', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(supportsSpeechSynthesis()).toBe(false);
  });
});
