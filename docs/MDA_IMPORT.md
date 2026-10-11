# Verified MDA directory import

The platform ships **without** official MDA names. KATDICT loads the verified official directory (about 120 MDAs) through a controlled, validated import.

## File format

UTF-8 CSV with a header row. Template: [`docs/samples/mda-directory-TEMPLATE.csv`](samples/mda-directory-TEMPLATE.csv).

| Column | Required | Rules |
|---|---|---|
| `name` | yes | 3–200 chars; unique (case-insensitive) |
| `abbreviation` | yes | 2–20 chars `A–Z 0–9 & . -`; unique |
| `category` | yes | MINISTRY, DEPARTMENT, AGENCY, COMMISSION, BOARD, PARASTATAL, INSTITUTION, OTHER |
| `supervising_ministry_abbreviation` | no | must exist in the file or the database |
| `address`, `contact_person`, `contact_designation`, `ict_contact_name` | no | free text |
| `official_email`, `ict_contact_email` | no | valid email |
| `official_phone`, `ict_contact_phone` | no | 7–20 chars of digits, spaces, `+()-` |
| `website` | no | full http(s) URL |

## Process

1. **Validate (dry run):** Admin › MDA directory › Import → *Validate*, or `npm run mda:import -- verified.csv`. Every row is checked for types, required fields, duplicates within the file and conflicts with existing records. Nothing is written.
2. **Review the plan:** each row shows `create`, `update` or `error` with reasons.
3. **Apply:** only possible when there are zero errors. The import runs in one transaction (all-or-nothing) and records an audit event with counts. CLI: `npm run mda:import -- verified.csv --apply --actor admin@…` (the actor needs `mda.import`).

## Effects

- New rows become MDAs in status `DIRECTORY` with `isDirectoryVerified=true`; they have no users yet.
- Existing MDAs matched by name or abbreviation are updated, **except** MDAs that are `APPROVED`, `ACTIVE` or `SUSPENDED`, whose self-maintained profile is preserved (only the verified flag is set).
- During registration, a representative may **claim** a `DIRECTORY` entry; the verified name and abbreviation stay authoritative and the claim still requires KATDICT review. A directory entry can be claimed only once; further staff must be invited by the MDA administrator.
