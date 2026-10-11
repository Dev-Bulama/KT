import Link from "next/link";
import { EmptyState } from "@/components/ui/misc";

export default function NotFound() {
  return <EmptyState title="Record not found" description="It does not exist, or you are not authorised to view it." action={<Link href="/dashboard">Back to dashboard</Link>} />;
}
