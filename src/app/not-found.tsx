import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">The page does not exist or you are not authorised to view it.</p>
      <p className="mt-6"><Link href="/">Return to the home page</Link></p>
    </main>
  );
}
