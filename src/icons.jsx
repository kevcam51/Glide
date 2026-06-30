// Glide custom icon set — replaces emoji across the app with a cohesive,
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
  invite: (<><path d="M21 3 10.5 14" /><path d="M21 3l-6.6 18-3.9-8.5L2 8.6 21 3z" /></>),
  signout: (<><path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8" /><path d="M10 12h11" /><path d="m18 9 3 3-3 3" /></>),
  edit: (<><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="m14 7 3 3" /></>),
  close: (<><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>),
  plus: (<><path d="M12 5v14" /><path d="M5 12h14" /></>),
  // — Fitness / data —
  flame: (<path d="M12 3c2.8 3.6 4.6 5.7 4.6 9a4.6 4.6 0 0 1-9.2 0C7.4 9.6 9 8 9 6.2c0 1.7 1 2.7 1.9 3C11 6.4 11.2 4.6 12 3z" />),
  water: (<path d="M12 3.5c2.9 3.5 5.2 5.8 5.2 9a5.2 5.2 0 0 1-10.4 0C6.8 9.3 9.1 7 12 3.5z" />),
  target: (<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>),
  calendar: (<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17" /><path d="M8 3.5v3" /><path d="M16 3.5v3" /></>),
  dumbbell: (<><path d="M6.5 12h11" /><path d="M4 9.5v5" /><path d="M7 8v8" /><path d="M17 8v8" /><path d="M20 9.5v5" /></>),
  scale: (<><path d="M5.5 7h13l1.3 11.5a1 1 0 0 1-1 1.1H5.2a1 1 0 0 1-1-1.1z" /><path d="M9 7a3 3 0 0 1 6 0" /></>),
  sparkle: (<path d="M12 3.5l1.7 5.8L19.5 11l-5.8 1.7L12 18.5l-1.7-5.8L4.5 11l5.8-1.7z" />),
  chart: (<><path d="M4 4v16h16" /><path d="m7 14 3.5-4 3 2.5L20 7" /></>),
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
