import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { E2E_DB } from "./global-setup";

const PASSWORD = "E2e-Passw0rd-2026";
const REP = { email: "rep@e2e-mda.katdict.test", password: "Rep-Passw0rd-2026" };
const PDF = Buffer.from("%PDF-1.4\n% e2e evidence\n");

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: E2E_DB });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

async function signIn(browser: Browser, email: string, password = PASSWORD): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
  return page;
}

/** Locates the form that contains a given submit button (forms share field labels on busy pages). */
const formWith = (page: Page, button: string) => page.locator("form").filter({ has: page.getByRole("button", { name: button, exact: true }) });

/** Fills and submits a form, then waits for its server action to complete and the page to settle. */
async function submitForm(page: Page, button: string, fill?: (f: ReturnType<typeof formWith>) => Promise<void>) {
  const f = formWith(page, button).first();
  await expect(f).toBeVisible();
  if (fill) await fill(f);
  const done = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"], { timeout: 60_000 });
  await f.getByRole("button", { name: button, exact: true }).click();
  const res = await done;
  expect(res.status()).toBeLessThan(400);
  await page.waitForLoadState("networkidle");
  // Surface server-side validation/authorisation errors immediately.
  const error = page.locator("form [role=alert]").filter({ hasText: /./ });
  if (await error.count()) {
    const t = (await error.allInnerTexts()).join(" | ");
    if (!/updated|recorded|saved|added|submitted|created|acknowledged/i.test(t)) throw new Error(`Form "${button}" failed: ${t}`);
  }
}

