// Glidna custom icon set — replaces emoji across the app with a cohesive,
// on-brand line-icon family (cyan #08DCE0 on near-black). One <Icon> component,
// many named glyphs. Drawn on a 24×24 grid, 1.8 stroke, round caps/joins.
//
// Usage:  <Icon name="home" size={18} />                      (outline, inherits color)
//         <Icon name="flame" size={20} color="var(--accent)" /> (cyan)
//         <Icon name="target" variant="duotone" />            (soft cyan fill)
//         <Icon name="bell" variant="solid" />                (filled — best on closed shapes)
//
// variant: "outline" (default) | "duotone" | "solid".
// Most glyphs are designed primarily for outline; closed shapes (flame, droplet,
// bell, target, sparkle, water) also read well filled.

const GLYPHS = {
  // — Navigation / chrome —
  home: (<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" /><path d="M9.5 21v-6h5v6" /></>),
  dashboard: (<><path d="M3.5 21h17" /><path d="M6 21V11" /><path d="M12 21V4.5" /><path d="M18 21v-6.5" /></>),
  clients: (<><circle cx="9" cy="8" r="3.1" /><path d="M3.6 20a5.4 5.4 0 0 1 10.8 0" /><path d="M16 5.3a3 3 0 0 1 0 5.4" /><path d="M17.4 14.3A5.4 5.4 0 0 1 20.4 19.4" /></>),
  bell: (<><path d="M6 11a6 6 0 1 1 12 0v4l1.6 3H4.4L6 15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>),
  bellOff: (<><path d="M6 11a6 6 0 1 1 12 0v4l1.6 3H4.4L6 15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /><path d="M3.5 3.5 20.5 20.5" /></>),
  search: (<><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.7-4.7" /></>),
  invite: (<><path d="M22 2 11 13" /><path d="M22 2 15 22 11 13 2 9z" /></>),
  signout: (<><path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8" /><path d="M10 12h11" /><path d="m18 9 3 3-3 3" /></>),
  edit: (<><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="m14 7 3 3" /></>),
  close: (<><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>),
  plus: (<><path d="M12 5v14" /><path d="M5 12h14" /></>),
  // — Fitness / data —
  flame: (<path d="M12 2.5c3.2 4 5.3 6.3 5.3 10.2a5.3 5.3 0 0 1-10.6 0C6.7 9.9 8.6 8 8.6 5.9c0 2 1.2 3.2 2.2 3.6C11 6.2 11.1 4.3 12 2.5z" />),
  water: (<path d="M12 3.5c2.9 3.5 5.2 5.8 5.2 9a5.2 5.2 0 0 1-10.4 0C6.8 9.3 9.1 7 12 3.5z" />),
  target: (<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>),
  calendar: (<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17" /><path d="M8 3.5v3" /><path d="M16 3.5v3" /></>),
  dumbbell: (<><path d="M7 12h10" /><path d="M7.5 6v12" /><path d="M16.5 6v12" /><path d="M5 8.5v7" /><path d="M19 8.5v7" /></>),
  scale: (<><rect x="3.75" y="4" width="16.5" height="16" rx="4.5" /><circle cx="12" cy="12.5" r="3.6" /><path d="M12 12.5 13.9 10.8" /><path d="M12 8.9v.8" /></>),
  mail: (<><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m4 7.5 8 5.5 8-5.5" /></>),
  sparkle: (<path d="M12 4.5l1.7 5.8L19.5 12l-5.8 1.7L12 19.5l-1.7-5.8L4.5 12l5.8-1.7z" />),
  chart: (<><path d="M4 4v16h16" /><path d="m7 14 3.5-4 3 2.5L20 7" /></>),
  alert: (<><path d="M12 4 2.5 20.5h19z" /><path d="M12 10.5v4" /><path d="M12 17.4v.01" /></>),
  inbox: (<><path d="M3.5 13.5 6 6h12l2.5 7.5" /><path d="M3.5 13.5V18a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-4.5" /><path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4" /></>),
  folder: (<path d="M4 6h4l1.6 2H19a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />),
  meal: (<><path d="M5 2.5V7.5" /><path d="M7.5 2.5V8" /><path d="M10 2.5V7.5" /><path d="M5 7.5h5" /><path d="M7.5 8V21" /><path d="M16.5 2.5V21" /><path d="M16.5 2.5c-2.6 1-2.6 8 0 9.6" /></>),
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  link: (<><path d="M9.5 14.5 14.5 9.5" /><path d="M8.5 11 6.5 13a3.4 3.4 0 0 0 4.8 4.8l2-2" /><path d="M15.5 13l2-2a3.4 3.4 0 0 0-4.8-4.8l-2 2" /></>),
  clipboard: (<><rect x="5" y="5" width="14" height="16" rx="2" /><path d="M9 5V4.2A1.2 1.2 0 0 1 10.2 3h3.6A1.2 1.2 0 0 1 15 4.2V5z" /><path d="M8.5 11h7" /><path d="M8.5 15h5" /></>),
  person: (<><circle cx="12" cy="7.5" r="3.6" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>),
  leaf: (<><path d="M4.5 19.5c-1-9 5.5-15 15-15 1 9.5-5.5 15-15 15z" /><path d="M4.5 19.5 13 11" /></>),
  muscle: (<><path d="M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 6 2c0 0 3 2 5 7 .73 1.823 1.36 3.094 1.409 4.017Z" /><path d="M15 14a5 5 0 0 0-7.584 2" /><path d="M9.964 6.825C8.019 7.831 9.139 10.972 11 12" /></>),
  bolt: (<path d="M13 2 4 14h6l-1 8 9-12h-6z" />),
  check: (<path d="M5 12.5 10 17.5 19.5 7" />),
  ruler: (<><rect x="2.5" y="8.5" width="19" height="7" rx="1.5" /><path d="M6.5 8.5v2.6" /><path d="M10 8.5v3.6" /><path d="M13.5 8.5v2.6" /><path d="M17 8.5v3.6" /></>),
  moon: (<path d="M21 13A9 9 0 1 1 10.3 2.8 7.6 7.6 0 0 0 21 13z" />),
  run: (<><circle cx="14" cy="4.7" r="1.8" /><path d="M5 17.5l4.5 1 1-2" /><path d="M15.5 21v-4.5l-4-3 1.3-6.3" /><path d="M7.5 12.5V9l5.2-1 3 3 3 1" /></>),
  bike: (<><circle cx="5.5" cy="17.3" r="3" /><circle cx="18.5" cy="17.3" r="3" /><path d="M5.5 17.3 9.8 10.3H15" /><path d="M9.8 10.3 12.3 17.3H18.5" /><path d="M13.8 8h3.2l1.5 4.3" /></>),
  swim: (<><path d="M2.5 8q2-1.6 4 0t4 0 4 0 4 0" /><path d="M2.5 12.5q2-1.6 4 0t4 0 4 0 4 0" /><path d="M2.5 17q2-1.6 4 0t4 0 4 0 4 0" /></>),
  yoga: (<><circle cx="12" cy="3.8" r="2" /><path d="M12 5.8V11.5" /><path d="M6 8.5H18" /><path d="M12 11.5 8 15 8 20" /><path d="M12 11.5 17.5 20" /></>),
  bulb: (<><path d="M9.5 18h5" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-3.8 10.6c.7.6 1.1 1.3 1.2 2.4h5.2c.1-1.1.5-1.8 1.2-2.4A6 6 0 0 0 12 3z" /></>),
  flask: (<><path d="M9 3h6" /><path d="M10 3v5.5L5.4 17.4A1.6 1.6 0 0 0 6.8 20h10.4a1.6 1.6 0 0 0 1.4-2.6L14 8.5V3" /><path d="M7.7 14h8.6" /></>),
  file: (<><path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M13 3v5h5" /></>),
  // — Security / sync (S88) —
  fingerprint: (<><path d="M7.5 20.2C6 18.4 5.2 16.2 5.2 13.4a6.8 6.8 0 0 1 13.6 0c0 1.4-.1 2.7-.4 3.9" /><path d="M12 9.4a4 4 0 0 1 4 4c0 2.6-.4 4.9-1.3 7" /><path d="M12 13.4c0 3-.7 5.5-2.1 7.6" /><path d="M8.6 4.6A9.4 9.4 0 0 1 21 11" /><path d="M3.3 9.7A9.4 9.4 0 0 1 5.7 6" /></>),
  sync: (<><path d="M20 5v5h-5" /><path d="M4 19v-5h5" /><path d="M19.5 10a8 8 0 0 0-14-3.5" /><path d="M4.5 14a8 8 0 0 0 14 3.5" /></>),
  pause: (<><path d="M9 5.5v13" /><path d="M15 5.5v13" /></>),
  watch: (<><circle cx="12" cy="12" r="5.6" /><path d="M12 9.5V12l1.8 1.2" /><path d="M9 6.6 9.6 2.5h4.8L15 6.6" /><path d="M9 17.4 9.6 21.5h4.8L15 17.4" /></>),
  card: (<><rect x="2.5" y="5.5" width="19" height="13" rx="2.2" /><path d="M2.5 10h19" /><path d="M6 14.5h4" /></>),
  // — S94: move a logged item between meals (up/down swap arrows) & copy —
  move: (<><path d="M8 4.5 5 7.5 8 10.5" /><path d="M5 7.5h9" /><path d="M16 13.5l3 3-3 3" /><path d="M19 16.5h-9" /></>),
  copy: (<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></>),
  // — S95: the food library (page icon, save-for-good star, delete) —
  book: (<><path d="M4 4.6A1.6 1.6 0 0 1 5.6 3H18a1 1 0 0 1 1 1v13H5.6A1.6 1.6 0 0 0 4 18.6z" /><path d="M4 18.6A1.6 1.6 0 0 1 5.6 17H19v4H5.6A1.6 1.6 0 0 1 4 19.4z" /><path d="M8 7.5h7" /><path d="M8 11h5" /></>),
  star: (<path d="m12 3.6 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.8l5.9-.9z" />),
  trash: (<><path d="M4.5 6.5h15" /><path d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" /><path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" /><path d="M10.5 10v6.5" /><path d="M13.5 10v6.5" /></>),
};

export function Icon({ name, size = 20, variant = "outline", color = "currentColor",
  strokeWidth = 1.8, title, className, style }) {
  const g = GLYPHS[name];
  if (!g) return null;
  const solid = variant === "solid";
  const fill = solid ? color : (variant === "duotone" ? "rgba(8,220,224,.18)" : "none");
  const stroke = solid ? "none" : color;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={{ flexShrink: 0, display: "block", ...style }}
      role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {title ? <title>{title}</title> : null}
      {g}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(GLYPHS);
