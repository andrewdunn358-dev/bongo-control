import { WIDGET_IDS } from '@/components/widgets/registry';
import { parseLayout, type LayoutDefinition } from '@/layout/schema';
import adventureHome from './adventure.home.json';
import emergencyHome from './emergency.home.json';

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
 */
const SOURCES: Record<string, unknown> = {
  adventure: adventureHome,
};

/**
 * THE EMERGENCY COMPOSITION.
 *
 * What a built-in degrades to when its own JSON fails validation. It is
 * deliberately boring: the battery, which is the one reading that
 * matters when you are off-grid, and the position footer. Two widgets,
 * full width, nothing conditional.
 *
 * It is NOT a second normal built-in. It is not selectable, it is not in
 * SOURCES, and nothing chooses it - it is only ever reached by failure.
 *
 * IT GOES THROUGH parseLayout LIKE EVERYTHING ELSE. A hand-built literal
 * here would be the exact mistake ADVENTURE_HOME was: an unvalidated
 * composition, privileged precisely where the guarantee matters most.
 * tests/builtin-compositions.test.mjs parses every JSON file in this
 * directory, so the fallback is held to the same rules it is rescuing
 * another composition from breaking.
 *
 * WHY A FALLBACK AT ALL, when an invalid built-in is a build bug CI
 * catches. Because measured, the previous behaviour was not the graceful
 * degrade its comment claimed. A failed built-in was logged and omitted,
 * resolution returned undefined, Home took the legacy branch, and
 * Adventure has no component - so the cockpit rendered BLANK. "A cockpit
 * missing a panel is better than one that will not start" was the right
 * principle attached to code that did the opposite.
 */
const EMERGENCY_SOURCE: unknown = emergencyHome;

/**
 * Parses a set of built-in sources, degrading a failed one to the
 * emergency composition rather than dropping it.
 *
 * Exported so the FAILURE path can be tested with a deliberately broken
 * source. Testing only the happy path here would leave the branch that
 * matters - the one that runs when something is already wrong -
 * unexercised, which is how the blank cockpit went unnoticed.
 */
export function loadCompositions(
  sources: Record<string, unknown>,
  emergency: LayoutDefinition | undefined,
): Record<string, LayoutDefinition> {
  const out: Record<string, LayoutDefinition> = {};
  for (const [id, raw] of Object.entries(sources)) {
    try {
      out[id] = parseLayout(raw, WIDGET_IDS).layout;
    } catch (err) {
      console.error(`[vanos] built-in composition "${id}" failed validation:`, err);
      if (emergency) {
        // Every id in `sources` keeps an entry, so resolution can never
        // return undefined for an appearance that HAS a built-in. That
        // is what keeps the failure inside the themed path instead of
        // falling through to a component this cockpit does not have.
        console.error(`[vanos] "${id}" is rendering the emergency composition instead`);
        out[id] = emergency;
      } else {
        // Only reachable if the emergency composition ITSELF fails to
        // validate, which is a build bug CI fails on. There is no
        // second fallback on purpose: inventing one here would mean
        // hand-writing a composition that bypasses the validator, and
        // an unvalidated rescue path is worse than a loud absence.
        console.error('[vanos] the emergency composition is also invalid; no fallback is possible');
      }
    }
  }
  return out;
}

/** Parsed separately and first, by the same validator, so a broken
 *  emergency composition is a visible failure rather than a silent one. */
function loadEmergency(): LayoutDefinition | undefined {
  try {
    return parseLayout(EMERGENCY_SOURCE, WIDGET_IDS).layout;
  } catch (err) {
    console.error('[vanos] the emergency composition failed validation:', err);
    return undefined;
  }
}

export const EMERGENCY_COMPOSITION: LayoutDefinition | undefined = loadEmergency();

export const BUILTIN_COMPOSITIONS: Record<string, LayoutDefinition> =
  loadCompositions(SOURCES, EMERGENCY_COMPOSITION);

/**
 * The built-in composition a Theme Definition INHERITS when it brings
 * none of its own.
 *
 * Undefined means that appearance has NO built-in in this build - it is
 * still a hand-written component, and Home falls back to it. That is
 * different from a built-in that exists and failed to validate, which
 * returns the emergency composition and stays in the themed path. The
 * distinction is deliberate: conflating them would either blank
 * Adventure on a bad JSON or take Instrument's component away from it.
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
