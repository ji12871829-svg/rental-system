// Vitest + Testing Library bootstrap: jest-dom matchers, plus the browser
// APIs the landing modules touch that jsdom does not implement.
import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

// jsdom has neither; the landing's reveal hook and theme store query both
// (reduce-motion gate, prefers-color-scheme). Match light and calm.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
if (!('IntersectionObserver' in window)) {
  (window as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver;
}

beforeEach(() => {
  // Reveal hooks read this gate at mount; jsdom has no stylesheet media
  // evaluation, so keep the stub authoritative per test.
  window.matchMedia('(prefers-reduced-motion: reduce)');
});
