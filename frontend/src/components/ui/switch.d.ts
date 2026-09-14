import type { ComponentPropsWithoutRef, ForwardRefExoticComponent, RefAttributes } from 'react';

/**
 * Minimal ambient declaration for switch.jsx - this project's shadcn/ui
 * primitives are scaffolded as plain .jsx and this is the first one
 * actually imported from a .tsx file (CockpitDashboard.tsx, 14 Sep).
 * Just enough shape for that call site to typecheck; not a full
 * re-declaration of Radix's own (already-typed) props.
 */
type SwitchProps = ComponentPropsWithoutRef<'button'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

export declare const Switch: ForwardRefExoticComponent<SwitchProps & RefAttributes<HTMLButtonElement>>;
