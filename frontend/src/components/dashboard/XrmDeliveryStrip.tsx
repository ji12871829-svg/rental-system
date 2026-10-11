import { AlertCircle, CheckCircle2, MessageSquare, Mail } from 'lucide-react';
import { Badge, SectionHead } from './primitives';
import type { DashboardData, SmsBalance } from '@rpms/shared';

function smsStateLabel(balance: SmsBalance): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  if (balance.state === 'ok') return { label: `${balance.balance.amount.toLocaleString()} KSh`, tone: 'good' };
  if (balance.state === 'low') return { label: `Low — ${balance.balance.amount.toLocaleString()} KSh`, tone: 'warn' };
  if (balance.state === 'empty') return { label: 'Empty — top up', tone: 'bad' };
  return { label: 'Not set up', tone: 'neutral' };
}

interface XrmDeliveryStripProps {
  data: Pick<DashboardData, 'sms' | 'email'>;
}

/** Compact delivery-health strip — mirrors the xampp RMS delivery indicators
 *  (SMS wallet + this-month send/fail counts) in a tight 2-up card, replacing
 *  the local HealthCards strip. Self-gates: nothing renders when there's
 *  nothing to report. */
export function XrmDeliveryStrip({ data: { sms, email } }: XrmDeliveryStripProps) {
  const smsState = smsStateLabel(sms.balance);
  const smsStuck = sms.failedThisMonth > 0;
  const emailStuck = (email?.failedThisMonth ?? 0) + (email?.pendingCount ?? 0) > 0;

  if (!smsStuck && !emailStuck && smsState.tone === 'neutral' && !email) return null;

  return (
    <div className="mt-6">
      <SectionHead label="Delivery" caption="SMS + email delivery health — review failures before the next sweep" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
