import { describe, expect, it } from "vitest";
import { availableRequestActions, checkRequestTransition, REQUEST_TRANSITIONS } from "@/modules/requests/workflow";
import { DEFAULT_ROLES } from "@/modules/rbac/permissions";

const perms = (key: string) => new Set<string>(DEFAULT_ROLES.find((r) => r.key === key)!.permissions);

describe("request workflow state machine", () => {
  it("derives the target status from the action, never from input", () => {
    const r = checkRequestTransition("start_triage", "SUBMITTED", perms("OPERATIONS_ADMIN"));
    expect(r).toMatchObject({ ok: true, to: "INITIAL_TRIAGE" });
  });

  it("rejects unknown actions and arbitrary status strings", () => {
    expect(checkRequestTransition("APPROVED", "SUBMITTED", perms("SUPER_ADMIN"))).toMatchObject({ ok: false, code: "UNKNOWN_ACTION" });
    expect(checkRequestTransition("__proto__", "SUBMITTED", perms("SUPER_ADMIN"))).toMatchObject({ ok: false, code: "UNKNOWN_ACTION" });
  });

  it("rejects transitions from invalid states", () => {
    expect(checkRequestTransition("submit_for_approval", "SUBMITTED", perms("OPERATIONS_ADMIN"))).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(checkRequestTransition("reject", "APPROVED", perms("DIRECTOR"))).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("enforces permissions", () => {
    expect(checkRequestTransition("start_triage", "SUBMITTED", perms("MDA_ADMIN"))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(checkRequestTransition("reject", "UNDER_ASSESSMENT", perms("PROJECT_OFFICER"))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(checkRequestTransition("reject", "UNDER_ASSESSMENT", perms("AUDITOR"))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("requires reasons where configured", () => {
    expect(checkRequestTransition("reject", "UNDER_ASSESSMENT", perms("OPERATIONS_ADMIN"))).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(checkRequestTransition("reject", "UNDER_ASSESSMENT", perms("OPERATIONS_ADMIN"), "  ")).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(checkRequestTransition("reject", "UNDER_ASSESSMENT", perms("OPERATIONS_ADMIN"), "Out of mandate")).toMatchObject({ ok: true, to: "REJECTED" });
  });

  it("supports the clarification loop back to assessment", () => {
    expect(checkRequestTransition("request_information", "UNDER_ASSESSMENT", perms("OPERATIONS_ADMIN"), "Need floor plan")).toMatchObject({ ok: true, to: "NEEDS_INFORMATION" });
    expect(checkRequestTransition("mda_respond", "NEEDS_INFORMATION", perms("MDA_ADMIN"), "Attached")).toMatchObject({ ok: true, to: "UNDER_ASSESSMENT" });
  });

  it("lists only actions the actor may take", () => {
    expect(availableRequestActions("SUBMITTED", perms("MDA_ADMIN"))).toEqual(["withdraw"]);
    expect(availableRequestActions("SUBMITTED", perms("OPERATIONS_ADMIN"))).toContain("start_triage");
    expect(availableRequestActions("APPROVAL_REVIEW", perms("AUDITOR"))).toEqual([]);
  });

  it("every transition rule targets a defined status set", () => {
    for (const [k, r] of Object.entries(REQUEST_TRANSITIONS)) {
      expect(r.from.length, k).toBeGreaterThan(0);
      expect(r.permissions.length, k).toBeGreaterThan(0);
    }
  });
});
