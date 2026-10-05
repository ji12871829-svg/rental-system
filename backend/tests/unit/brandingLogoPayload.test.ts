import { parseLogoPayload } from '../../src/services/brandingService';

// Hoisted to module scope: neither helper captures anything from the suite.
const fromText = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const url = (mime: string, base64: string) => `data:${mime};base64,${base64}`;

// Regression lock for security finding F3 (SECURITY-ASSESSMENT-2026-09-19):
// stored XSS via an SVG logo served back from this origin. parseLogoPayload is
// the single gate on the only write path (uploadLogo), so every case below
// asserts the gate still holds — a widened MIME regex or a dropped magic-byte
// check fails here instead of in production.
describe('parseLogoPayload (F3 stored XSS via SVG logo)', () => {
  // A real 1x1 transparent PNG, already base64. Used verbatim, never re-encoded.
  const PNG_1PX_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  // Built from explicit byte arrays: routing raw bytes through a JS string
  // would UTF-8 re-encode them and produce a payload with the wrong signature.
  const GIF_89A_B64 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).toString('base64'); // 'GIF89a'
  const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString('base64');
  const WEBP_B64 = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // 'RIFF'
    0x1a, 0x00, 0x00, 0x00, // chunk size
    0x57, 0x45, 0x42, 0x50, // 'WEBP'
    0x56, 0x50, 0x38, 0x20, // 'VP8 '
  ]).toString('base64');

  describe('accepts genuine raster uploads', () => {
    it('accepts a real PNG and reports the declared mime type', () => {
      const { bytes, mimeType } = parseLogoPayload(url('image/png', PNG_1PX_B64));
      expect(mimeType).toBe('image/png');
      expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    });

    it.each([
      ['image/png', PNG_1PX_B64],
      ['image/jpeg', JPEG_B64],
      ['image/gif', GIF_89A_B64],
      ['image/webp', WEBP_B64],
    ])('accepts %s', (mime, payload) => {
      expect(parseLogoPayload(url(mime, payload)).mimeType).toBe(mime);
    });
  });

  describe('rejects SVG — the actual XSS vector', () => {
    it('rejects image/svg+xml carrying well-formed script content', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
      expect(() => parseLogoPayload(url('image/svg+xml', fromText(svg)))).toThrow(
        /SVG is not accepted/,
      );
    });

    it('rejects script-free SVG that is still active (onload, foreignObject)', () => {
      // No <script> at all. The gate must not reason about content - svg+xml is
      // refused outright rather than pattern-matched for danger.
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)"/></svg>';
      expect(() => parseLogoPayload(url('image/svg+xml', fromText(svg)))).toThrow(
        /SVG is not accepted/,
      );
    });

    it.each([
      ['uppercased subtype', 'image/SVG+XML'],
      ['trailing space in the subtype', 'image/svg+xml '],
    ])('does not accept SVG via %s', (_label, mime) => {
      // Assert the specific rejection, not merely "it threw": a widened
      // allowlist would still throw on the magic-byte check, and only the
      // message proves the SVG was refused at the MIME gate.
      expect(() => parseLogoPayload(url(mime, fromText('<svg onload="alert(1)"/>')))).toThrow(
        /SVG is not accepted/,
      );
    });

    it('does not accept SVG through leading whitespace on the data URL', () => {
      // parseLogoPayload trims first, so this reaches the same MIME gate.
      expect(() => parseLogoPayload(` data:image/svg+xml;base64,${fromText('<svg/>')}`)).toThrow(
        /SVG is not accepted/,
      );
    });
  });

  describe('rejects mislabeled non-image payloads (magic-byte check)', () => {
    it('rejects HTML renamed to image/png', () => {
      const html = '<html><script>alert(document.cookie)</script></html>';
      expect(() => parseLogoPayload(url('image/png', fromText(html)))).toThrow(
        /does not look like a valid/,
      );
    });

    it('rejects SVG bytes renamed to image/png', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
      expect(() => parseLogoPayload(url('image/png', fromText(svg)))).toThrow(
        /does not look like a valid/,
      );
    });

    it('keeps a PNG-signed payload served as image/png, never as svg or html', () => {
      // Bytes that satisfy the PNG signature then carry script. The signature
      // check cannot see this - that is precisely why the MIME allowlist and
      // nosniff + CSP are load-bearing. Assert the served type stays raster.
      const polyglot = Buffer.concat([Buffer.from(PNG_SIGNATURE), Buffer.from('<script>alert(1)</script>')])
        .toString('base64');
      const { mimeType } = parseLogoPayload(url('image/png', polyglot));
      expect(mimeType).toBe('image/png');
      expect(mimeType).not.toMatch(/svg|html/i);
    });

    it('rejects arbitrary text and a payload too short to carry any signature', () => {
      expect(() => parseLogoPayload(url('image/png', fromText('not an image at all')))).toThrow(
        /does not look like a valid/,
      );
      // 'AAAA' decodes to three zero bytes: non-empty, so it clears the
      // empty-file guard, but it can never satisfy hasKnownImageMagic.
      expect(() => parseLogoPayload(url('image/png', 'AAAA'))).toThrow(/does not look like a valid/);
    });
  });

  describe('rejects malformed envelopes', () => {
    it.each([
      ['plain base64 with no data: prefix', fromText('anything')],
      ['a text/html mime type', url('text/html', fromText('<script>alert(1)</script>'))],
      ['application/octet-stream', url('application/octet-stream', PNG_1PX_B64)],
      ['non-base64 characters in the payload', 'data:image/png;base64,!!!not-base64!!!'],
      ['an http(s) URL instead of a data URL', 'https://evil.example/logo.svg'],
      ['an empty base64 payload', 'data:image/png;base64,'],
    ])('rejects %s', (_label, input) => {
      expect(() => parseLogoPayload(input)).toThrow();
    });
  });

  describe('size limit', () => {
    it('rejects a signature-correct payload over 512 KB', () => {
      const oversized = Buffer.concat([
        Buffer.from(PNG_SIGNATURE),
        Buffer.alloc(600 * 1024, 0x41),
      ]).toString('base64');
      expect(() => parseLogoPayload(url('image/png', oversized))).toThrow(/too large/);
    });

    it('accepts a real PNG at the boundary it is meant to handle', () => {
      expect(() => parseLogoPayload(url('image/png', PNG_1PX_B64))).not.toThrow();
    });
  });
});