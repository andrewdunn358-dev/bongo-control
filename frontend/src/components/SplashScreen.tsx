import { useEffect, useState } from 'react';

/**
 * Desktop-only intro splash. Shows the van hero + brand over the aurora
 * for a couple of seconds on load, then fades to the app; click to skip.
 *
 * Deliberately NOT shown on mobile (phones want to get straight to the
 * dashboard). The hero photo lives at /splash.jpg in public/ - if it
 * isn't present the aurora base + glow layers still make a clean brand
 * screen, so the app never shows a broken image.
 */
export function SplashScreen() {
  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined') return false;
    // Desktop widths only.
    if (!window.matchMedia('(min-width: 768px)').matches) return false;
    // Once per browser session, so a refresh mid-session doesn't repeat it.
    try {
      if (sessionStorage.getItem('bongo.splash.seen')) return false;
      sessionStorage.setItem('bongo.splash.seen', '1');
    } catch {
      /* ignore */
    }
    return true;
  });
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!show) return;
    const t1 = setTimeout(() => setLeaving(true), 2400);
    const t2 = setTimeout(() => setShow(false), 3100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [show]);

  if (!show) return null;

  const dismiss = () => {
    setLeaving(true);
    setTimeout(() => setShow(false), 600);
  };

  return (
    <div
      onClick={dismiss}
      className={`fixed inset-0 z-[60] cursor-pointer transition-opacity duration-700 ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'var(--aurora-base)' }}
    >
      {/* Van hero (public/splash.jpg). Absent -> just the aurora below. */}
      <div className="absolute inset-0 bg-center bg-cover" style={{ backgroundImage: "url('/splash.jpg')" }} />
      {/* Aurora glow — carries the screen when there's no photo, and deepens it when there is. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 25% 0%, rgba(34,211,238,0.20), transparent 55%), radial-gradient(120% 80% at 80% 8%, rgba(168,85,247,0.20), transparent 55%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(10,22,40,0.35) 0%, rgba(10,22,40,0.10) 45%, rgba(10,22,40,0.88) 100%)',
        }}
      />

      <div className="relative h-full flex flex-col items-center justify-center text-center px-6 animate-fade-in">
        <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-aurora-teal to-aurora-purple grid place-items-center shadow-[0_0_44px_rgba(34,211,238,0.45)]">
          <span className="text-navy-900 font-bold text-4xl">B</span>
        </div>
        <h1
          className="mt-6 text-5xl md:text-6xl font-bold tracking-tight text-white"
          style={{ textShadow: '0 2px 30px rgba(0,0,0,0.55)' }}
        >
          BONGO<span className="text-aurora-teal">·</span>CONTROL
        </h1>
        <p className="mt-3 text-lg text-white/75">Open-source campervan dashboard OS</p>
        <div className="mt-10 text-[11px] uppercase tracking-[0.3em] text-white/50">click to enter</div>
      </div>
    </div>
  );
}
