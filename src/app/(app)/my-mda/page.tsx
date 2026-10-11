import { redirect } from "next/navigation";
import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { getMda } from "@/modules/mdas/service";
import { prisma } from "@/lib/db";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Field, Input, Checkbox } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { MdaProfileFields } from "@/components/forms/mda-profile-fields";
import { formatDateTime, humanize } from "@/lib/utils";
import { activateMdaAction, inviteAction, memberStatusAction, revokeInviteAction, staffPolicyAction, transferRepAction, updateProfileAction } from "../mdas/actions";

export const metadata = { title: "My MDA" };

const STEPS = ["Registered", "Email verified", "KATDICT review", "Approved", "Activated"];

export default async function MyMda() {
  const actor = await requirePageActor();
  if (actor.userType !== "MDA_USER" || !actor.mdaId) redirect("/dashboard");
  const m = await getMda(actor, actor.mdaId);
  const ministries = await prisma.mda.findMany({ where: { category: "MINISTRY", status: { notIn: ["REJECTED"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const stage = m.status === "ACTIVE" ? 5 : m.status === "APPROVED" ? 4 : m.submittedAt ? 2 : 1;
  const isAdmin = actor.roles.includes("MDA_ADMIN");
  const canEdit = can(actor, "mda.profile.edit.own") && ["PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED", "ACTIVE"].includes(m.status);
  const manageUsers = can(actor, "mda.users.manage.own") && m.status === "ACTIVE";
  const primary = m.members.find((x) => x.isPrimaryRepresentative);
  return (
    <>
      <PageHeader title={m.name} description={`${m.abbreviation} · ${humanize(m.category)}`} actions={<StatusBadge status={m.status} />} />
      <ol className="mb-6 grid gap-2 text-sm sm:grid-cols-5">{STEPS.map((s, i) => <li key={s} className={`rounded-md border px-3 py-2 ${i < stage ? "border-green-200 bg-accent-100 text-accent-700" : i === stage ? "border-navy-700 bg-navy-50 font-medium" : "border-line text-muted"}`}>{i + 1}. {s}</li>)}</ol>
      {m.status === "PENDING_REVIEW" && <Alert tone="info" className="mb-4" title="Under KATDICT review">Your registration was submitted on {formatDateTime(m.submittedAt)}. You will be notified of the decision.</Alert>}
      {m.status === "CHANGES_REQUESTED" && <Alert tone="warning" className="mb-4" title="Corrections requested">{m.reviewNotes} — update the profile below; saving resubmits it for review.</Alert>}
      {m.status === "REJECTED" && <Alert tone="danger" className="mb-4" title="Registration not approved">{m.reviewNotes}</Alert>}
      {m.status === "SUSPENDED" && <Alert tone="danger" className="mb-4" title="Account suspended">{m.suspensionReason}</Alert>}
      {m.status === "APPROVED" && isAdmin && (
        <Card className="mb-6 border-green-300"><CardHeader title="Activate your institutional account" description="KATDICT approved your registration. Activating confirms you accept responsibility for managing your MDA's users and requests on this platform." /><CardBody>
          <ActionForm action={activateMdaAction} submitLabel="Activate account" submitVariant="accent" />
        </CardBody></Card>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <Card><CardHeader title="Institutional profile" /><CardBody>
          {canEdit ? (
            <ActionForm action={updateProfileAction} submitLabel={m.status === "CHANGES_REQUESTED" ? "Save and resubmit" : "Save profile"}>
              {(e) => (<><input type="hidden" name="id" value={m.id} /><input type="hidden" name="version" value={m.version} /><MdaProfileFields m={m} errors={e} ministries={ministries} lockName={m.isDirectoryVerified} /></>)}
            </ActionForm>
          ) : <p className="text-sm text-muted">The profile can be edited by your MDA administrator.</p>}
        </CardBody></Card>
        <div className="space-y-6">
          <Card><CardHeader title="Users" description={primary ? `Primary representative: ${primary.user.name}` : undefined} /><CardBody>
            <ul className="divide-y divide-line text-sm">{m.members.map((x) => (
              <li key={x.id} className="py-2">
                <div className="flex flex-wrap justify-between gap-2"><span>{x.user.name}{x.isPrimaryRepresentative && " ★"}<br /><span className="text-xs text-muted">{x.user.email} · {x.user.roles.map((r) => r.role.name).join(", ")}</span></span><StatusBadge status={x.user.status} /></div>
                {manageUsers && x.user.id !== actor.id && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <ActionForm inline action={memberStatusAction} submitLabel={x.user.status === "ACTIVE" ? "Suspend" : "Reactivate"} submitVariant="ghost"><input type="hidden" name="userId" value={x.user.id} /><input type="hidden" name="active" value={x.user.status === "ACTIVE" ? "false" : "true"} /></ActionForm>
                    {primary?.user.id === actor.id && x.user.roles.some((r) => r.role.key === "MDA_ADMIN") && <ActionForm inline action={transferRepAction} submitLabel="Make primary representative" submitVariant="ghost" confirm="Transfer the primary representative role?"><input type="hidden" name="userId" value={x.user.id} /></ActionForm>}
                  </div>
                )}
              </li>
            ))}</ul>
          </CardBody></Card>
          {manageUsers && (
            <>
              <Card><CardHeader title="Invite a user" description="Invitations expire after 7 days." /><CardBody>
                <ActionForm action={inviteAction} submitLabel="Send invitation" resetOnSuccess>
                  <input type="hidden" name="mdaId" value={m.id} />
                  <Field label="Official email" name="email" required><Input type="email" /></Field>
                  <Field label="Name" name="name"><Input /></Field>
                  <fieldset className="space-y-1 text-sm"><legend className="mb-1 font-medium">Role</legend>
                    <label className="flex items-center gap-2"><input type="radio" name="roleKeys" value="MDA_STAFF" defaultChecked /> MDA staff</label>
                    <label className="flex items-center gap-2"><input type="radio" name="roleKeys" value="MDA_ADMIN" /> MDA administrator</label>
                  </fieldset>
                </ActionForm>
                {m.invitations.length > 0 && (
                  <ul className="mt-4 space-y-2 border-t border-line pt-3 text-sm">{m.invitations.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2"><span>{i.email} <span className="text-xs text-muted">({i.roleKeys.map(humanize).join(", ")}, expires {formatDateTime(i.expiresAt)})</span></span>
                      <ActionForm inline action={revokeInviteAction} submitLabel="Revoke" submitVariant="ghost"><input type="hidden" name="invitationId" value={i.id} /></ActionForm></li>
                  ))}</ul>
                )}
              </CardBody></Card>
              <Card><CardHeader title="Internal submission policy" /><CardBody>
                <ActionForm action={staffPolicyAction} submitLabel="Save policy">
                  <Checkbox name="allowed" label="Allow MDA staff (not only administrators) to submit service requests" defaultChecked={m.staffMaySubmit} />
                </ActionForm>
              </CardBody></Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
