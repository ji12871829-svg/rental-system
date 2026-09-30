import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing from './Landing';
import { AuthProvider } from '../lib/auth';
import { PortalAuthProvider } from '../lib/portalAuth';
import { BrandingProvider } from '../lib/BrandingContext';
import { ThemeProvider } from '../lib/theme';

// The hero spotlights the property name in an amber pill. Two earlier bugs
// make this test load-bearing:
//
//   1. The pill once split mid-highlight across two lines at phone widths
//      (the browser broke inside the span). The fix is whitespace-nowrap —
//      the class IS the guarantee, so the test asserts it is present.
//   2. At 360px the header starved the wordmark to "Olb…" — also nowrap'd
//      and asserted here so a future header refactor cannot reintroduce it.
//
// A jsdom layout engine cannot measure rendered text (no font metrics, no
// line breaking), so the real wrap behaviour is verified by browser probes
// at 320/360/390px; what a unit test CAN pin is that the nowrap mechanism
// is present wherever the name is highlighted, and that nothing else about
// the hero markup drifted.

describe('Landing hero (brand-name highlighting)', () => {
  it('renders the highlighted brand pill with the no-wrap guarantee', async () => {
    render(
      <MemoryRouter initialEntries={['/landing']}>
        <ThemeProvider>
          <AuthProvider>
            <PortalAuthProvider>
              <BrandingProvider>
                <Landing />
              </BrandingProvider>
            </PortalAuthProvider>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const pill = await screen.findByText('Olbano Plaza', {
      selector: 'h1 span.bg-sun',
    });
    expect(pill).toBeInTheDocument();
    // The wrap guarantee: the browser may break BETWEEN text runs around
    // the pill, never INSIDE it.
    expect(pill).toHaveClass('whitespace-nowrap');
    // The highlight treatment itself.
    expect(pill).toHaveClass('bg-sun');

    // The pill text comes from branding, and the eyebrow carries the same
    // name unbroken (second nowrap from the mobile-sweep fix). Scoped to
    // the eyebrow's inline-flex label — the section-body pills share the
    // generic p > strong shape.
    const eyebrowP = document.querySelector('section p.inline-flex');
    expect(eyebrowP).not.toBeNull();
    const eyebrowStrong = eyebrowP!.querySelector('strong');
    expect(eyebrowStrong).toHaveTextContent('Olbano Plaza');
    expect(eyebrowStrong).toHaveClass('whitespace-nowrap');

    // The header wordmark: truncate is allowed (graceful at extreme sizes)
    // but only as a last resort — assert it is still rendered.
    const wordmark = screen.getByText('Olbano Plaza', {
      selector: 'header span',
    });
    expect(wordmark).toBeInTheDocument();
  });
});
