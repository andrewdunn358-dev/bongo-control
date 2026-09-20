import { useMemo, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Monitor, Plus, Smartphone, Tablet, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { FONT_CHOICES, THEMEABLE_TOKENS } from '@/lib/customThemes';
import { refreshServerThemes } from '@/lib/serverThemes';
import { useCockpitTheme } from '@/lib/useCockpitTheme';
import { ThemePreviewProvider } from '@/lib/themePreview';
import { ThemedHome } from '@/layout/ThemedHome';
import { builtinComposition } from '@/layout/builtins';
import { LAYOUT_COLUMNS } from '@/layout/schema';
import { WIDGET_IDS, getWidget } from '@/components/widgets/registry';
import { WIDGET_VARIANTS } from '@/components/widgets/graphics/registry';
import {
  ASSET_ROLES, ASSET_TYPES, COCKPITS, DENSITIES, MAX_ASSET_BYTES, MAX_ASSETS,
  emptyDraft, hexToTriplet, objectUrl, packageFile, slugFor, themeDefinition, tripletToHex,
  validateDraft, draftFromPackage, type ThemeDraft,
} from '@/lib/themeStudio';
import './studio.css';

/**
 * THE THEME STUDIO.
 *
 * Design a .vanos-theme against the van's OWN widgets. The preview is
 * not a drawing of VanOS - it is <ThemedHome>, the same component Home
 * renders, with the same widgets, the same graphics registry and the
 * same renderer. Only the theme's inputs are swapped for the draft (see
 * lib/themePreview.tsx). A studio that draws its own battery card shows
 * you something the van will never produce, which is exactly how a
 * theme ends up looking nothing like its design.
 *
 * WHAT IT DELIBERATELY DOES NOT OFFER: anything the format cannot
 * express. There is no state-driven artwork here (an image per battery
 * level, per heater state), because a package cannot carry it yet. The
 * day the format gains it, it belongs here; until then, offering it
 * would be designing something the van cannot show.
 *
 * Everything below is data. The Studio cannot write code into a theme,
 * and the Pi re-validates every package on install regardless.
 */

const DEVICES = [
  { id: 'desktop', label: 'Desktop', width: 1280, Icon: Monitor },
  { id: 'tablet', label: 'Tablet', width: 1024, Icon: Tablet },
  { id: 'phone', label: 'Phone', width: 390, Icon: Smartphone },
] as const;

export function Studio() {
  const [draft, setDraft] = useState<ThemeDraft>(() => emptyDraft());
  const [device, setDevice] = useState<(typeof DEVICES)[number]['id']>('tablet');
  const [selected, setSelected] = useState<string>('hero');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const importRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const { setTheme } = useCockpitTheme();

  const edit = (patch: Partial<ThemeDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const problems = useMemo(() => validateDraft(draft, WIDGET_IDS, WIDGET_VARIANTS), [draft]);
  const errors = problems.filter((p) => p.level === 'error');

  // The composition the preview draws: the draft's own, or the built-in
  // its chosen cockpit brings - the same rule the van applies.
  const composition = draft.layout.items.length ? draft.layout : builtinComposition(draft.cockpit);

  // Colours, fonts, radii and density are CSS variables, set on the
  // preview container so they never escape into the Studio's own UI.
  const previewVars = useMemo(() => {
    const vars: Record<string, string> = {};
    for (const [token, value] of Object.entries(draft.tokens)) {
      if (value.trim() && THEMEABLE_TOKENS.includes(token as (typeof THEMEABLE_TOKENS)[number])) vars[`--${token}`] = value.trim();
    }
    for (const [slot, choice] of Object.entries(draft.typography)) {
      const stack = choice ? FONT_CHOICES[choice] : undefined;
      if (stack) vars[`--font-${slot}`] = stack;
    }
    for (const [size, value] of Object.entries(draft.shape)) if (value) vars[`--radius-${size}`] = value;
    vars['--density'] = draft.density === 'compact' ? '0.8' : draft.density === 'spacious' ? '1.25' : '1';
    return vars as React.CSSProperties;
  }, [draft.tokens, draft.typography, draft.shape, draft.density]);

  const assetUrls = useMemo(() => {
    const urls: Record<string, string> = {};
    for (const image of draft.images) if (image.url) urls[image.role] = image.url;
    return urls;
  }, [draft.images]);

  const heroContent = useMemo(() => {
    const hero = draft.hero;
    return Object.values(hero).some((v) => v.trim()) ? hero : undefined;
  }, [draft.hero]);

  async function onImport(file: File) {
    setNote(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setDraft(await draftFromPackage(bytes));
      setNote(`Opened ${file.name}.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That package could not be read.');
    }
  }

  async function onAddImage(role: string, file: File) {
    const ext = ASSET_TYPES[file.type];
    if (!ext) { setNote('Images must be PNG, JPEG, WEBP or SVG.'); return; }
    if (file.size > MAX_ASSET_BYTES) { setNote(`${file.name} is over the 2MB limit for one image.`); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    setDraft((d) => ({
      ...d,
      images: [
        ...d.images.filter((i) => i.role !== role),
        { role, path: `assets/${role}${ext}`, bytes, contentType: file.type, url: objectUrl(bytes, file.type) },
      ],
    }));
  }

  function onExport() {
    const file = packageFile(draft);
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onInstall() {
    setBusy('install');
    setNote(null);
    try {
      const installed = await api.installTheme(packageFile(draft));
      await refreshServerThemes();
      setTheme(`custom:${installed.theme?.id ?? slugFor(draft.name)}`);
      setNote('Installed on the van and selected. Open Home to see it.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'The van refused that package.');
    } finally {
      setBusy(null);
    }
  }

  const width = DEVICES.find((d) => d.id === device)!.width;

  return (
    <div className="studio">
      <header className="studio-top">
        <div>
          <span className="cs-kicker">VANOS · THEME STUDIO</span>
          <h1>{draft.name || 'Untitled theme'}</h1>
          <p>Designed against the van's own widgets. What you see here is what the van draws.</p>
        </div>
        <div className="studio-actions">
          <button type="button" onClick={() => importRef.current?.click()}><Upload size={16} /> Open</button>
          <button type="button" onClick={onExport}><Download size={16} /> Export package</button>
          <button type="button" className="primary" disabled={!!errors.length || busy === 'install'} onClick={onInstall}>
            {busy === 'install' ? 'Installing…' : 'Install on the van'}
          </button>
          <input
            ref={importRef} type="file" accept=".vanos-theme,application/zip" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ''; }}
          />
        </div>
      </header>

      {note && <div className="studio-note">{note}<button type="button" onClick={() => setNote(null)} aria-label="Dismiss"><X size={14} /></button></div>}

      <div className="studio-work">
        <aside className="studio-panel">
          <Section title="Theme">
            <Field label="Name"><input value={draft.name} maxLength={40} onChange={(e) => edit({ name: e.target.value })} /></Field>
            <Field label="Author"><input value={draft.author} onChange={(e) => edit({ author: e.target.value })} /></Field>
            <Field label="Description"><input value={draft.description} onChange={(e) => edit({ description: e.target.value })} /></Field>
            <Field label="Starts from">
              <select value={draft.cockpit} onChange={(e) => edit({ cockpit: e.target.value as ThemeDraft['cockpit'] })}>
                {COCKPITS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </Section>

          <Section title="Colours">
            {THEMEABLE_TOKENS.map((token) => (
              <Field key={token} label={token}>
                {token === 'aurora-base' ? (
                  <input
                    value={draft.tokens[token] ?? ''} placeholder="linear-gradient(…) or #0b1a2b"
                    onChange={(e) => edit({ tokens: { ...draft.tokens, [token]: e.target.value } })}
                  />
                ) : (
                  <span className="studio-colour">
                    <input
                      type="color" value={tripletToHex(draft.tokens[token])}
                      onChange={(e) => edit({ tokens: { ...draft.tokens, [token]: hexToTriplet(e.target.value) } })}
                    />
                    <input
                      value={draft.tokens[token] ?? ''} placeholder="unset · R G B"
                      onChange={(e) => edit({ tokens: { ...draft.tokens, [token]: e.target.value } })}
                    />
                  </span>
                )}
              </Field>
            ))}
          </Section>

          <Section title="Type and shape">
            {(['display', 'sans', 'mono'] as const).map((slot) => (
              <Field key={slot} label={slot}>
                <select
                  value={draft.typography[slot] ?? ''}
                  onChange={(e) => edit({ typography: { ...draft.typography, [slot]: e.target.value || undefined } })}
                >
                  <option value="">VanOS default</option>
                  {Object.keys(FONT_CHOICES).map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                </select>
              </Field>
            ))}
            {(['md', 'lg', 'xl'] as const).map((size) => (
              <Field key={size} label={`radius ${size}`}>
                <input
                  value={draft.shape[size] ?? ''} placeholder="e.g. 14px"
                  onChange={(e) => edit({ shape: { ...draft.shape, [size]: e.target.value || undefined } })}
                />
              </Field>
            ))}
            <Field label="Density">
              <select value={draft.density} onChange={(e) => edit({ density: e.target.value as ThemeDraft['density'] })}>
                {DENSITIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </Section>

          <Section title="Hero">
            <Field label="Eyebrow"><input value={draft.hero.eyebrow} onChange={(e) => edit({ hero: { ...draft.hero, eyebrow: e.target.value } })} /></Field>
            <Field label="Title"><textarea rows={3} value={draft.hero.title} onChange={(e) => edit({ hero: { ...draft.hero, title: e.target.value } })} /></Field>
            <Field label="Subtitle"><input value={draft.hero.subtitle} onChange={(e) => edit({ hero: { ...draft.hero, subtitle: e.target.value } })} /></Field>
            <Field label="Quote"><textarea rows={2} value={draft.hero.quote} onChange={(e) => edit({ hero: { ...draft.hero, quote: e.target.value } })} /></Field>
            <Field label="Quote author"><input value={draft.hero.quoteAuthor} onChange={(e) => edit({ hero: { ...draft.hero, quoteAuthor: e.target.value } })} /></Field>
            <Field label="Live camera in hero">
              <input type="checkbox" checked={draft.heroCamera} onChange={(e) => edit({ heroCamera: e.target.checked })} />
            </Field>
            <p className="studio-hint">A line break in the title or quote becomes a new line on screen. Leave a field empty to show nothing there.</p>
          </Section>

          <Section title={`Images (${draft.images.length}/${MAX_ASSETS})`}>
            {draft.images.map((image) => (
              <div key={image.role} className="studio-image">
                {image.url ? <img src={image.url} alt="" /> : <ImageIcon size={16} />}
                <span>{image.role}<small>{Math.round(image.bytes.length / 1024)} KB</small></span>
                <button type="button" onClick={() => edit({ images: draft.images.filter((i) => i.role !== image.role) })} aria-label={`Remove ${image.role}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <Field label="Add for">
              <select
                defaultValue=""
                onChange={(e) => { const role = e.target.value; e.target.value = ''; if (role) { imageRef.current!.dataset.role = role; imageRef.current!.click(); } }}
              >
                <option value="">choose a role…</option>
                {ASSET_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </Field>
            <input
              ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                const role = e.target.dataset.role;
                if (f && role) void onAddImage(role, f);
                e.target.value = '';
              }}
            />
          </Section>

          <Section title="Layout">
            {draft.layout.items.map((item, i) => (
              <div key={`${item.widget}-${i}`} className={`studio-row${selected === item.widget ? ' selected' : ''}`} onClick={() => setSelected(item.widget)}>
                <select
                  value={item.widget}
                  onChange={(e) => {
                    const items = [...draft.layout.items];
                    items[i] = { ...items[i], widget: e.target.value };
                    edit({ layout: { ...draft.layout, items } });
                  }}
                >
                  {WIDGET_IDS.map((id) => <option key={id} value={id}>{getWidget(id)?.name ?? id}</option>)}
                </select>
                <input
                  type="number" min={1} max={LAYOUT_COLUMNS} value={item.span ?? LAYOUT_COLUMNS}
                  onChange={(e) => {
                    const items = [...draft.layout.items];
                    items[i] = { ...items[i], span: Math.max(1, Math.min(LAYOUT_COLUMNS, Number(e.target.value) || 1)) };
                    edit({ layout: { ...draft.layout, items } });
                  }}
                />
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => {
                  const items = [...draft.layout.items];
                  [items[i - 1], items[i]] = [items[i], items[i - 1]];
                  edit({ layout: { ...draft.layout, items } });
                }}>↑</button>
                <button type="button" aria-label="Remove" onClick={() => edit({ layout: { ...draft.layout, items: draft.layout.items.filter((_, j) => j !== i) } })}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button
              type="button" className="studio-wide"
              onClick={() => edit({ layout: { ...draft.layout, items: [...draft.layout.items, { widget: WIDGET_IDS[0], span: 3 }] } })}
            >
              <Plus size={14} /> Add widget
            </button>
            {!draft.layout.items.length && (
              <p className="studio-hint">No layout of its own: the theme uses {draft.cockpit}'s arrangement. Add a widget to start one.</p>
            )}
          </Section>

          <Section title="Drawings">
            {Object.entries(WIDGET_VARIANTS).map(([widget, choices]) => (
              <Field key={widget} label={widget}>
                <select
                  value={draft.widgets[widget]?.variant ?? ''}
                  onChange={(e) => {
                    const widgets = { ...draft.widgets };
                    if (e.target.value) widgets[widget] = { variant: e.target.value };
                    else delete widgets[widget];
                    edit({ widgets });
                  }}
                >
                  <option value="">VanOS default</option>
                  {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                </select>
              </Field>
            ))}
          </Section>
        </aside>

        <main className="studio-stage">
          <div className="studio-stagebar">
            <div className="studio-devices">
              {DEVICES.map(({ id, label, Icon }) => (
                <button key={id} type="button" className={device === id ? 'active' : ''} onClick={() => setDevice(id)}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowJson((v) => !v)}>{showJson ? 'Hide' : 'Show'} theme.json</button>
          </div>

          <div className="studio-canvas">
            {showJson ? (
              <pre className="studio-json">{JSON.stringify(themeDefinition(draft), null, 2)}</pre>
            ) : composition ? (
              <div className="studio-device" style={{ width, ...previewVars }}>
                <ThemePreviewProvider value={{ heroContent, widgetPresentation: draft.widgets, assetUrls, heroCamera: draft.heroCamera }}>
                  <ThemedHome composition={composition} />
                </ThemePreviewProvider>
              </div>
            ) : (
              <p className="studio-hint">The {draft.cockpit} cockpit is still a hand-written screen in this build, so there is nothing to compose. Add a layout to preview one.</p>
            )}
          </div>

          <footer className="studio-checks">
            {problems.length === 0 ? (
              <span className="ok">Nothing wrong with it. The Pi checks it again on install.</span>
            ) : (
              problems.map((p, i) => (
                <span key={i} className={p.level}>
                  <TriangleAlert size={13} /> {p.text}
                </span>
              ))
            )}
          </footer>
        </main>
      </div>

      <p className="studio-foot">
        A theme can change colours, fonts, corner radii, density, the Home arrangement, which drawing each widget uses, the hero words
        and the images. Artwork that follows the van's data - a different battery image per level, say - is not something the format can
        carry yet, so it is not offered here.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="studio-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="studio-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
