import "dotenv/config";
import { prisma } from "../src/lib/db";
import { verifyAuditChain } from "../src/modules/audit/audit";

verifyAuditChain()
  .then(async (r) => {
    console.log(JSON.stringify(r, null, 2));
    await prisma.$disconnect();
    process.exit(r.ok ? 0 : 2);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
