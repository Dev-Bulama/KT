import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { getAIProvider } from "@/modules/ai/provider";
import { getSetting } from "@/modules/settings/service";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AnalyticsPanel, AssistantPanel } from "./panels";
import { analyticsAction, assistantAction } from "./actions";

export const metadata = { title: "AI assistant" };

const EXAMPLES = ["Which projects are overdue this month?", "Which MDAs have the highest number of unresolved ICT requests?", "How many cybersecurity requests are currently under assessment?", "Which departments have the highest project backlog?", "Show completed projects with delayed delivery.", "Summarize the major ICT delivery risks for this quarter."];

export default async function Assistant() {
  const actor = await requirePageActor("ai.use");
  const configured = !!getAIProvider();
  const approved = await getSetting("ai.externalProcessingApproved");
  return (
    <>
      <PageHeader title="AI assistant" description="Answers are limited to records you are authorised to access, cite their sources, and never perform actions on your behalf." />
      {(!configured || !approved) && <Alert tone="info" className="mb-4" title="Deterministic mode">{!configured ? "No external AI provider is configured." : "External AI processing has not been approved under the data-governance policy."} The assistant and analytics still work using rule-based retrieval and routing.</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Platform assistant" /><CardBody><AssistantPanel action={assistantAction} /></CardBody></Card>
        {can(actor, "ai.analytics") && <Card><CardHeader title="Natural-language analytics" /><CardBody><AnalyticsPanel action={analyticsAction} examples={EXAMPLES} /></CardBody></Card>}
      </div>
    </>
  );
}
