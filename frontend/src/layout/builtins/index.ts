import { WIDGET_IDS } from '@/components/widgets/registry';
import { parseLayout, type LayoutDefinition } from '@/layout/schema';
import adventureHome from './adventure.home.json';

/**
 * BUILT-IN COMPOSITIONS.
 *
 * A built-in appearance is a composition supplied by VanOS. It is not a
 * privileged rendering path: the JSON below goes through the SAME
 * parseLayout, against the SAME widget registry, as a composition that
 * arrives inside an installed .vanos-theme.
 *
 * That is the whole point of putting these in JSON rather than leaving
 * them as TypeScript object literals. A literal bypasses the validator,
 * which means a built-in can express something a real package would be
 * rejected for - and then the built-ins stop being proof that the
 * schema works. Adventure's old ADVENTURE_HOME constant was exactly
 * that: never validated, so never held to the rules it was meant to
 * demonstrate.
 *
 * THE RULE THIS ENFORCES MECHANICALLY: if a built-in composition needs a
 * capability, that capability is available to an installable package
 * too, because there is one gate and both go through it.
 *
 * A built-in that fails validation is a BUILD BUG, not a runtime
 * condition. tests/builtin-compositions.test.mjs asserts every one of
 * them parses, so CI catches it. At runtime a failure is swallowed and
 * logged rather than white-screening the van, because a cockpit that
 * will not start is worse than one missing a panel.
 */
const SOURCES: Record<string, unknown> = {
  adventure: adventureHome,
};

function load(): Record<string, LayoutDefinition> {
  const out: Record<string, LayoutDefinition> = {};
  for (const [id, raw] of Object.entries(SOURCES)) {
    try {
      out[id] = parseLayout(raw, WIDGET_IDS).layout;
    } catch (err) {
      // Never fatal - see the note above.
      console.error(`[vanos] built-in composition "${id}" failed validation:`, err);
    }
  }
  return out;
}

export const BUILTIN_COMPOSITIONS: Record<string, LayoutDefinition> = load();

/**
 * The built-in composition a Theme Definition INHERITS when it brings
 * none of its own. Undefined means that appearance is still a
 * hand-written component in this build, and Home falls back to it.
 *
 * `cockpitId` is the name a Theme Definition extends - temporary
 * compatibility and inheritance metadata, nothing more. It is consulted
 * HERE, at the Theme Definition step, and nowhere below Validated
 * Composition. A package carrying its own composition never reaches
 * this function at all, so what it names cannot decide whether its
 * layout is drawn.
 */
export function builtinComposition(cockpitId: string): LayoutDefinition | undefined {
  return BUILTIN_COMPOSITIONS[cockpitId];
}
