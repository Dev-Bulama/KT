import Link from "next/link";
import { requirePageActorAny } from "@/modules/auth/current";
import { can, canAny } from "@/modules/rbac/authorize";
import { listComplaints, listFeedback } from "@/modules/feedback/service";
import { prisma } from "@/lib/db";
import { projectScope } from "@/modules/rbac/scope";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, humanize } from "@/lib/utils";
import { complaintAction } from "./actions";

export const metadata = { title: "Feedback & complaints" };

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requirePageActorAny(["feedback.submit", "feedback.read.all", "complaint.submit", "complaint.manage", "complaint.read.all"]);
  const tab = sp.tab === "complaints" ? "complaints" : "feedback";
  const [feedback, complaints, projects] = await Promise.all([
    listFeedback(actor), listComplaints(actor, sp.status),
    can(actor, "complaint.submit") ? prisma.project.findMany({ where: projectScope(actor), select: { id: true, reference: true, title: true }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
  ]);
  return (
    <>
      <PageHeader title="Feedback & complaints" description="Ratings on delivered projects and formal complaints. Analysis feeds continuous improvement, separate from personnel evaluation." />
      <Tabs basePath="/feedback" active={tab} tabs={[{ key: "feedback", label: "Feedback", count: feedback.length }, { key: "complaints", label: "Complaints", count: complaints.length }]} />
      {tab === "feedback" && (
        feedback.length === 0 ? <EmptyState title="No feedback yet" description={actor.userType === "MDA_USER" ? "You can rate a project once you have accepted its deliverables (Project › Completion & acceptance)." : undefined} /> : (
          <Table caption="Feedback"><THead><tr><TH>Project</TH><TH>MDA</TH><TH>Rating</TH><TH>Comments</TH><TH>By</TH><TH>Date</TH></tr></THead>
            <tbody>{feedback.map((f) => <TR key={f.id}><TD>{f.project ? <Link href={`/projects/${f.project.id}`}>{f.project.reference}</Link> : "—"}</TD><TD>{f.mda.name}</TD><TD aria-label={`${f.rating} out of 5`}>{"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)}</TD><TD className="max-w-md text-sm">{f.comments ?? "—"}</TD><TD>{f.user.name}</TD><TD className="text-muted">{formatDate(f.createdAt)}</TD></TR>)}</tbody>
          </Table>
        )
      )}
      {tab === "complaints" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div>
            {complaints.length === 0 ? <EmptyState title="No complaints" /> : (
              <Table caption="Complaints"><THead><tr><TH>Reference</TH><TH>Subject</TH><TH>MDA</TH><TH>Priority</TH><TH>Status</TH><TH>Raised</TH></tr></THead>
                <tbody>{complaints.map((c) => <TR key={c.id}><TD className="font-medium"><Link href={`/complaints/${c.id}`}>{c.reference}</Link></TD><TD>{c.subject}</TD><TD>{c.mda.abbreviation}</TD><TD><StatusBadge status={c.priority} /></TD><TD><StatusBadge status={c.status} /></TD><TD className="text-muted">{formatDate(c.createdAt)}</TD></TR>)}</tbody>
              </Table>
            )}
          </div>
          {can(actor, "complaint.submit") && (
            <Card><CardHeader title="Raise a complaint" /><CardBody>
              <ActionForm action={complaintAction} submitLabel="Submit complaint" resetOnSuccess>
                {(e) => (<>
                  <Field label="Subject" name="subject" required error={e.subject}><Input /></Field>
                  <Field label="Description" name="description" required error={e.description}><Textarea rows={4} /></Field>
                  <Field label="Priority" name="priority"><Select defaultValue="MEDIUM">{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select></Field>
                  <Field label="Related project (optional)" name="projectId"><Select defaultValue=""><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.reference} — {p.title}</option>)}</Select></Field>
                </>)}
              </ActionForm>
            </CardBody></Card>
          )}
        </div>
      )}
    </>
  );
}