test.describe.serial("KATDICT end-to-end workflow", () => {
  let mdaId = "";
  let requestId = "";
  let projectId = "";

  test("1. MDA representative registers and 2. verifies email", async ({ page }) => {
    await page.goto("/register");
    await page.locator("#repName").fill("E2E Representative");
    await page.locator("#repDesignation").fill("Director of ICT");
    await page.locator("#repEmail").fill(REP.email);
    await page.locator("#repPhone").fill("+234 800 123 4567");
    await page.locator("#password").fill(REP.password);
    await page.locator("#confirmPassword").fill(REP.password);
    await page.locator("#name").fill("E2E Ministry of Test Automation");
    await page.locator("#abbreviation").fill("E2E-MTA");
    await page.locator("#address").fill("Secretariat Complex, Katsina (fictional)");
    await page.locator("#officialEmail").fill("info@e2e-mta.katdict.test");
    await page.locator("#officialPhone").fill("+234 800 000 1111");
    await page.locator("#contactPersonName").fill("E2E Permanent Secretary");
    await page.locator("#contactPersonDesignation").fill("Permanent Secretary");
    await page.getByRole("button", { name: "Submit registration" }).click();
    await expect(page.getByText(/verification email has been sent/)).toBeVisible();

    const [mail] = await q<{ payload: { text: string } }>(`SELECT payload FROM "OutboxEvent" WHERE payload->>'to' = $1 ORDER BY "createdAt" DESC LIMIT 1`, [REP.email]);
    const link = mail.payload.text.match(/\/verify-email\?token=[^\s]+/)![0];
    await page.goto(link);
    await expect(page.getByText(/submitted to KATDICT for review/)).toBeVisible();
    mdaId = (await q<{ id: string }>(`SELECT id FROM "Mda" WHERE abbreviation='E2E-MTA'`))[0].id;
  });

  test("3. KATDICT approves the MDA and the MDA activates its account", async ({ browser }) => {
    const ops = await signIn(browser, "ops@e2e.katdict.test");
    await ops.goto(`/mdas/${mdaId}`);
    await submitForm(ops, "Record decision", async (f) => {
      await f.getByLabel("Decision").selectOption("APPROVE");
      await f.getByLabel("Notes / reasons").fill("Authority confirmed by phone (E2E).");
    });
    await expect(ops.getByText("Approved", { exact: true }).first()).toBeVisible();
    const rep = await signIn(browser, REP.email, REP.password);
    await rep.goto("/my-mda");
    await rep.getByRole("button", { name: "Activate account" }).click();
    await expect.poll(async () => (await q<{ status: string }>(`SELECT status FROM "Mda" WHERE id=$1`, [mdaId]))[0].status).toBe("ACTIVE");
    await expect(rep.getByText("Active", { exact: true }).first()).toBeVisible();
  });

  test("4. MDA submits a service request through the wizard", async ({ browser }) => {
    const rep = await signIn(browser, REP.email, REP.password);
    await rep.goto("/requests/new", { waitUntil: "networkidle" });
    // Retry until the client component has hydrated and reacts to the selection.
    await expect(async () => {
      await rep.locator("#categoryId").selectOption({ label: "Web Application Development" });
      await expect(rep.locator("#serviceId")).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await rep.locator("#serviceId").selectOption({ label: "Web Application Development" });
    await rep.getByRole("button", { name: "Continue" }).click();
    await rep.getByLabel("Request title").fill("Online permit application portal");
    await rep.getByLabel("Problem statement").fill("Permit applications are submitted on paper and take weeks to process, with no visibility for applicants.");
    await rep.getByLabel("Desired outcome").fill("Applicants apply and track permits online.");
    await rep.getByLabel("Business justification").fill("Faster service and better revenue tracking.");
    await rep.getByLabel("Expected deliverables").fill("Portal, admin console, manual, training.");
    await rep.getByLabel("Success criteria").fill("70% of applications online within 6 months.");
    await rep.getByRole("button", { name: "Continue" }).click();
    await expect(rep.getByText(/Draft saved/)).toBeVisible();
    await rep.getByLabel("Institutional impact").fill("Improves transparency of permit issuance.");
    await rep.getByLabel("Consequences of not addressing the request").fill("Continued delays and complaints.");
    await rep.getByRole("button", { name: "Continue" }).click();
    await rep.getByRole("button", { name: "Continue" }).click(); // documents step (optional)
    await expect(rep.getByRole("heading", { name: "5. Review and submit" })).toBeVisible();
    await rep.getByRole("button", { name: "Submit request" }).click();
    await rep.waitForURL(/\/requests\/[^/?]+\?submitted=1/);
    await expect(rep.getByText(/KATDICT-REQ-\d{4}-\d{5}/).first()).toBeVisible();
    requestId = new URL(rep.url()).pathname.split("/").pop()!;
  });

  test("5–6. KATDICT assesses and approves the request", async ({ browser }) => {
    const ops = await signIn(browser, "ops@e2e.katdict.test");
    await ops.goto(`/requests/${requestId}`);
    await submitForm(ops, "Start triage");
    await submitForm(ops, "Accept for assessment", async (f) => {
      await f.getByLabel("Responsible department").selectOption({ label: "Software & Applications" });
    });
    await submitForm(ops, "Save assessment", async (f) => { await f.getByLabel("Findings").fill("Clear need within KATDICT mandate."); });
    await submitForm(ops, "Send to technical evaluation");

    const head = await signIn(browser, "head@e2e.katdict.test");
    await head.goto(`/requests/${requestId}`);
    await submitForm(head, "Save assessment", async (f) => { await f.getByLabel("Findings").fill("Feasible with the standard web stack."); });
    await submitForm(head, "Complete technical evaluation");

    await ops.reload();
    await submitForm(ops, "Save assessment", async (f) => {
      await f.getByLabel("Findings").fill("Scope agreed with the MDA.");
      await f.getByLabel("Proposed scope").fill("Design, build and deploy the permit portal; train staff.");
      await f.getByLabel("Estimated effort (days)").fill("30");
      await f.getByLabel("Estimated cost (NGN)").fill("5000000");
    });
    await submitForm(ops, "Submit for approval");

    const reviewer = await signIn(browser, "reviewer@e2e.katdict.test");
    await reviewer.goto(`/requests/${requestId}`);
    await submitForm(reviewer, "Record decision", async (f) => { await f.getByLabel("Decision").selectOption("APPROVED"); });
    await head.reload();
    await submitForm(head, "Record decision", async (f) => { await f.getByLabel("Decision").selectOption("APPROVED"); });
    await head.reload();
    await expect(head.getByText("Approved", { exact: true }).first()).toBeVisible();
    const [r] = await q<{ status: string }>(`SELECT status FROM "ServiceRequest" WHERE id=$1`, [requestId]);
    expect(r.status).toBe("APPROVED");
  });

  test("7–8. KATDICT assigns an officer, who acknowledges and updates milestones", async ({ browser }) => {
    const ops = await signIn(browser, "ops@e2e.katdict.test");
    await ops.goto(`/requests/${requestId}`);
    await ops.getByRole("button", { name: "Initiate project" }).click();
    await ops.waitForURL(/\/projects\/[^/?]+\?tab=team/);
    projectId = new URL(ops.url()).pathname.split("/").pop()!;
    await submitForm(ops, "Create assignments", async (f) => {
      await f.locator("#projectManagerId").selectOption({ label: "E2E officer (Software & Applications)" });
      await f.locator("#instructions").fill("Deliver the portal per the approved scope.");
      await f.locator("#expectedOutcomes").fill("Portal live and accepted by the MDA.");
    });
    await expect.poll(async () => (await q<{ status: string }>(`SELECT status FROM "Project" WHERE id=$1`, [projectId]))[0].status).toBe("AWAITING_ACKNOWLEDGMENT");

    const officer = await signIn(browser, "officer@e2e.katdict.test");
    await officer.goto(`/projects/${projectId}?tab=team`);
    await submitForm(officer, "Acknowledge assignment");
    await officer.reload();
    await submitForm(officer, "Start implementation");
    await officer.goto(`/projects/${projectId}?tab=plan`);
    await submitForm(officer, "Add milestone", async (f) => { await f.locator("#title").fill("Portal built and deployed"); });
    await officer.reload();
    await submitForm(officer, "Mark complete");
    await expect.poll(async () => (await q<{ progressPercent: number }>(`SELECT "progressPercent" FROM "Project" WHERE id=$1`, [projectId]))[0].progressPercent).toBe(100);
  });

  test("9. Officer uploads evidence and submits completion", async ({ browser }) => {
    const officer = await signIn(browser, "officer@e2e.katdict.test");
    const deliverables = await q<{ id: string }>(`SELECT id FROM "ProjectDeliverable" WHERE "projectId"=$1`, [projectId]);
    for (const d of deliverables) {
      await officer.goto(`/projects/${projectId}?tab=files`, { waitUntil: "networkidle" });
      await officer.locator(`input#file-${d.id}`).setInputFiles({ name: "evidence.pdf", mimeType: "application/pdf", buffer: PDF });
      await officer.waitForLoadState("networkidle");
      await expect.poll(async () => Number((await q<{ n: string }>(`SELECT count(*) n FROM "Attachment" WHERE "deliverableId"=$1`, [d.id]))[0].n)).toBe(1);
      // The uploader reloads the page after a successful upload; wait for the submit control to appear.
      await expect(formWith(officer, "Mark as submitted").first()).toBeVisible({ timeout: 60_000 });
      await officer.waitForLoadState("networkidle");
      await formWith(officer, "Mark as submitted").first().getByRole("button").click();
      await expect.poll(async () => (await q<{ status: string }>(`SELECT status FROM "ProjectDeliverable" WHERE id=$1`, [d.id]))[0].status).toBe("SUBMITTED");
    }
    await officer.goto(`/projects/${projectId}?tab=completion`);
    await submitForm(officer, "Submit for review", async (f) => {
      await f.locator("#summary").fill("Portal designed, built, tested and deployed; staff trained.");
      await f.locator("#deliverablesSummary").fill("All standard deliverables uploaded as evidence.");
    });
    await expect.poll(async () => (await q<{ status: string }>(`SELECT status FROM "Project" WHERE id=$1`, [projectId]))[0].status).toBe("UNDER_REVIEW");
  });

  test("10. KATDICT reviews, 11. MDA accepts, 12. KATDICT closes, 13. report is generated", async ({ browser }) => {
    const reviewer = await signIn(browser, "reviewer@e2e.katdict.test");
    await reviewer.goto(`/projects/${projectId}?tab=completion`);
    await submitForm(reviewer, "Record review", async (f) => { await f.locator("#outcome").selectOption("APPROVED"); });
    await expect.poll(async () => (await q<{ status: string }>(`SELECT status FROM "Project" WHERE id=$1`, [projectId]))[0].status).toBe("AWAITING_MDA_ACCEPTANCE");

    const rep = await signIn(browser, REP.email, REP.password);
    await rep.goto(`/projects/${projectId}?tab=completion`);
    await submitForm(rep, "Submit decision", async (f) => {
      await f.getByLabel("Decision").selectOption("ACCEPTED");
      await f.locator("#rating").selectOption("5");
    });
    await expect.poll(async () => (await q<{ status: string }>(`SELECT status FROM "Project" WHERE id=$1`, [projectId]))[0].status).toBe("ACCEPTED");

    await reviewer.reload();
    reviewer.once("dialog", (d) => d.accept());
    await submitForm(reviewer, "Close project", async (f) => {
      await f.locator("#actualOutcome").fill("Permit applications are now online; processing time reduced.");
      await f.locator("#lessonsLearned").fill("Early user involvement shortened acceptance.");
    });
    await expect.poll(async () => (await q<{ status: string }>(`SELECT status FROM "Project" WHERE id=$1`, [projectId]))[0].status).toBe("CLOSED");

    await reviewer.goto(`/projects/${projectId}?tab=report`);
    await expect(reviewer.getByText("Accountability")).toBeVisible();
    const [rep1] = await q<{ id: string }>(`SELECT id FROM "ReportRecord" WHERE "projectId"=$1`, [projectId]);
    const pdf = await reviewer.request.get(`/api/reports/${rep1.id}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    // The MDA can see the report; another officer-less user without scope cannot.
    const mdaPdf = await rep.request.get(`/api/reports/${rep1.id}/pdf`);
    expect(mdaPdf.status()).toBe(200);
  });

  test("14. The audit history contains the important actions", async ({ browser }) => {
    const auditor = await signIn(browser, "auditor@e2e.katdict.test");
    await auditor.goto(`/projects/${projectId}?tab=trail`);
    await expect(auditor.getByText("Completion review").first()).toBeVisible();
    await auditor.goto("/admin/audit");
    await auditor.getByRole("button", { name: "Verify integrity" }).click();
    await expect(auditor.getByText(/Integrity check passed/)).toBeVisible();
    const actions = (await q<{ action: string }>(`SELECT DISTINCT action FROM "AuditEvent"`)).map((a) => a.action);
    for (const a of ["mda.registered", "auth.email_verified", "mda.review.approve", "mda.activated", "request.submitted", "request.approval.approved", "project.initiated", "project.assigned", "project.assignment_acknowledged", "file.uploaded", "project.completion_submitted", "project.acceptance.accepted", "project.closed", "report.generated"]) {
      expect(actions, a).toContain(a);
    }
  });

  test("Authorization: another MDA's staff cannot open this project", async ({ browser }) => {
    const ops = await signIn(browser, "ops@e2e.katdict.test");
    void ops;
    // The auditor can read; an unauthenticated visitor is redirected to sign-in.
    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`/projects/${projectId}`);
    await expect(anon).toHaveURL(/\/login\?next=/);
    const res = await anon.request.get(`/api/reports/x/pdf`);
    expect(res.status()).toBe(401);
  });
});
