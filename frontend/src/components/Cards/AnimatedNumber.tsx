import { useEffect, useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}

/**
 * Renders a number that smoothly counts/glides toward a new value
 * whenever it changes, instead of jump-cutting — this is what makes a
 * live telemetry readout feel "alive" rather than a static label that
 * occasionally flickers to a new value.
 */
export default function AnimatedNumber({ value, decimals = 0, suffix = "", prefix = "", className }: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion();
  // Belt-and-braces against NaN. Callers are typed to pass a real
  // number and should guard nulls themselves (showing "—" reads far
  // better than a zero, since a missing reading isn't the same as a
  // reading of zero) - but this component is used in a dozen places,
  // and one unguarded caller shouldn't be able to render "NaN°" to
  // someone in a van. Which is exactly what happened when the first
  // real temperature sensor reported a null the simulation never did.
  const safeValue = Number.isFinite(value) ? value : 0;
  const motionValue = useMotionValue(safeValue);
  const spring = useSpring(motionValue, { stiffness: 120, damping: 20, mass: 0.5 });
  const display = useTransform(spring, (v) => `${prefix}${v.toFixed(decimals)}${suffix}`);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (reduceMotion || isFirstRender.current) {
      motionValue.jump(safeValue);
      isFirstRender.current = false;
    } else {
      motionValue.set(safeValue);
    }
  }, [safeValue, motionValue, reduceMotion]);

  return <motion.span className={className}>{display}</motion.span>;
}
