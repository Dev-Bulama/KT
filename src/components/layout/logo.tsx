export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill={light ? "#ffffff" : "#0b2a5b"} />
        <path d="M9 8v16M9 16l9-8M9 16l9 8" stroke={light ? "#0b2a5b" : "#ffffff"} strokeWidth="3" strokeLinecap="round" fill="none" />
        <circle cx="23" cy="16" r="3" fill="#128052" />
      </svg>
      <span className={`leading-tight ${light ? "text-white" : "text-navy-950"}`}>
        <span className="block text-sm font-bold tracking-wide">KATDICT</span>
        <span className={`block text-[10px] ${light ? "text-navy-100" : "text-muted"}`}>Service &amp; Project Intelligence</span>
      </span>
    </span>
  );
}
