// Business logo embedding for the pdf-lib document builders (receipt,
// monthly report, arrears report, tenant statement). One place knows how to
// decode the stored image and draw it at a fixed height in a document
// header; each builder decides its own coordinates. Everything degrades to
// text-only when no logo is configured or the format can't be embedded.
import type { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';
import type { BusinessIdentity } from '../services/brandingService';

const EMBEDDABLE = new Set(['image/png', 'image/jpeg']);

// Returns null when there is nothing to draw (no logo, or a non-PNG/JPEG
// format pdf-lib can't embed — SVG/GIF/WebP simply render text-only rather
// than failing the whole document).
export async function embedLogo(
  doc: PDFDocument,
  identity: BusinessIdentity
): Promise<PDFImage | null> {
  const logo = identity.logo;
  if (!logo || !EMBEDDABLE.has(logo.mimeType.toLowerCase())) return null;
  try {
    return logo.mimeType.toLowerCase() === 'image/png'
      ? await doc.embedPng(logo.bytes)
      : await doc.embedJpg(logo.bytes);
  } catch {
    // Corrupt or unsupported image data — never block the document.
    return null;
  }
}

// Draw the logo with its aspect ratio preserved at the requested height, top
// edge aligned to `topY`. Returns the x coordinate where content may start
// (left margin when no logo was drawn).
export function drawLogo(
  page: PDFPage,
  logo: PDFImage | null,
  o: { x: number; topY: number; height: number; pageWidth: number; rightLimit?: number }
): number {
  if (!logo) return o.x;
  // Aspect ratio is always preserved: scale fits the requested height, and
  // shrinks further if the available width is the tighter constraint.
  const maxWidth = (o.rightLimit ?? o.pageWidth) - o.x;
  const scale = Math.min(o.height / logo.height, maxWidth / logo.width);
  const width = logo.width * scale;
  const height = logo.height * scale;
  page.drawImage(logo, { x: o.x, y: o.topY - height, width, height });
  return o.x + width + 12;
}
