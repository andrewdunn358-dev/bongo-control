import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import type { WidgetProps } from './types';

/** FOOTER.
 *
 *  Position and satellite count, plus the app's own marks.
 *
 *  TRUTH: the position is the real GPS fix. With no fix it says
 *  "Location unavailable" and "GPS waiting" rather than showing a stale
 *  or invented coordinate.
 *
 *  STATES: compact drops the version marks and the slogan - branding,
 *  not readings. The position and satellite count always remain. */
export function FooterWidget({ state = 'full' }: WidgetProps) {
  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });
  const satCount = loc.data?.satellites;
  return (
    <section className="vw-footer-bar" data-vw-state={state}>
      <Link to="/nearby" className="vw-location">
        <MapPin size={16} />
        <span>
          {loc.data?.latitude != null && loc.data?.longitude != null
            ? `${loc.data.latitude.toFixed(4)}°, ${loc.data.longitude.toFixed(4)}°`
            : 'Location unavailable'}
        </span>
        <small>{satCount == null ? 'GPS waiting' : `${satCount} satellites locked`}</small>
      </Link>
      <div className="vw-footer-meta">
        <span>VanOS</span><b>v2</b><span>Open Source</span><span>Built for Adventure</span>
      </div>
      <div className="vw-footer-slogan">SIMPLE TRAVELS · BIGGER STORIES</div>
    </section>
  );
}
