import { AlertCircle, CheckCircle2, MessageSquare, MessageCircle, Mail } from 'lucide-react';
import { Badge, SectionHead } from './primitives';
import type { DashboardData, SmsBalance } from '@rpms/shared';

function smsStateLabel(balance: SmsBalance): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  if (balance.state === 'ok') return { label: `${balance.balance.amount.toLocaleString()} KSh`, tone: 'good' };
  if (balance.state === 'low') return { label: `Low — ${balance.balance.amount.toLocaleString()} KSh`, tone: 'warn' };
  if (balance.state === 'empty') return { label: 'Empty — top up', tone: 'bad' };
  return { label: 'Not set up', tone: 'neutral' };
}

interface XrmDeliveryStripProps {
  data: Pick<DashboardData, 'sms' | 'email' | 'whatsapp'>;
}

/** Compact delivery-health strip — mirrors the xampp RMS delivery indicators
 *  (SMS wallet + this-month send/fail counts) in a tight 3-up card, replacing
 *  the local HealthCards strip. WhatsApp joins the row when the payload carries
 *  it (older backends predate the key and the card just disappears). Self-gates
 *  the SMS/email half: nothing renders when there's nothing to report — but a
 *  WhatsApp provider that is live (or has rows this month) always shows, so the
 *  operator can see channel state at a glance. */
export function XrmDeliveryStrip({ data: { sms, email, whatsapp: wa } }: XrmDeliveryStripProps) {
  const smsState = smsStateLabel(sms.balance);
  const smsStuck = sms.failedThisMonth > 0;
  const emailStuck = (email?.failedThisMonth ?? 0) + (email?.pendingCount ?? 0) > 0;
  const waStuck = (wa?.failedThisMonth ?? 0) + (wa?.erroneousCount ?? 0) > 0;
  const waVisible = !!wa && (waStuck || wa.sentThisMonth > 0 || !wa.live);

  if (!smsStuck && !emailStuck && smsState.tone === 'neutral' && !email && !waVisible) return null;

  return (
    <div className="mt-6">
      <SectionHead label="Delivery" caption="SMS, WhatsApp and email delivery health — review failures before the next sweep" />
      <div className={`grid grid-cols-1 gap-3 ${waVisible ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {/* SMS card */}
        <div className={`rounded-xl border p-4 shadow-sm ${smsStuck ? 'border-red-400 bg-red-50' : smsState.tone === 'warn' ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare size={14} strokeWidth={2} className={`${smsStuck ? 'text-red-500' : smsState.tone === 'good' ? 'text-emerald-500' : smsState.tone === 'warn' ? 'text-amber-500' : 'text-gray-400'}`} />
              <span className="text-xs font-semibold text-gray-900">SMS Wallet</span>
            </div>
            <Badge tone={smsState.tone}>{smsState.label}</Badge>
          </div>
          {(sms.failedThisMonth > 0 || sms.sentThisMonth > 0) && (
            <div className="mt-2 flex gap-3 text-[11px] text-gray-600">
              {sms.sentThisMonth > 0 && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 size={12} strokeWidth={2} className="text-emerald-500" />
                  {sms.sentThisMonth} sent this month
                </span>
              )}
              {sms.failedThisMonth > 0 && (
                <span className="flex items-center gap-1">
                  <AlertCircle size={12} strokeWidth={2} className="text-red-500" />
                  {sms.failedThisMonth} failed this month
                </span>
              )}
            </div>
          )}
        </div>

        {/* WhatsApp card */}
        {waVisible && wa && (
          <div className={`rounded-xl border p-4 shadow-sm ${waStuck ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle size={14} strokeWidth={2} className={waStuck ? 'text-red-500' : wa.live ? 'text-emerald-500' : 'text-gray-400'} />
                <span className="text-xs font-semibold text-gray-900">WhatsApp Delivery</span>
              </div>
              <Badge tone={waStuck ? 'bad' : wa.live ? 'good' : 'neutral'}>
                {wa.live ? 'Live' : 'Click-to-chat'}
              </Badge>
            </div>
            {(wa.sentThisMonth > 0 || wa.failedThisMonth > 0 || wa.erroneousCount > 0 || wa.pendingCount > 0 || !wa.live) && (
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-600">
                {wa.sentThisMonth > 0 && (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 size={12} strokeWidth={2} className="text-emerald-500" />
                    {wa.sentThisMonth} sent
                  </span>
                )}
                {wa.pendingCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {wa.pendingCount} pending
                  </span>
                )}
                {wa.failedThisMonth > 0 && (
                  <span className="flex items-center gap-1">
                    <AlertCircle size={12} strokeWidth={2} className="text-red-500" />
                    {wa.failedThisMonth} failed
                  </span>
                )}
                {wa.erroneousCount > 0 && (
                  <span className="flex items-center gap-1" title="Terminal rejections — the number itself was refused; fix the number on the WhatsApp page and send again.">
                    <AlertCircle size={12} strokeWidth={2} className="text-red-500" />
                    {wa.erroneousCount} rejected
                  </span>
                )}
                {!wa.live && (
                  <span className="text-gray-500">Not configured — wa.me links only</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Email card */}
        {email && (
          <div className={`rounded-xl border p-4 shadow-sm ${emailStuck ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail size={14} strokeWidth={2} className={emailStuck ? 'text-red-500' : 'text-emerald-500'} />
                <span className="text-xs font-semibold text-gray-900">Email Delivery</span>
              </div>
              <Badge tone={emailStuck ? 'bad' : 'good'}>
                {email.sentThisMonth} sent · {email.failedThisMonth} failed
              </Badge>
            </div>
            {(email.pendingCount > 0 || email.failedThisMonth > 0) && (
              <div className="mt-2 flex gap-3 text-[11px] text-gray-600">
                {email.pendingCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {email.pendingCount} pending
                  </span>
                )}
                {email.failedThisMonth > 0 && (
                  <span className="flex items-center gap-1">
                    <AlertCircle size={12} strokeWidth={2} className="text-red-500" />
                    {email.failedThisMonth} failed
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
