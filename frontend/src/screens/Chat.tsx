import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send, Sparkles, Loader2, RotateCcw } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { api } from '@/lib/api';
import { CHAT } from '@/constants/testIds';
import { cn } from '@/lib/utils';

type Role = 'user' | 'assistant';
interface Message {
  role: Role;
  content: string;
}

// Single source of truth for the client-side fallback name (used
// before the /api/ai/status query resolves, or if it's ever
// unavailable) - PersonaAvatar's alt text and the header/greeting text
// both read this SAME constant now, rather than each hardcoding the
// name separately (which is exactly how "Diane" ended up baked into
// two different places last time, both needing a separate edit on
// this rename).
const PERSONA_FALLBACK_NAME = 'Ron';

const STARTER_PROMPTS = [
  'Will it rain tonight — should the awning stay in?',
  "What's a sensible rule of thumb for running a heater overnight?",
  'Any tips for finding a quiet spot to park up nearby?',
];

/**
 * The persona's avatar. A real photo, not an illustration - still
 * worth keeping the "AI-generated" badge visible everywhere it
 * appears (see the CardHeader below), since a photorealistic face
 * makes it easier to mistake it for an actual person at a glance.
 *
 * Deliberately named/pathed persona-agnostic (was MaggieAvatar loading
 * /avatars/diane.jpg - a leftover from an EARLIER rename, Maggie ->
 * Diane, that never got fully cleaned up either) - renaming the
 * persona a second time (-> Ron) is what surfaced it. Fixed properly
 * this time: function name and image filename both avoid baking in
 * whatever the current name happens to be, so the next rename doesn't
 * leave the same kind of stale reference behind again. The photo
 * itself may not visually suit the new name/character - worth a fresh
 * upload at some point, but that's just replacing this same file, no
 * code change needed either way.
 */
function PersonaAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/avatars/persona.jpg"
      alt={PERSONA_FALLBACK_NAME}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn('object-cover', className)}
    />
  );
}

/**
 * A real back-and-forth, unlike the "AI picks" one-shot card on
 * Nearby — see ai_chat_service.py for why that split is deliberate.
 * Every reply is grounded in the van's actual current location,
 * weather, and battery/solar readings, built fresh into the prompt
 * server-side each turn — not a generic chatbot bolted onto the app.
 *
 * History lives in React state only, not persisted — reloading the
 * page starts fresh. Same "ask only when the person acts" cost
 * discipline as the rest of the AI features: nothing here calls the
 * API on its own, only when a message is actually sent.
 */
export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const autoAskFired = useRef(false);

  const status = useQuery({ queryKey: ['ai-status'], queryFn: api.aiStatus });
  const configured = status.data?.configured ?? false;
  const personaName = status.data?.persona_name || PERSONA_FALLBACK_NAME;

  const send = useMutation({
    mutationFn: (next: Message[]) => api.aiChat(next),
    onSuccess: (data) => setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]),
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Could not get a reply');
      // Drop the user's message that just failed, so retrying doesn't
      // silently duplicate it in the history sent to the API.
      setMessages((prev) => prev.slice(0, -1));
    },
  });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, send.isPending]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || send.isPending) return;
    const next = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(next);
    setInput('');
    send.mutate(next);
  };

  // Arriving here from a page that already has a specific question in
  // mind (currently just Overview's "Ask Ron about this") - the
  // button used to just link here and leave an empty chat box, which
  // implied it would actually ask something, not just open the app.
  // Fires once (autoAskFired guards against re-firing on an unrelated
  // re-render or state update - only a fresh navigation with new state
  // should ever trigger this), and only once the persona's confirmed
  // configured, since there's no chat UI to submit into otherwise.
  useEffect(() => {
    const autoAsk = (location.state as { autoAsk?: string } | null)?.autoAsk;
    if (autoAsk && configured && !autoAskFired.current) {
      autoAskFired.current = true;
      submit(autoAsk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, configured]);

  return (
    <div data-testid={CHAT.root} className="mx-auto max-w-[900px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10 flex flex-col h-[calc(100vh-140px)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <PersonaAvatar size={48} className="rounded-full ring-2 ring-aurora-purple/30 shrink-0" />
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Chat</div>
            <h1 className="text-2xl md:text-4xl font-semibold tracking-tight mt-1">{personaName}</h1>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            data-testid={CHAT.newChat}
            onClick={() => setMessages([])}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08]"
          >
            <RotateCcw size={12} /> New chat
          </button>
        )}
      </div>

      <GlassCard glow="purple" className="flex-1 flex flex-col overflow-hidden p-0">
        <div className="px-5 pt-5">
          <CardHeader
            label={personaName}
            hint={configured ? undefined : 'AI provider not configured'}
            right={<div className="flex items-center gap-1 text-aurora-purple"><Sparkles size={14} /><span className="text-xs">AI-generated</span></div>}
          />
        </div>

        {!configured ? (
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="text-sm text-ink-soft text-center max-w-sm">
              Add an Anthropic API key in <a href="/settings" className="text-aurora-teal underline">Settings → Integrations</a> to turn this on.
            </div>
          </div>
        ) : (
          <>
            <div ref={listRef} className="flex-1 overflow-auto px-5 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
                  <PersonaAvatar size={72} className="rounded-full ring-2 ring-aurora-purple/30" />
                  <div className="text-sm text-ink-muted max-w-sm">
                    Hey — I'm {personaName}. Ask me about the weather, what you can run tonight, nearby spots, or
                    anything vanlife and camping — I'll answer from what the van actually knows right now, not
                    guesswork.
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 max-w-md">
                    {STARTER_PROMPTS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => submit(p)}
                        className="rounded-full px-3 py-1.5 text-xs bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08] text-left"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} data-testid={CHAT.message(i)} className={cn('flex gap-2.5', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {m.role === 'assistant' && <PersonaAvatar size={28} className="rounded-full shrink-0 mt-0.5" />}
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                      m.role === 'user' ? 'bg-aurora-teal text-navy-900 font-medium' : 'bg-ink/[0.05] text-ink-soft ring-1 ring-ink/10',
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {send.isPending && (
                <div className="flex gap-2.5 justify-start">
                  <PersonaAvatar size={28} className="rounded-full shrink-0 mt-0.5" />
                  <div className="rounded-2xl px-4 py-2.5 bg-ink/[0.05] ring-1 ring-ink/10 flex items-center">
                    <Loader2 size={14} className="animate-spin text-ink-faint" />
                  </div>
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); submit(input); }}
              className="flex gap-2 px-5 py-4 border-t border-ink/10"
            >
              <input
                data-testid={CHAT.input}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Ask ${personaName} something…`}
                disabled={send.isPending}
                className="flex-1 rounded-full bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-purple/50 outline-none px-4 py-2.5 text-sm disabled:opacity-60"
              />
              <button
                type="submit"
                data-testid={CHAT.send}
                disabled={send.isPending || !input.trim()}
                className="rounded-full px-4 py-2.5 bg-aurora-purple text-white font-semibold hover:brightness-110 disabled:opacity-40 flex items-center justify-center shrink-0"
              >
                {send.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>
          </>
        )}
      </GlassCard>
    </div>
  );
}
