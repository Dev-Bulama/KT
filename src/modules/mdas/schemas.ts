import { z } from "zod";
import { MdaCategory } from "@/generated/prisma/enums";

const optionalText = (max = 500) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const optionalEmail = z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("").transform(() => undefined));
const phone = z.string().trim().regex(/^[+0-9 ()-]{7,20}$/, "Enter a valid telephone number");
const optionalPhone = phone.optional().or(z.literal("").transform(() => undefined));
const optionalUrl = z
  .string()
  .trim()
  .url("Enter a full URL, e.g. https://example.kt.gov.ng")
  .refine((u) => /^https?:\/\//i.test(u), "Only http(s) URLs are allowed")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const mdaProfileSchema = z.object({
  name: z.string().trim().min(3, "Official name is required").max(200),
  abbreviation: z.string().trim().toUpperCase().min(2).max(20).regex(/^[A-Z0-9&.\-]+$/, "Use letters, numbers, & . -"),
  category: z.nativeEnum(MdaCategory),
  supervisingMinistryId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  address: z.string().trim().min(5, "Physical address is required").max(500),
  officialEmail: z.string().trim().toLowerCase().email("Enter the official email address").max(254),
  officialPhone: phone,
  contactPersonName: z.string().trim().min(3).max(120),
  contactPersonDesignation: z.string().trim().min(2).max(120),
  ictContactName: optionalText(120),
  ictContactEmail: optionalEmail,
  ictContactPhone: optionalPhone,
  website: optionalUrl,
  description: optionalText(2000),
});
export type MdaProfileInput = z.infer<typeof mdaProfileSchema>;

export const registrationSchema = z.object({
  representative: z.object({
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: phone,
    designation: z.string().trim().min(2).max(120),
    password: z.string(),
  }),
  /** Either claim an existing verified directory entry, or register a new MDA profile. */
  claimMdaId: z.string().cuid().optional(),
  profile: mdaProfileSchema,
});
export type RegistrationInput = z.infer<typeof registrationSchema>;

/** Columns accepted by the verified MDA directory CSV import. */
export const MDA_CSV_COLUMNS = [
  "name", "abbreviation", "category", "supervising_ministry_abbreviation", "address", "official_email",
  "official_phone", "contact_person", "contact_designation", "ict_contact_name", "ict_contact_email",
  "ict_contact_phone", "website",
] as const;

export const mdaCsvRowSchema = z.object({
  name: z.string().trim().min(3).max(200),
  abbreviation: z.string().trim().toUpperCase().min(2).max(20).regex(/^[A-Z0-9&.\-]+$/),
  category: z.string().trim().toUpperCase().pipe(z.nativeEnum(MdaCategory)),
  supervising_ministry_abbreviation: z.string().trim().toUpperCase().optional().transform((v) => v || undefined),
  address: optionalText(500),
  official_email: optionalEmail,
  official_phone: optionalPhone,
  contact_person: optionalText(120),
  contact_designation: optionalText(120),
  ict_contact_name: optionalText(120),
  ict_contact_email: optionalEmail,
  ict_contact_phone: optionalPhone,
  website: optionalUrl,
});
export type MdaCsvRow = z.infer<typeof mdaCsvRowSchema>;
