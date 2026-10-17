-- 021_whatsapp_template_params.sql
-- Approved WhatsApp TEMPLATE sends (see whatsappProvider): when the operator
-- has registered a template (WHATSAPP_TEMPLATE_REMINDER /
-- WHATSAPP_TEMPLATE_FINAL_NOTICE) the send payload is the template name plus
-- its body parameters, not the free-form letter.
--
-- The parameters are persisted ON THE ROW because the retry sweep must replay
-- exactly what the operator approved when they pressed Send — recomputing
-- figures days later would send amounts that no longer match the ledger at
-- approval time. template_kind (null for WhatsApp rows until now) records the
-- template NAME for template rows; template_params holds the parameter array
-- in the canonical registration order ({{1}}..{{6}}).

ALTER TABLE whatsapp_notifications
  ADD COLUMN IF NOT EXISTS template_params JSONB;
