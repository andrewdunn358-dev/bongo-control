import { useEffect, useRef, useState } from 'react';
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

const STARTER_PROMPTS = [
  'Will it rain tonight — should the awning stay in?',
  "What's a sensible rule of thumb for running a heater overnight?",
  'Any tips for finding a quiet spot to park up nearby?',
];

/**
 * An illustrated character, deliberately not a photo — this is a
 * fictional persona for the assistant, not a real person, and drawing
 * her keeps that honest at a glance. Flat, warm, a few clean shapes -
 * matches the app's existing illustration style (the SVG hero art on
 * Home) rather than attempting anything photorealistic.
 */
function MaggieAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="maggie-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#A855F7" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="maggie-hair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9C6B45" />
          <stop offset="100%" stopColor="#6B4226" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="98" fill="url(#maggie-bg)" />
      {/* hair, back layer */}
      <path d="M45,95 Q40,150 60,178 Q78,192 100,192 Q122,192 140,178 Q160,150 155,95 Z" fill="url(#maggie-hair)" />
      {/* loose wavy strands each side */}
      <path d="M58,78 Q44,112 54,142" stroke="url(#maggie-hair)" strokeWidth="11" fill="none" strokeLinecap="round" />
      <path d="M142,78 Q156,112 146,142" stroke="url(#maggie-hair)" strokeWidth="11" fill="none" strokeLinecap="round" />
      {/* neck */}
      <rect x="85" y="118" width="30" height="24" rx="9" fill="#E8B98C" />
      {/* face */}
      <ellipse cx="100" cy="96" rx="42" ry="48" fill="#F0C39A" />
      {/* a couple of soft laugh lines - reads as warm/lived-in, not aged */}
      <path d="M68,102 Q64,108 67,114" stroke="#D9A876" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5" />
      <path d="M132,102 Q136,108 133,114" stroke="#D9A876" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5" />
      {/* hair, front / fringe */}
      <path d="M56,80 Q52,42 100,38 Q148,42 144,80 Q140,54 100,54 Q60,54 56,80 Z" fill="url(#maggie-hair)" />
      {/* a few silver/grey strands - forties, not hiding it */}
      <path d="M70,45 Q80,40 90,44" stroke="#D8D2C8" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
      {/* bandana, classic road-trip styling */}
      <path d="M54,66 Q100,45 146,66 L143,80 Q100,60 57,80 Z" fill="#FB923C" />
      <path d="M140,68 L158,84 L146,90 Z" fill="#FB923C" />
      <circle cx="80" cy="70" r="2.5" fill="#FDE68A" />
      <circle cx="100" cy="65" r="2.5" fill="#FDE68A" />
      <circle cx="120" cy="70" r="2.5" fill="#FDE68A" />
      {/* eyebrows */}
      <path d="M77,88 Q84,84 91,87" stroke="#5C3A21" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M109,86 Q116,82 123,85" stroke="#5C3A21" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* eyes - one open, one an easy wink, for a warm/playful expression */}
      <ellipse cx="84" cy="97" rx="4.5" ry="5.5" fill="#4A2E1E" />
      <ellipse cx="84" cy="95" rx="1.3" ry="1.3" fill="#F5EFE8" />
      <path d="M110,98 Q116,94 122,98" stroke="#4A2E1E" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* nose */}
      <path d="M100,99 Q98,109 95,112 Q100,115 104,112" stroke="#D9A876" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* warm, easy smile */}
      <path d="M80,121 Q100,134 120,121" stroke="#A8563A" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* blush */}
      <ellipse cx="70" cy="109" rx="6" ry="4" fill="#F0A98A" opacity="0.45" />
      <ellipse cx="130" cy="109" rx="6" ry="4" fill="#F0A98A" opacity="0.45" />
      {/* small hoop earring, road-trip charm */}
      <circle cx="58" cy="106" r="4" fill="none" stroke="#FBBF24" strokeWidth="2" />
    </svg>
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

  const status = useQuery({ queryKey: ['ai-status'], queryFn: api.aiStatus });
  const configured = status.data?.configured ?? false;
  const personaName = status.data?.persona_name || 'Maggie';

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

  return (
    <div data-testid={CHAT.root} className="mx-auto max-w-[900px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10 flex flex-col h-[calc(100vh-140px)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <MaggieAvatar size={48} className="rounded-full ring-2 ring-aurora-purple/30 shrink-0" />
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
            label={`${personaName} — vanlife & travel`}
            hint={configured ? "grounded in the van's live location, weather and battery — ask, costs money per message" : 'AI provider not configured'}
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
                  <MaggieAvatar size={72} className="rounded-full ring-2 ring-aurora-purple/30" />
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
                  {m.role === 'assistant' && <MaggieAvatar size={28} className="rounded-full shrink-0 mt-0.5" />}
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
                  <MaggieAvatar size={28} className="rounded-full shrink-0 mt-0.5" />
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
