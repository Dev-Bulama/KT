# Administrator guide: email, website content, logo and chatbot

All four screens are under **Administration** in the sidebar. Every change is recorded in the audit log.

| Screen | Path | Who can use it (default) | Permission |
|---|---|---|---|
| Email delivery (SMTP) | `/admin/email` | Super Administrator | `system.notifications.manage` |
| Website content | `/admin/site` | Super Administrator | `site.content.manage` |
| Branding & logo | `/admin/branding` | Super Administrator | `site.content.manage` |
| Chatbot widget | `/admin/chatbot` | Super Administrator | `system.settings.manage` |

`site.content.manage` can be given to another role (for example a communications officer's role) in **Roles & permissions**. It cannot be given to MDA roles.

---

## 1. Setting up SMTP email

The platform sends account emails (verification, invitations, password resets) and notification emails through a queue. A scheduled job delivers the queue every 5 minutes and retries failures.

### Steps

1. Get these details from your email administrator or provider:
   - SMTP host
   - port
   - encryption type
   - username and password (or app password)
   - the sender address you are allowed to use
2. Sign in as a Super Administrator and open **Administration › Email delivery (SMTP)**.
3. Fill in the form:
   - Set **Delivery method** to **SMTP server**.
   - Enter the **SMTP host**, **Port** and **Encryption** (see the table below).
   - Enter the **Username** and **Password**. The password is encrypted before it is stored and is never shown again. To keep the saved password, leave the field blank when you save later.
   - Enter the **Sender name** (e.g. *KATDICT Service Desk*) and the **Sender email address**. Optionally, add a **Reply-to** address.
4. Click **Save email settings**.
5. Under **Send a test email**, enter your own address and click **Send test email**. If the mail server rejects the connection or sign-in, its exact error is shown (for example *Invalid login* or *certificate has expired*).
6. Optional: open **Notification queue** and click **Run delivery now** to send anything already queued.

### Common settings

| Provider | Host | Port | Encryption | Notes |
|---|---|---|---|---|
| Microsoft 365 / Outlook | `smtp.office365.com` | 587 | STARTTLS | SMTP AUTH must be enabled for the mailbox in the Microsoft 365 admin centre. |
| Google Workspace / Gmail | `smtp.gmail.com` | 587 (or 465) | STARTTLS (or SSL/TLS) | Use an **App password** (requires 2-Step Verification). |
| Zoho Mail | `smtp.zoho.com` | 465 | SSL/TLS | |
| Own mail server / hosting (cPanel etc.) | e.g. `mail.example.gov.ng` | 587 or 465 | STARTTLS or SSL/TLS | Ask the host for the values. |

These values are the providers' commonly published defaults. Confirm them with your provider.

### Rules and behaviour

- **Encryption is required.** *None* is refused in production because the password would travel unencrypted. TLS certificates are always verified.
- **Precedence.** The admin SMTP settings override the `EMAIL_PROVIDER` / `SMTP_*` environment variables. To go back to the environment configuration, choose **Delivery method → Environment configuration**.
- **Deliverability.** The sender domain should have SPF, DKIM and DMARC records that authorise the SMTP server. Otherwise messages may land in spam.
- **Secret rotation.** If `AUTH_SECRET` is rotated, the stored SMTP password can no longer be decrypted. The test email then says so; re-enter the password.
- **Cloud hosting.** Use port 587 or 465. Port 25 is commonly blocked by cloud providers. After deploying, confirm with the test email that your host allows the outbound connection.

---

## 2. Editing website content (CMS)

**Administration › Website content** has a tab for each public page:

| Tab | What you can edit |
|---|---|
| Home | Main title, introduction, button labels, "How it works" steps (one per line), up to 9 feature cards (icon, title, text) |
| About | Page title and body |
| Service catalogue page | Title and introduction. The services themselves are edited in **Service catalogue**. |
| Contact | Introduction, service desk name, address, telephone, email, opening hours, closing note |
| Privacy notice | Title, subtitle and body. Have the final text approved by the State's legal/data-protection officers. |
| Announcement banner | Optional message across the top of every public page, with a style and an optional link |

- **Publishing.** **Publish changes** makes the edit live immediately. **Restore default content** brings back the original text for that section.
- **Formatting** in the longer text fields:

  | To get | Type |
  |---|---|
  | A new paragraph | a blank line |
  | A heading | `## Heading` |
  | A bulleted list | `- item` |
  | A numbered list | `1. item` |
  | Bold / italic | `**bold**` / `*italic*` |
  | A link | `[text](/contact)` or `[text](https://…)` |

- **HTML is not allowed.** It is shown as text, never executed. Links may only point to site pages, `https://`, `mailto:` or `tel:`.
- **No invented details.** Contact details shown on the site should be the confirmed official ones. Leave fields empty until they are confirmed.

## 3. Uploading the logo

**Administration › Branding & logo**

- **Logo file:** PNG, JPEG or WebP, up to 1 MB. A wide logo on a transparent background, about 360 × 72 px, works best.
  - SVG is not accepted, because an SVG file can contain script.
  - The file type is checked from the file's content, not its name.
- **Where it appears:** the public header, the sign-in pages and the workspace sidebar. In the sidebar it is placed on a white tile.
- **Name beside the logo:** the name, tagline and footer text can be edited on the same page. Turn off *Show the name and tagline* if the logo image already contains the name.
- **Remove logo** returns to the built-in mark.

## 4. Adding a chatbot widget (e.g. SkillyChat)

**Administration › Chatbot widget**

1. In your chatbot provider's dashboard, copy the website embed code. It usually looks like:
   ```html
   <script src="https://provider.example/widget.js" data-bot-id="YOUR-ID" defer></script>
   ```
2. Paste it into **Embed code**, enter the **Provider name** and choose where it appears:
   - **Public information pages only (recommended):** home, about, services, contact, privacy.
   - **Public pages and signed-in work pages:** also dashboards, requests, projects and so on.
3. Tick **Enable the widget** and save. Open the home page in a private window to check it. Changes can take up to a minute to reach every server.

What is checked, and why:

- **Snippet rules.** Only `<script>` tags are accepted. Scripts must load over HTTPS. Event-handler attributes (`onload=` …) and other HTML (`<div>`, `<iframe>`) are rejected. If your provider's code includes a `<div>`, the widget normally creates it itself; remove it and try.
- **Content-Security-Policy.** The browser security policy is widened only for the widget's own domain(s), and only on the pages where the widget may run.
- **Extra domains.** If the widget loads but cannot connect, the browser console names the blocked domain. Add it under **Additional allowed domains**.
- **Pages where it never runs.** Sign-in, registration, password reset, MFA, account-security and all administration pages, whatever the setting. If a visitor moves from a widget page to one of these, the page fully reloads so the widget's code is unloaded.
- **Trust.** A widget's code can read what is displayed on the pages it runs on. Use only a provider KATDICT has approved. Enable it on signed-in pages only after its data-protection terms are approved. Only Super Administrators can change this setting.
