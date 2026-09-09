"use strict";
// SMS provider abstraction. This is the ONLY file that knows about a real
// provider. The current implementation is a stub (simulated send) so the whole
// system works without external credentials; wire `send()` to Africa's Talking
// here when ready. Credentials come from env vars — never from the DB or
// source code (spec §34 / §41).
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSms = sendSms;
const AT_SMS_ENDPOINT = 'https://api.africastalking.com/version1/messaging';
async function sendSms(opts) {
    const { phoneNumber, message, apiKey, username } = opts;
    // Simulated mode: no credentials configured — record success without
    // contacting a provider.
    if (!apiKey || !username) {
        return {
            ok: true,
            providerMessageId: `STUB-${Date.now()}`,
        };
    }
    try {
        const res = await fetch(`${AT_SMS_ENDPOINT}?username=${encodeURIComponent(username)}&to=${encodeURIComponent(phoneNumber)}&message=${encodeURIComponent(message)}`, {
            method: 'POST',
            headers: {
                apiKey,
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        if (!res.ok) {
            return { ok: false, failureReason: `Provider returned HTTP ${res.status}` };
        }
        const body = (await res.json());
        const response = body?.SMSMessageData?.Recipients?.[0];
        return {
            ok: response?.status === 'Success' || response?.statusCode === 101,
            providerMessageId: response?.messageId,
            failureReason: response?.status !== 'Success' ? (response?.statusDescription ?? 'Unknown provider error') : undefined,
        };
    }
    catch (err) {
        return { ok: false, failureReason: err.message };
    }
}
//# sourceMappingURL=smsProvider.js.map