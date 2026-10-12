import {
  Activity, BookOpen, Image, Mail, MessageCircle, PanelsTopLeft, Building, Building2, ClipboardList, FileBarChart, FolderKanban, KeyRound, Layers, LayoutDashboard, LineChart,
  MessageSquareWarning, Network, ScrollText, Send, Settings, ShieldCheck, Siren, Sparkles, Stamp, Users,
} from "lucide-react";

const ICONS = { Activity, BookOpen, Image, Mail, MessageCircle, PanelsTopLeft, Building, Building2, ClipboardList, FileBarChart, FolderKanban, KeyRound, Layers, LayoutDashboard, LineChart, MessageSquareWarning, Network, ScrollText, Send, Settings, ShieldCheck, Siren, Sparkles, Stamp, Users };

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const I = ICONS[name as keyof typeof ICONS] ?? LayoutDashboard;
  return <I className={className} aria-hidden />;
}
