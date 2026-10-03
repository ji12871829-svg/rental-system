-- 009_whatsapp_payment_confirmation.sql
-- Adds the 9th template kind: WHATSAPP_PAYMENT_CONFIRMATION — the WhatsApp
-- click-to-chat payment thank-you (whatsappPaymentConfirmationMessage in
-- backend/src/utils/businessRules.ts), which was missing from the original
-- 8-kind CHECK constraint in 008. Existing installs that already applied 008
-- need this to widen the constraint in place; fresh installs already get the
-- full 9-kind list from the updated 008, so this is a harmless no-op there.

ALTER TABLE message_templates DROP CONSTRAINT IF EXISTS message_templates_kind_check;
ALTER TABLE message_templates ADD CONSTRAINT message_templates_kind_check CHECK (kind IN (
  'SMS_RENT_RECEIPT', 'SMS_WATER_RECEIPT', 'SMS_COMBINED_RECEIPT',
  'SMS_BALANCE_DUE', 'SMS_OVERDUE',
  'WHATSAPP_BALANCE_DUE', 'WHATSAPP_OVERDUE', 'WHATSAPP_PAYMENT_CONFIRMATION',
  'EMAIL_CAMPAIGN'
));