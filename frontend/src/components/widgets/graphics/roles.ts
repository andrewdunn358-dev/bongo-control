/**
 * ACCENT ROLES.
 *
 * A graphic draws against a ROLE - "this is energy moving", "this is
 * stored charge" - not against a colour. The role resolves to a theme
 * token, so the same graphic reads correctly in a dark forest theme and
 * in a pale one, and a theme changes what a role looks like by changing
 * the token it already owns.
 *
 * WHY THIS EXISTS: the current graphics carry literal hexes (#f5c451,
 * #3b9cff, #32d583 and so on). Those survive a theme change untouched,
 * which is a large part of why a green theme still looks like the blue
 * one. A variant built against roles does not have that problem.
 *
 * STATUS COLOURS ARE NOT ROLES. Charging, fault and attention keep
 * their own tokens, which are deliberately not themeable, because a
 * fault must look like a fault in every theme.
 */
export const ROLE_VARS = {
  /** Energy in motion - flow paths, beams, moving dots. */
  energyPath: 'var(--vw-role-energy-path)',
  /** Stored charge - the filled part of a battery, a reservoir. */
  chargeFill: 'var(--vw-role-charge-fill)',
  /** Generation - sun, panels, harvest. */
  generation: 'var(--vw-role-generation)',
  /** The body of an illustration: casing, outlines, inert structure. */
  illustration: 'var(--vw-role-illustration)',
  /** A quieter line on an illustration. */
  illustrationSoft: 'var(--vw-role-illustration-soft)',
} as const;

export type AccentRole = keyof typeof ROLE_VARS;

/** Resolve a role to the CSS value a graphic should paint with. */
export function role(name: AccentRole): string {
  return ROLE_VARS[name];
}
