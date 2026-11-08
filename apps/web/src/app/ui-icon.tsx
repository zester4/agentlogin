import type { SVGProps, ReactNode } from "react";

type IconName =
  | "grid" | "settings" | "shield" | "key" | "book" | "logout" | "arrow"
  | "globe" | "bot" | "ticket" | "inbox" | "activity" | "users" | "code"
  | "lock" | "clock" | "check" | "database" | "command" | "chevron" | "plus" | "sun" | "moon";

const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.8 3.12-.08-.02a1.7 1.7 0 0 0-1.8.7l-.04.07h-3.6l-.04-.08a1.7 1.7 0 0 0-1.8-.69l-.08.02-1.8-3.12.06-.06A1.7 1.7 0 0 0 9.2 15l-.08-.04v-3.6l.08-.04a1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.8-3.12.08.02a1.7 1.7 0 0 0 1.8-.7l.04-.07h3.6l.04.08a1.7 1.7 0 0 0 1.8.69l.08-.02 1.8 3.12-.06.06A1.7 1.7 0 0 0 19.8 11l.08.04v3.6z"/></>,
  shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/></>,
  key: <><circle cx="8" cy="15" r="5"/><path d="m11.5 11.5 8-8L22 6l-2 2 2 2-3 3-2-2-2 2"/></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20"/></>,
  logout: <><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
  arrow: <><path d="M7 17 17 7"/><path d="M7 7h10v10"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
  bot: <><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/></>,
  ticket: <><path d="M3 8a2 2 0 0 0 0 4v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 0 0-4V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><path d="M13 4v2m0 4v2m0 4v2"/></>,
  inbox: <><path d="M4 4h16l2 11v4H2v-4z"/><path d="M2 14h5l2 3h6l2-3h5"/></>,
  activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  code: <><path d="m8 17-5-5 5-5m8 10 5-5-5-5m-2-7-4 20"/></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  check: <><path d="m5 12 4 4L19 6"/></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
  command: <><path d="M9 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2z"/></>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  plus: <><path d="M12 5v14M5 12h14"/></>,\n  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,\n  moon: <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.7 8.7 0 1 0 20.5 14.2z"/>,
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
