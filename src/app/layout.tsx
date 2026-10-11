import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "KATDICT Service & Project Intelligence Platform", template: "%s · KATDICT SPIMP" },
  description: "Katsina State Directorate of ICT — service requests, project governance and delivery intelligence for Ministries, Departments and Agencies.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0b2a5b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <body>
        <a href="#main" className="skip-link">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}
