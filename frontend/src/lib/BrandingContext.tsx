import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { branding } from './branding';
import { applyBrandFavicon } from './brandFavicon';
import { lastUpdated } from 'virtual:last-updated';

// Live business identity from the backend (business_branding table, editable
// in Settings). Unfilled fields are null — consumers hide them instead of
// rendering placeholder text. Static product-name config (RPMS, taglines)
// still comes from src/lib/branding.ts.

export interface BrandingView {
  legal_name: string | null;
  registration_number: string | null;
  address: string | null;
  contact_email: string | null;
  privacy_email: string | null;
  contact_phone: string | null;
  retention_period: string | null;
  response_days: string | null;
  jurisdiction: string | null;
  property_scope: string | null;
  payment_channels: string | null;
  refund_window_days: string | null;
  updated_at: string;
  legalName: string | null;
  registrationNumber: string | null;
  contactEmail: string | null;
  privacyEmail: string | null;
  contactPhone: string | null;
  retentionPeriod: string | null;
  responseDays: string | null;
  propertyScope: string | null;
  paymentChannels: string | null;
  refundWindowDays: string | null;
  paybill_number: string | null;
  paybill_name: string | null;
  paybill_enabled: boolean;
  paybill_instructions: string | null;
  paybillNumber: string | null;
  paybillName: string | null;
  paybillEnabled: boolean;
  paybillInstructions: string | null;
  brandInitials: string | null;
  receiptFooterLines: string[];
  fieldStatus: { label: string; value: string; filled: boolean }[];
  missingCount: number;
}

interface BrandingContextValue {
  identity: BrandingView | null;
  refreshBranding: () => Promise<void>;
  tabTitleBrand: string;
  legalNameDisplay: string | null;
  supportContacts: { label: string; email: string }[];
  loginIdentityLine: string | null;
  missingLabels: string[];
  /** When the business identity/policy details were last updated — one date
   *  shared by the Settings identity plate, the app footer and legal pages. */
  lastUpdatedDisplay: string;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

const formatUpdatedAt = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// Build-time fallback: edit time of src/lib/branding.ts (virtual module from
// vite.config.ts) — used until the live identity loads.
const fallbackUpdated = formatUpdatedAt(lastUpdated);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<BrandingView | null>(null);

  const refreshBranding = useCallback(async () => {
    try {
      const res = await fetch('/api/branding');
      if (res.ok) {
        const body = await res.json();
        setIdentity(body.data as BrandingView);
      }
    } catch {
      // Offline/unreachable — keep the last known identity (or null).
    }
  }, []);

  useEffect(() => {
    refreshBranding();
  }, [refreshBranding]);

  // Favicon follows the initials whenever they arrive or change.
  useEffect(() => {
    applyBrandFavicon(identity?.brandInitials ?? null);
  }, [identity?.brandInitials]);

  const legalNameDisplay = identity?.legalName ?? null;
  const tabTitleBrand = legalNameDisplay ? `${branding.appName} — ${legalNameDisplay}` : branding.appName;

  const supportContacts = [
    ...(identity?.contactEmail ? [{ label: 'Support', email: identity.contactEmail }] : []),
    ...(identity?.privacyEmail ? [{ label: 'Privacy', email: identity.privacyEmail }] : []),
  ];

  const loginIdentityLine = legalNameDisplay
    ? [
        `Operated by ${legalNameDisplay}`,
        ...(identity?.registrationNumber ? [`Reg. No. ${identity.registrationNumber}`] : []),
      ].join(' · ')
    : null;

  const missingLabels = (identity?.fieldStatus ?? [])
    .filter((f) => !f.filled)
    .map((f) => f.label);

  const lastUpdatedDisplay = identity ? formatUpdatedAt(identity.updated_at) : fallbackUpdated;

  return (
    <BrandingContext.Provider
      value={{ identity, refreshBranding, tabTitleBrand, legalNameDisplay, supportContacts, loginIdentityLine, missingLabels, lastUpdatedDisplay }}
    >
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used inside BrandingProvider');
  return ctx;
}
