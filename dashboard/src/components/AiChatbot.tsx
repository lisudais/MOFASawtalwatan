import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bot, Send, X } from 'lucide-react';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT =
  'أنت المساعد الذكي لمركز الأزمات والطوارئ بوزارة الخارجية السعودية. ' +
  'أجب بالعربية الفصحى بإيجاز ومهنية عن أسئلة المستخدم حول الأزمات والكوارث والسلامة والسفر. ' +
  'إذا سُئلت عن شيء خارج نطاقك فوضّح ذلك بأدب.';

const WELCOME: ChatMessage = {
  role: 'assistant',
  content: 'مرحبًا! أنا المساعد الذكي لمركز الأزمات والطوارئ. كيف يمكنني مساعدتك؟',
};

const OFFLINE_REPLY =
  'عذرًا، خدمة المساعد الذكي غير متاحة حاليًا. يرجى المحاولة لاحقًا.';

/** Optional embassy scope: restricts the assistant to one mission's area and
 *  feeds it the already-scope-filtered situation summary. The permission
 *  boundary holds because ONLY scoped data ever reaches the prompt — the
 *  assistant is never handed global data to "promise" not to reveal. */
export interface ChatbotScope {
  embassyNameAr: string;
  hostCountryAr: string;
  contextSummaryAr: string;
}

function systemPrompt(scope?: ChatbotScope): string {
  if (!scope) return SYSTEM_PROMPT;
  return (
    `أنت المساعد الذكي للوحة عمليات ${scope.embassyNameAr} التابعة لوزارة الخارجية السعودية. ` +
    `نطاقك محصور في ${scope.hostCountryAr} والمناطق التابعة للسفارة فقط — هذه صلاحية وصول محدودة. ` +
    'إذا سُئلت عن دول أو سفارات أو بيانات خارج هذا النطاق فاعتذر بأدب ووضّح أن ذلك خارج صلاحيات هذه اللوحة. ' +
    'أجب بالعربية الفصحى بإيجاز ومهنية.\n\n' +
    `ملخص الوضع الحالي ضمن النطاق (استند إليه ولا تخترع بيانات غير مذكورة):\n${scope.contextSummaryAr}`
  );
}

async function askOllama(history: ChatMessage[], scope?: ChatbotScope): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'system', content: systemPrompt(scope) }, ...history],
        stream: false,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return OFFLINE_REPLY;
    const data = await res.json();
    const text = data?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : OFFLINE_REPLY;
  } catch {
    return OFFLINE_REPLY;
  }
}

// Floating AI assistant. The launcher sits in the lower-right corner of the
// map section (just left of the right panel); the chat panel opens above it,
// inside the map area, so the right panel is never covered. Pass `scope` to
// restrict it to one embassy's area (embassy sub-dashboard).
export default function AiChatbot({ scope }: { scope?: ChatbotScope } = {}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  // The panel is position:fixed (so .map-section's overflow:hidden can never
  // clip it) and anchored to the launcher's live position — its right edge
  // aligns with the launcher, keeping it over the map, never over the sidebar.
  const [panelPos, setPanelPos] = useState<{ right: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = launcherRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelPos({
        right: Math.max(8, window.innerWidth - rect.right),
        bottom: window.innerHeight - rect.top + 10,
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setInput('');
    setThinking(true);
    const reply = await askOllama(history, scope);
    setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    setThinking(false);
  };

  return (
    <div className="ai-chatbot-root">
      {open && panelPos && (
        <div className="ai-chat-panel" dir="rtl" style={{ right: panelPos.right, bottom: panelPos.bottom }}>
          <div className="ai-chat-header">
            <span className="ai-chat-avatar"><Bot size={14} /></span>
            <span className="ai-chat-title">المساعد الذكي</span>
            <span className="ai-chat-status"><span className="ai-status-dot" /> متصل</span>
            <button className="ai-chat-close" onClick={() => setOpen(false)} title="إغلاق">
              <X size={14} />
            </button>
          </div>

          <div className="ai-chat-messages" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`ai-chat-msg ${m.role}`}>{m.content}</div>
            ))}
            {thinking && (
              <div className="ai-chat-msg assistant ai-chat-typing">
                <span /><span /><span />
              </div>
            )}
          </div>

          <div className="ai-chat-input-row">
            <input
              ref={inputRef}
              className="ai-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              placeholder="اكتب سؤالك هنا…"
            />
            <button className="ai-chat-send" onClick={send} disabled={thinking || !input.trim()} title="إرسال">
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        ref={launcherRef}
        className={`ai-chat-launcher${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="المساعد الذكي"
      >
        <Bot size={22} />
        <span className="ai-launcher-status-dot" />
        <span className="ai-launcher-tooltip">المساعد الذكي</span>
      </button>
    </div>
  );
}
