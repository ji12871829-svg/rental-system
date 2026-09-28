// Social-preview + SEO metadata for the public landing page.
//
// Crawlers and chat-app link previews do not execute the SPA, so the tags
// they read must exist in the document head. index.html ships static
// fallbacks; this module rewrites them at runtime with the live business
// identity (BrandingContext) while the landing page is mounted, and restores
// the statics on unmount so every other route keeps its plain shell.
//
// Absolute URLs come from VITE_SITE_URL when the deployment sets it; in the
// browser it falls back to the current origin. Placeholder values from
// branding.ts ("[phone]" etc.) are never rendered — the matching meta/JSON-LD
// field is simply omitted, the same rule the printed-receipt footer follows.
import { useEffect } from 'react';
import { branding } from './branding';

interface SeoIdentity {
  legalName?: string | null;
  address?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

// The same promise the page itself makes — no invented customers or numbers.
const DESCRIPTION =
  'Olbano Plaza puts rent, water, receipts and messages in one place — M-Pesa collection, ' +
  'per-unit water billing and a tenant self-service portal for landlords and managers.';

const TITLE = `${branding.appName} — ${branding.appNameLong}`;
const IMAGE_PATH = '/og.jpg';
const LD_SCRIPT_ID = 'landing-seo-jsonld';

const isTemplate = (v?: string | null): boolean => !v || v.trim().startsWith('[');

function siteUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) return location.origin;
  return ''; // graceful: tags keep their relative static values
}

/**
 * Applies the landing page's social-preview + SEO metadata and returns the
 * head to its previous state on unmount. Re-applies when the live branding
 * identity loads (null → loaded), upgrading contacts into the tags/JSON-LD.
 */
export function useLandingSeo(identity?: SeoIdentity | null): void {
  useEffect(() => {
    const site = siteUrl();
    const legalName = identity?.legalName ?? branding.legalName;
    const address = identity?.address ?? branding.address;
    const image = site ? `${site}${IMAGE_PATH}` : IMAGE_PATH;
    // ------------------------------------------------ description + OG + X
    // document.title stays with the app's per-route TitleManager — only the
    // crawler-facing tags carry the marketing title here.
    const restore: (() => void)[] = [];

    function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
      const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      const prev = existing?.getAttribute('content') ?? null;
      const node = existing ?? document.head.appendChild(document.createElement('meta'));
      node.setAttribute(attr, key);
      node.setAttribute('content', content);
      restore.push(() => {
        if (existing) {
          if (prev !== null) node.setAttribute('content', prev);
        } else {
          node.remove();
        }
      });
    }

    upsertMeta('name', 'description', DESCRIPTION);

    // --------------------------------------------------------- Open Graph
    upsertMeta('property', 'og:type', 'website');
    upsertMeta('property', 'og:site_name', branding.appName);
    upsertMeta('property', 'og:title', TITLE);
    upsertMeta('property', 'og:description', DESCRIPTION);
    upsertMeta('property', 'og:url', `${site}/landing`);
    upsertMeta('property', 'og:image', image);
    upsertMeta('property', 'og:image:width', '1200');
    upsertMeta('property', 'og:image:height', '630');
    upsertMeta('property', 'og:image:alt', `${branding.appName} — run the whole property from one ledger`);

    // ---------------------------------------------------------- Twitter/X
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', TITLE);
    upsertMeta('name', 'twitter:description', DESCRIPTION);
    upsertMeta('name', 'twitter:image', image);

    // ---------------------------------------------------------- canonical
    {
      const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      const prev = existing?.getAttribute('href') ?? null;
      const node = existing ?? document.createElement('link');
      if (!existing) {
        node.rel = 'canonical';
        document.head.appendChild(node);
      }
      node.href = `${site}/landing`;
      restore.push(() => {
        if (existing) {
          if (prev !== null) node.href = prev;
        } else {
          node.remove();
        }
      });
    }

    // ------------------------------------------------ JSON-LD LocalBusiness
    // Real facts only: the operator's own identity, the product's actual
    // services (the same list the capabilities grid renders) and the page's
    // own copy. Placeholder contacts stay out entirely.
    const [streetAddress = '', addressLocality = '', country = ''] = address
      .split(',')
      .map((s) => s.trim().replace(/\.$/, ''));
    const phone = identity?.contactPhone ?? branding.contactPhone;
    const email = identity?.contactEmail ?? branding.contactEmail;

    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'LocalBusiness',
          '@id': `${site}/#business`,
          name: legalName,
          description: DESCRIPTION,
          url: `${site}/landing`,
          image,
          logo: site ? `${site}/pwa-512.png` : '/pwa-512.png',
          priceRange: 'KSh',
          address: {
            '@type': 'PostalAddress',
            ...(streetAddress && { streetAddress }),
            ...(addressLocality && { addressLocality }),
            addressCountry: country === 'Kenya' || !country ? 'KE' : country,
          },
          // No geo block: coordinates would be invented. The street address
          // (from the live business identity) is what search engines geocode.
          ...(addressLocality && { areaServed: `${addressLocality}, Kenya` }),
          ...(!isTemplate(phone) && { telephone: phone }),
          ...(!isTemplate(email) && { email }),
        },
        {
          '@type': 'WebSite',
          '@id': `${site}/#website`,
          url: `${site}/landing`,
          name: branding.appName,
          publisher: { '@id': `${site}/#business` },
        },
        {
          '@type': 'OfferCatalog',
          name: 'Property management services',
          itemListElement: [
            'Rent collection via M-Pesa (STK push & PayBill)',
            'Per-unit water meter billing',
            'Tenant self-service portal',
            'Numbered receipts and monthly statements',
            'Arrears tracking and financial reports',
            'Units, tenancies and expense records',
          ].map((name) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name } })),
        },
      ],
    };

    document.getElementById(LD_SCRIPT_ID)?.remove();
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = LD_SCRIPT_ID;
    script.textContent = JSON.stringify(ld);
    document.head.appendChild(script);
    restore.push(() => script.remove());

    return () => restore.forEach((fn) => fn());
  }, [identity]);
}
