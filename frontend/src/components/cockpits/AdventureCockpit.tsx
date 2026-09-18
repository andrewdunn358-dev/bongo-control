import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Camera, Flame, MapPin, ToggleRight } from 'lucide-react';
import { useAutoFit } from '@/lib/useAutoFit'
import { useThemeAssets } from '@/lib/useThemeAssets'
import { api } from '@/lib/api';
import { BatteryWidget } from '@/components/widgets/BatteryWidget';
import { SolarWidget } from '@/components/widgets/SolarWidget';
import { PowerFlowWidget } from '@/components/widgets/PowerFlowWidget';
import { WeatherWidget } from '@/components/widgets/WeatherWidget';
import './adventure.css';
import { publicUrl } from '@/lib/publicUrl';
import { useLayoutMode } from '@/lib/useLayoutMode';

function ActionTile({to,title,subtitle,image,children}:{to:string;title:string;subtitle:string;image:string;children:React.ReactNode}) { return <Link to={to} className="vm-action"><div className="vm-action-image" style={{backgroundImage:`url(${image})`}}/><div className="vm-action-shade"/><div className="vm-action-copy"><div className="vm-action-icon">{children}</div><div><strong>{title}</strong><span>{subtitle}</span></div><ArrowRight className="vm-action-arrow" size={22}/></div></Link>; }

export function AdventureCockpit() {
 // The four telemetry cards are WIDGETS now and fetch their own data.
 // What is left here is the cockpit's own furniture: the hero, the
 // action tiles and the footer. That split is the point of Phase 2 -
 // the same four cards were written out separately in three cockpits.
 const loc=useQuery({queryKey:['location'],queryFn:api.location,retry:false}); const heater=useQuery({queryKey:['heater'],queryFn:api.heater,refetchInterval:5000,retry:false});
 const hs=heater.data?.state??{};
 const heaterOn=hs.state===0x8||Boolean(hs.igniting); const heaterLabel=!heater.data?.available?'No signal':hs.error_code?`Fault ${hs.error_code}`:hs.igniting?'Igniting':hs.cooling_down?'Cooling down':heaterOn?'Heating':'Off';
 const satCount=loc.data?.satellites;
 const fitRef = useAutoFit<HTMLDivElement>();
 // THE RENDERER decides the presentation state and passes it down. The
 // widgets do not inspect the layout mode - a widget must work in any
 // layout without knowing which one contains it, and this is where that
 // boundary sits until the generic layout engine takes the job over.
 const widgetState = useLayoutMode() === 'landscape' ? 'compact' : 'full';
 // A theme may supply its own imagery; each call falls back to the
 // built-in picture, so a theme with no images looks unchanged.
 const { asset } = useThemeAssets();
 return <div className="vm-page" ref={fitRef}>
  {/* STATIC HERO, 17 Sep 2026. The hero used to render the live camera
      over the top of this image. Removed: on the real tablet it made the
      camera the largest thing on the cockpit while duplicating the
      Camera tile and the Camera page, both of which are untouched. The
      hierarchy is now hero = identity, cards = live readings, tiles =
      actions, Camera page = the live view.
      The camera's status strip went with it. Its "VAN CAMERA" label
      would now be false, and its LIVE/OFFLINE pill was never camera
      state at all - it was the WebSocket's, which NavShell already
      shows in the header, so nothing is lost by dropping the duplicate.
      This is the same end state as a theme setting home.heroCamera:
      false; no new configuration was added for it. Note the consequence:
      a theme package asking for heroCamera:true no longer gets a camera
      hero in this cockpit. Deliberate - this is an experiment, and the
      camera layer is one revert away if the static hero reads worse. */}
  <section className="vm-hero"><div className="vm-hero-photo"><div className="vm-hero-fallback" style={{backgroundImage:`url(${asset('hero', publicUrl('/hero/snow_night.jpg'))})`}}/><div className="vm-hero-overlay"/>
   <div className="vm-hero-copy"><span className="vm-eyebrow">MAZDA BONGO · VANOS</span><h2>Adventure<br/>looks good<br/>on you.</h2><div className="vm-hero-rule"/><p>Explore · Relax · Disconnect · Repeat</p></div>
   <div className="vm-quote">“Not all those who wander<br/>are lost.”<small>J.R.R. Tolkien</small></div>
  </div></section>
  <section className="vm-core-grid">
   <BatteryWidget state={widgetState}/>
   <SolarWidget state={widgetState}/>
   <PowerFlowWidget state={widgetState}/>
   <WeatherWidget state={widgetState}/>
  </section>
  <section className="vm-actions"><ActionTile to="/heater" title="Heater" subtitle={heaterLabel} image={asset('heater', publicUrl('/hero/desert_dusk.jpg'))}><Flame size={29}/></ActionTile><ActionTile to="/roof" title="Roof" subtitle="Open · hold · release" image={asset('roof', publicUrl('/hero/coast_sunset.jpg'))}><span className="vm-roof-icon">△</span></ActionTile><ActionTile to="/switches" title="Switches" subtitle="Manage van systems" image={asset('switches', publicUrl('/hero/forest_dawn.jpg'))}><ToggleRight size={31}/></ActionTile><ActionTile to="/camera" title="Camera" subtitle="Live view" image={asset('camera', publicUrl('/hero/lake_night.jpg'))}><Camera size={30}/></ActionTile></section>
  <section className="vm-footer-bar"><Link to="/nearby" className="vm-location"><MapPin size={16}/><span>{loc.data?.latitude!=null&&loc.data?.longitude!=null?`${loc.data.latitude.toFixed(4)}°, ${loc.data.longitude.toFixed(4)}°`:'Location unavailable'}</span><small>{satCount==null?'GPS waiting':`${satCount} satellites locked`}</small></Link><div className="vm-footer-meta"><span>VanOS</span><b>v2</b><span>Open Source</span><span>Built for Adventure</span></div><div className="vm-footer-slogan">SIMPLE TRAVELS · BIGGER STORIES</div></section>
 </div>;
}