import { CalendarDays, Calculator, Droplets, Lock, ReceiptText, Route, type LucideIcon } from 'lucide-react';
import { PageHeader } from '../components/ui';

const SECTIONS: { title: string; icon: LucideIcon; body: string[] }[] = [
  {
    title: 'Daily workflow',
    icon: Route,
    body: [
      '1. Tenants — add a tenant and assign them to a unit. The unit becomes OCCUPIED automatically.',
      '2. Rent Collection — record rent payments. Expected rent is fetched automatically from the unit. You can record several payments for the same month; the status (PAID / PARTIAL / UNPAID / OVERPAID) is calculated for you.',
      '3. Water Meter — record meter readings for Units 12–23 only. The previous reading is filled in automatically; the bill is Consumption × Water Rate. Units 1–11 and Unit 24 are never billed for water.',
      '4. Water Payments — record what tenants pay towards their water bills.',
      '5. Water Supply Costs — record how much you spend buying water. Water Collected − Supply Cost = Surplus or Deficit.',
      '6. Expenses — record property expenses. Total Money Collected − Total Expenses = Net Property Income.',
    ],
  },
  {
    title: 'Key financial formulas',
    icon: Calculator,
    body: [
      'Rent balance = Expected rent − Total rent paid (per month).',
      'Water balance = Water bill − Total water paid (per month).',
      'Combined balance = Rent balance + Water balance.',
      'Water outstanding = Water billed − Water collected.',
      'Water collection rate = Collected ÷ Billed × 100.',
      'Water surplus / deficit = Water collected − Water supply cost.',
      'Net property income = (Rent collected + Water collected) − Total expenses.',
    ],
  },
  {
    title: 'Water billing rule',
    icon: Droplets,
    body: [
      'Water billing applies ONLY to Units 12–23. Units 1–11 and Unit 24 always have a water bill of KSh 0.',
      'This is enforced by the database itself — the system refuses meter readings or water payments for non-water units.',
      'The water rate (KSh 200) is set once in Settings and every bill uses the current rate.',
    ],
  },
  {
    title: 'Receipts & SMS',
    icon: ReceiptText,
    body: [
      'Every rent payment generates an RC-YYYY-#### receipt; every water payment generates a WC-YYYY-#### receipt. They are printable from the Receipts page.',
      'A combined RWC-YYYY-#### receipt can be generated for a tenant and month (rent + water together).',
      'SMS messages are prepared automatically for every receipt and appear under SMS Notifications as PENDING. Click Send to mark them sent (simulated until a provider is configured).',
    ],
  },
  {
    title: 'Reporting year',
    icon: CalendarDays,
    body: [
      'All reports (dashboard, monthly summaries, arrears, water reports) follow the Reporting Year set in Settings — 2026 by default.',
      'Change it in Settings and every report, chart and summary updates automatically.',
    ],
  },
  {
    title: 'Roles',
    icon: Lock,
    body: [
      'ADMIN — full access including users, settings and audit logs.',
      'PROPERTY_MANAGER — day-to-day management: tenants, units, rent, water, expenses, reports, receipts. No user management.',
      'STAFF — data entry: record payments, readings, expenses. Cannot change settings or delete records.',
    ],
  },
];

export default function Instructions() {
  return (
    <div>
      <PageHeader title="Instructions / Help" subtitle="A short guide to the daily use of the system — this page is the full reference" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <div key={s.title} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
            <h2 className="mb-3 flex items-center gap-2.5 text-base font-semibold text-gray-900">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <s.icon size={17} strokeWidth={1.75} aria-hidden />
              </span>
              {s.title}
            </h2>
            <ul className="space-y-2 text-sm text-gray-600">
              {s.body.map((line) => (
                <li key={line} className="leading-relaxed">{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}