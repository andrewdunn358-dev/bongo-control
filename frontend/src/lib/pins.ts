/**
 * BCM GPIO number -> physical header pin, for the 40-pin Raspberry Pi
 * header.
 *
 * This exists because the van is wired, labelled, documented and
 * discussed entirely in PHYSICAL PIN NUMBERS. "Pin 16" is a thing you
 * can count to with a finger on the header; "GPIO 23" is a thing you
 * have to look up, and looking it up wrong is how a relay gets wired to
 * the 1-Wire bus. The backend stores BCM numbers only because that is
 * what gpiozero's constructor takes, so the translation belongs here,
 * at the point where a human reads it.
 *
 * Full map rather than only the pins currently in use: the whole point
 * is that reassigning a channel shouldn't need a code change here too.
 */
const BCM_TO_PHYSICAL: Record<number, number> = {
  0: 27, 1: 28, 2: 3, 3: 5, 4: 7, 5: 29, 6: 31, 7: 26,
  8: 24, 9: 21, 10: 19, 11: 23, 12: 32, 13: 33, 14: 8, 15: 10,
  16: 36, 17: 11, 18: 12, 19: 35, 20: 38, 21: 40, 22: 15, 23: 16,
  24: 18, 25: 22, 26: 37, 27: 13,
};

/**
 * "Pin 16" where the mapping is known, falling back to the raw GPIO
 * number where it isn't. The fallback is deliberately labelled as GPIO
 * rather than silently printed as a bare number - an unknown value
 * shown as "Pin 47" would be worse than useless on a 40-pin header.
 */
export function pinLabel(gpio: number): string {
  const pin = BCM_TO_PHYSICAL[gpio];
  return pin === undefined ? `GPIO ${gpio}` : `Pin ${pin}`;
}
