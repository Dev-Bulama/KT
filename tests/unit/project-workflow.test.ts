import { describe, expect, it } from "vitest";
import { checkProjectTransition, availableProjectActions } from "@/modules/projects/workflow";
import { DEFAULT_ROLES } from "@/modules/rbac/permissions";

const perms = (key: string) => new Set<string>(DEFAULT_ROLES.find((r) => r.key === key)!.permissions);

describe("project workflow", () => {
  it("officer can start assigned work but not unassigned work", () => {
    expect(checkProjectTransition("start_work", "ASSIGNED", { permissions: perms("PROJECT_OFFICER"), isAssigned: true })).toMatchObject({ ok: true });
    expect(checkProjectTransition("start_work", "ASSIGNED", { permissions: perms("PROJECT_OFFICER"), isAssigned: false })).toMatchObject({ ok: false, code: "NOT_ASSIGNED" });
  });

  it("officer cannot close, cancel or put projects on hold", () => {
    const ctx = { permissions: perms("PROJECT_OFFICER"), isAssigned: true };
    expect(checkProjectTransition("close", "ACCEPTED", ctx)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(checkProjectTransition("cancel", "IN_PROGRESS", ctx, "x")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(checkProjectTransition("put_on_hold", "IN_PROGRESS", ctx, "x")).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("standard closure only from ACCEPTED", () => {
    const ctx = { permissions: perms("OPERATIONS_ADMIN"), isAssigned: false };
    expect(checkProjectTransition("close", "IN_PROGRESS", ctx)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(checkProjectTransition("close", "UNDER_REVIEW", ctx)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(checkProjectTransition("close", "ACCEPTED", ctx)).toMatchObject({ ok: true });
  });

  it("exceptional closure requires the exceptional permission and a reason", () => {
    expect(checkProjectTransition("close_exceptional", "IN_PROGRESS", { permissions: perms("OPERATIONS_ADMIN"), isAssigned: false }, "x")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(checkProjectTransition("close_exceptional", "IN_PROGRESS", { permissions: perms("DIRECTOR"), isAssigned: false })).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(checkProjectTransition("close_exceptional", "IN_PROGRESS", { permissions: perms("DIRECTOR"), isAssigned: false }, "Directive")).toMatchObject({ ok: true });
  });

  it("MDA and auditor roles have no execution actions", () => {
    expect(availableProjectActions("IN_PROGRESS", { permissions: perms("MDA_ADMIN"), isAssigned: false })).toEqual([]);
    expect(availableProjectActions("IN_PROGRESS", { permissions: perms("AUDITOR"), isAssigned: false })).toEqual([]);
  });
});
