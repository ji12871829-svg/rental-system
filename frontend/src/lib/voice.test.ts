import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSpeechRecognitionCtor, speak, supportsSpeechSynthesis } from './voice';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('voice helpers', () => {
  it('returns null when the browser has no speech recognition (mic hides)', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    expect(getSpeechRecognitionCtor()).toBeNull();
  });

  it('prefers the standard constructor, falls back to webkit', () => {
    const Std = vi.fn();
    vi.stubGlobal('SpeechRecognition', Std);
    expect(getSpeechRecognitionCtor()).toBe(Std);
    vi.stubGlobal('SpeechRecognition', undefined);
    const Webkit = vi.fn();
    vi.stubGlobal('webkitSpeechRecognition', Webkit);
    expect(getSpeechRecognitionCtor()).toBe(Webkit);
  });

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
