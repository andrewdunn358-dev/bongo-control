import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BatteryCharging, Camera, Flame, MapPin, Sun, Thermometer, ToggleRight, Zap } from 'lucide-react';
import { VanOSBattery, VanOSSolar, VanOSWeather } from '@/components/VanOSGraphics';
import { useAutoFit } from '@/lib/useAutoFit'
import { api } from '@/lib/api';
import { useBattery, useSolar, useEnergy, useEnvironment, useWeather, useConnected, useSparkBuffer } from '@/lib/telemetry';
import { fmtVolt, fmtWatt, fmtTemp, fmtPct, DASH } from '@/lib/format';
import type { BatteryPayload, SolarPayload } from '@/lib/types';
import './adventure.css';

function useHeroCamera() {
 const [url, setUrl] = useState<string | null>(null);
 useEffect(() => {
  let cancelled = false;
  let objectUrl: string | null = null;
  const load = async () => {
   try {
    const res = await fetch(api.cameraSnapshotUrl(Date.now()));
    if (!res.ok) throw new Error(`Camera snapshot ${res.status}`);
    const blob = await res.blob();
    if (cancelled) return;
    const nextUrl = URL.createObjectURL(blob);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = nextUrl;
    setUrl(nextUrl);
   } catch {
    if (!cancelled) setUrl(null);
   }
   if (!cancelled) window.setTimeout(load, 5000);
  };
  void load();
  return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
 }, []);
 return url;
}
function Spark({data,kind}:{data:number[];kind:'battery'|'solar'}) { if(data.length<2)return null; const lo=Math.min(...data),hi=Math.max(...data),span=Math.max(kind==='battery'?0.4:25,hi-lo); const points=data.map((v,i)=>`${(i/(data.length-1))*300},${34-Math.max(2,((v-lo)/span)*30)}`).join(' '); return <svg className="vm-spark" viewBox="0 0 300 38" preserveAspectRatio="none" aria-hidden="true"><polyline points={points}/></svg>; }
function DataRow({label,value}:{label:string;value:string}) { return <div className="vm-data-row"><span>{label}</span><strong>{value}</strong></div>; }
function ActionTile({to,title,subtitle,image,children}:{to:string;title:string;subtitle:string;image:string;children:React.ReactNode}) { return <Link to={to} className="vm-action"><div className="vm-action-image" style={{backgroundImage:`url(${image})`}}/><div className="vm-action-shade"/><div className="vm-action-copy"><div className="vm-action-icon">{children}</div><div><strong>{title}</strong><span>{subtitle}</span></div><ArrowRight className="vm-action-arrow" size={22}/></div></Link>; }

