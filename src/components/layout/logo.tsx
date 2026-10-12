import { getLogoMeta, getSiteContent } from "@/modules/site/content";

function DefaultMark({ light }: { light: boolean }) {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill={light ? "#ffffff" : "#0b2a5b"} />
      <path d="M9 8v16M9 16l9-8M9 16l9 8" stroke={light ? "#0b2a5b" : "#ffffff"} strokeWidth="3" strokeLinecap="round" fill="none" />
      <circle cx="23" cy="16" r="3" fill="#128052" />
    </svg>
  );
}

/** Site logo: the uploaded image (Admin › Branding & logo) or the built-in mark, with the configurable name and tagline. */
export async function Logo({ light = false }: { light?: boolean }) {
  const [logo, branding] = await Promise.all([getLogoMeta(), getSiteContent("branding")]);
  const showText = branding.showTextWithLogo || !logo;
  return (
    <span className="inline-flex items-center gap-2">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- served from our own route with long-lived caching
        <img
          src={`/api/site/logo?v=${logo.version}`}
          alt={showText ? "" : branding.siteName}
          className={`h-9 w-auto object-contain ${showText ? "max-w-[120px]" : "max-w-[200px]"} ${light ? "rounded bg-white p-0.5" : ""}`}
        />
      ) : (
        <DefaultMark light={light} />
      )}
      {showText && (
        <span className={`min-w-0 leading-tight ${light ? "text-white" : "text-navy-950"}`}>
          <span className="block text-sm font-bold tracking-wide">{branding.siteName}</span>
          {branding.tagline && <span className={`block text-[10px] ${light ? "text-navy-100" : "text-muted"}`}>{branding.tagline}</span>}
        </span>
      )}
    </span>
  );
}
