import type { SVGProps } from "react";
type IconName = "grid" | "settings" | "shield" | "key" | "book" | "logout" | "arrow";
const paths: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.8 3.12-.08-.02a1.7 1.7 0 0 0-1.8.7l-.04.07h-3.6l-.04-.08a1.7 1.7 0 0 0-1.8-.69l-.08.02-1.8-3.12.06-.06A1.7 1.7 0 0 0 9.2 15l-.08-.04v-3.6l.08-.04a1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.8-3.12.08.02a1.7 1.7 0 0 0 1.8-.7l.04-.07h3.6l.04.08a1.7 1.7 0 0 0 1.8.69l.08-.02 1.8 3.12-.06.06A1.7 1.7 0 0 0 19.8 11l.08.04v3.6z"/></>,
  shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/></>,
  key: <><circle cx="8" cy="15" r="5"/><path d="m11.5 11.5 8-8L22 6l-2 2 2 2-3 3-2-2-2 2"/></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20"/></>,
  logout: <><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
  arrow: <><path d="M7 17 17 7"/><path d="M7 7h10v10"/></>
};
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & {name: IconName}) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
