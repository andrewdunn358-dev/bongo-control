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
  const motionValue = useMotionValue(value);
  const spring = useSpring(motionValue, { stiffness: 120, damping: 20, mass: 0.5 });
  const display = useTransform(spring, (v) => `${prefix}${v.toFixed(decimals)}${suffix}`);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (reduceMotion || isFirstRender.current) {
      motionValue.jump(value);
      isFirstRender.current = false;
    } else {
      motionValue.set(value);
    }
  }, [value, motionValue, reduceMotion]);

  return <motion.span className={className}>{display}</motion.span>;
}
