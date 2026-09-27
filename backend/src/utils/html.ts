// Shared HTML escaping — the single implementation for every server-rendered
// document: email bodies (utils/emailTemplates), printed receipt HTML
// (utils/receiptDocument), the branding identity view (brandingService) and
// owner remittance emails. Previously four copies with drifting entity
// coverage (5 / 4 / 3 entities) — any dynamic value interpolated into markup
// goes through this, so the strictest coverage everywhere is both safer and
// simpler to reason about.
//
// Escapes the five markup-significant characters: & < > " '. Quotes matter
// whenever an escaped value lands inside a double- or single-quoted attribute
// (alt="", href="…"), which several of the consumers do.

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character] ?? character);
}
