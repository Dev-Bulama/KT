-- CreateTable
CREATE TABLE "SiteContent" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SiteAsset" (
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteAsset_pkey" PRIMARY KEY ("key")
);


-- Branding assets are small by design.
ALTER TABLE "SiteAsset" ADD CONSTRAINT "SiteAsset_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 1048576);

-- New permission for editing public website content and branding. Existing
-- databases get it here (the base seed never overwrites role permissions);
-- it is granted to the Super Administrator role and can be delegated in Roles.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES (gen_random_uuid()::text, 'site.content.manage', 'site', 'Edit public website content, branding and logo')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE r."key" = 'SUPER_ADMIN' AND p."key" = 'site.content.manage'
ON CONFLICT DO NOTHING;
