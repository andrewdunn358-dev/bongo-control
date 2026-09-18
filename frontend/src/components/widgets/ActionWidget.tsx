import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Camera, Flame, ToggleRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useThemeAssets } from '@/lib/useThemeAssets';
import { publicUrl } from '@/lib/publicUrl';
import type { WidgetProps } from './types';

/** ACTION TILES.
 *
 *  A tile is a navigation control with a themed image behind it. There
 *  is one REGISTERED WIDGET PER DESTINATION rather than one widget
 *  configured by the layout, because the schema carries allocation
 *  intent only - no props. Four bounded ids beat adding a config
 *  property that would become the crack CSS-in-JSON climbs through.
 *
 *  TRUTH: the heater tile shows the heater's own reported state and
 *  says "No signal" when the heater is unreachable, rather than
 *  implying it is off. No other tile claims any state.
 *
 *  The whole tile is the touch target; its height floor lives in the
 *  stylesheet and does not scale away. */
function makeAction(cfg: {
  to: string;
  title: string;
  subtitle?: string;
  role: string;
  fallback: string;
  icon: React.ReactNode;
  useHeaterLabel?: boolean;
}) {
  return function ActionWidget({ state = 'full' }: WidgetProps) {
    const { asset } = useThemeAssets();
    const heater = useQuery({
      queryKey: ['heater'],
      queryFn: api.heater,
      refetchInterval: 5000,
      retry: false,
      enabled: Boolean(cfg.useHeaterLabel),
    });
    let subtitle = cfg.subtitle ?? '';
    if (cfg.useHeaterLabel) {
      const hs = heater.data?.state ?? {};
      const on = hs.state === 0x8 || Boolean(hs.igniting);
      subtitle = !heater.data?.available
        ? 'No signal'
        : hs.error_code
          ? `Fault ${hs.error_code}`
          : hs.igniting
            ? 'Igniting'
            : hs.cooling_down
              ? 'Cooling down'
              : on
                ? 'Heating'
                : 'Off';
    }
    return (
      <Link to={cfg.to} className="vw-action" data-vw-state={state}>
        <div className="vw-action-image" style={{ backgroundImage: `url(${asset(cfg.role, publicUrl(cfg.fallback))})` }} />
        <div className="vw-action-shade" />
        <div className="vw-action-copy">
          <div className="vw-action-icon">{cfg.icon}</div>
          <div>
            <strong>{cfg.title}</strong>
            <span>{subtitle}</span>
          </div>
          <ArrowRight className="vw-action-arrow" size={22} />
        </div>
      </Link>
    );
  };
}

export const HeaterActionWidget = makeAction({ to: '/heater', title: 'Heater', role: 'heater', fallback: '/hero/desert_dusk.jpg', icon: <Flame size={29} />, useHeaterLabel: true });
export const RoofActionWidget = makeAction({ to: '/roof', title: 'Roof', subtitle: 'Open · hold · release', role: 'roof', fallback: '/hero/coast_sunset.jpg', icon: <span className="vw-roof-icon">△</span> });
export const SwitchesActionWidget = makeAction({ to: '/switches', title: 'Switches', subtitle: 'Manage van systems', role: 'switches', fallback: '/hero/forest_dawn.jpg', icon: <ToggleRight size={31} /> });
export const CameraActionWidget = makeAction({ to: '/camera', title: 'Camera', subtitle: 'Live view', role: 'camera', fallback: '/hero/lake_night.jpg', icon: <Camera size={30} /> });