export function AdventureCockpit() {
 const heroCameraUrl = useHeroCamera();
 const battery=useBattery(),solar=useSolar(),energy=useEnergy(),env=useEnvironment(),weather=useWeather(),connected=useConnected();
 const { data: brief } = useQuery({ queryKey: ['mission-brief'], queryFn: api.missionBrief, refetchInterval: 30_000 });
 const loc=useQuery({queryKey:['location'],queryFn:api.location,retry:false}); const heater=useQuery({queryKey:['heater'],queryFn:api.heater,refetchInterval:5000,retry:false});
 const solarSeries=useSparkBuffer<SolarPayload>('solar',p=>p.watts),voltSeries=useSparkBuffer<BatteryPayload>('battery',p=>p.voltage);
 const bp=battery.payload,sp=solar.payload,ep=energy.payload,wp=weather.payload,hs=heater.data?.state??{};
 const heaterOn=hs.state===0x8||Boolean(hs.igniting); const heaterLabel=!heater.data?.available?'No signal':hs.error_code?`Fault ${hs.error_code}`:hs.igniting?'Igniting':hs.cooling_down?'Cooling down':heaterOn?'Heating':'Off';
 const ratio=wp?.tomorrow_vs_today_radiation_ratio; const weatherDescription=wp?.current_weather_description; const satCount=loc.data?.satellites;
 const batteryState=bp==null?DASH:bp.charging?'CHARGING':bp.current_a!=null&&Math.abs(bp.current_a)<0.2?'RESTING':'DISCHARGING';
 const topPred = brief?.predictions?.[0];
 const predictedUsage = topPred?.value == null ? DASH : `${topPred.value}${topPred.unit ? ` ${topPred.unit}` : ''}`;
 const fitRef = useAutoFit<HTMLDivElement>();
 return <div className="vm-page" ref={fitRef}>
  <section className="vm-hero"><div className="vm-hero-photo"><div className="vm-hero-image" style={heroCameraUrl ? {backgroundImage:`url(${heroCameraUrl})`} : undefined}/><div className="vm-hero-fallback"/><div className="vm-hero-overlay"/>
   <div className="vm-hero-top"><span><Camera size={15}/> VAN CAMERA</span><span className={`vm-live ${connected?'live':'offline'}`}><i/> {connected?'LIVE SNAPSHOT':'OFFLINE'}</span></div>
   <div className="vm-hero-copy"><span className="vm-eyebrow">MAZDA BONGO · VANOS</span><h2>Adventure<br/>looks good<br/>on you.</h2><div className="vm-hero-rule"/><p>Explore · Relax · Disconnect · Repeat</p></div>
   <div className="vm-quote">“Not all those who wander<br/>are lost.”<small>J.R.R. Tolkien</small></div>
  </div></section>
  <section className="vm-core-grid">
   <Link to="/power" className="vm-card vm-battery-card"><div className="vm-card-head"><div><span className="vm-eyebrow">POWER CORE</span><h3>Battery <em>{bp?.charging?'Charging':''}</em></h3></div><BatteryCharging size={25} className={bp?.charging?'vm-green':''}/></div>
    <div className="vm-battery-main"><VanOSBattery soc={bp?.soc_pct} charging={bp?.charging} size={118}/><div className="vm-battery-value"><strong>{fmtPct(bp?.soc_pct)}</strong><span>{fmtVolt(bp?.voltage)}</span></div></div>{bp?.soc_pct!=null&&<div className="vm-progress"><i style={{width:`${Math.max(0,Math.min(100,bp.soc_pct))}%`}}/></div>}
    <div className="vm-data-box"><DataRow label="Current" value={bp?.current_a==null?DASH:`${bp.current_a>=0?'+':''}${bp.current_a.toFixed(1)} A`}/><DataRow label="State" value={batteryState}/><DataRow label="Temperature" value={fmtTemp(env.payload?.internal_temp_c)}/>{topPred&&<DataRow label={topPred.label} value={predictedUsage}/>}</div><Spark data={voltSeries} kind="battery"/>
   </Link>
   <Link to="/power" className="vm-card vm-solar-card"><div className="vm-card-head"><div><span className="vm-eyebrow">SOLAR · VICTRON</span><h3>Solar</h3></div><Sun size={27} className="vm-sun"/></div>
    <div className="vm-solar-visual"><VanOSSolar size={74} active={Boolean(sp?.watts)}/><div><strong>{fmtWatt(sp?.watts)}</strong><span>{sp?.watts?'GENERATING':(sp?.charge_state||'OFF').toUpperCase()}</span></div></div>
    <div className="vm-data-box"><DataRow label="Today" value={sp?.yield_today_wh==null?DASH:`${(sp.yield_today_wh/1000).toFixed(2)} kWh`}/><DataRow label="Peak" value={fmtWatt(sp?.peak_today_watts)}/><DataRow label="Charge state" value={(sp?.charge_state||'off').toUpperCase()}/></div><Spark data={solarSeries} kind="solar"/>
   </Link>
   <Link to="/power" className="vm-card vm-flow-card"><div className="vm-card-head"><div><span className="vm-eyebrow">ENERGY</span><h3>Power Flow</h3></div><Zap size={25} className="vm-cyan"/></div>
    <div className="vm-flow-visual"><div><VanOSSolar size={43} active={Boolean(sp?.watts)}/><strong>{fmtWatt(sp?.watts)}</strong><span>Solar</span></div><div className="vm-flow-line"><i/><i/><i/><i/></div><div><BatteryCharging size={43}/><strong>{fmtPct(bp?.soc_pct)}</strong><span>Battery</span></div><div className="vm-flow-line"><i/><i/><i/><i/></div><div><Zap size={43}/><strong>{fmtWatt(ep?.load_watts)}</strong><span>Systems</span></div></div><div className="vm-flow-total"><span>NET BALANCE</span><strong>{fmtWatt(ep?.net_watts)}</strong></div>
   </Link>
   <Link to="/weather" className="vm-card vm-weather-card"><div className="vm-card-head"><div><span className="vm-eyebrow">OUTSIDE</span><h3>Weather</h3></div><VanOSWeather condition={weatherDescription} size={42}/></div>
    <div className="vm-weather-main"><div><strong>{fmtTemp(env.payload?.external_temp_c)}</strong><span>{weatherDescription??'Environment telemetry'}</span></div><Thermometer size={25}/></div><div className="vm-weather-data"><DataRow label="Tomorrow radiation" value={ratio==null?DASH:`${Math.round(ratio*100)}% of today`}/><DataRow label="GPS" value={satCount==null?DASH:`${satCount} satellites`}/></div>
   </Link>
  </section>
  <section className="vm-actions"><ActionTile to="/heater" title="Heater" subtitle={heaterLabel} image="/hero/desert_dusk.jpg"><Flame size={29}/></ActionTile><ActionTile to="/roof" title="Roof" subtitle="Open · hold · release" image="/hero/coast_sunset.jpg"><span className="vm-roof-icon">△</span></ActionTile><ActionTile to="/switches" title="Switches" subtitle="Manage van systems" image="/hero/forest_dawn.jpg"><ToggleRight size={31}/></ActionTile><ActionTile to="/camera" title="Camera" subtitle="Live view" image="/hero/lake_night.jpg"><Camera size={30}/></ActionTile></section>
  <section className="vm-footer-bar"><Link to="/nearby" className="vm-location"><MapPin size={16}/><span>{loc.data?.latitude!=null&&loc.data?.longitude!=null?`${loc.data.latitude.toFixed(4)}°, ${loc.data.longitude.toFixed(4)}°`:'Location unavailable'}</span><small>{satCount==null?'GPS waiting':`${satCount} satellites locked`}</small></Link><div className="vm-footer-meta"><span>VanOS</span><b>v2</b><span>Open Source</span><span>Built for Adventure</span></div><div className="vm-footer-slogan">SIMPLE TRAVELS · BIGGER STORIES</div></section>
 </div>;
}