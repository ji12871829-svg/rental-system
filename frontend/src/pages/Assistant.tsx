// Staff copilot page — thin shell over the shared AssistantChat (also
// hosted by the floating cube widget, so both surfaces stay identical).
import { PageHeader } from '../components/ui';
import AssistantChat from '../components/assistant/AssistantChat';

export default function Assistant() {
  return (
    <div>
      <PageHeader
        title="Assistant"
        subtitle="Ask about rent, water, tenants and arrears — answers come from live data, reminders stay drafts until you approve them"
      />
      <AssistantChat />
    </div>
  );
}
