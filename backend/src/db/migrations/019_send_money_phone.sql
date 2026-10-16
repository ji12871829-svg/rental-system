-- Dedicated Send-Money receiving number, separate from the business contact
-- phone (calls, landlord alerts, receipt footers). Operators with two lines
-- point reminders at this number while keeping the other as their identity.
ALTER TABLE business_branding
  ADD COLUMN IF NOT EXISTS send_money_phone VARCHAR(30);
