import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { ar } from '../i18n/ar';
import {
  sendAiChatMessage,
  ChatMessageItem,
  SAMPLE_AI_PROMPTS,
} from '../services/aiChatService';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  Bot,
  Send,
  Trash2,
  Sparkles,
  AlertCircle,
  Wrench,
  Clock,
  ShieldAlert,
} from 'lucide-react';

export default function AiChatPage() {
  const { store } = useAuth();
  const { isOwner } = usePermissions();

  const [messages, setMessages] = useState<ChatMessageItem[]>(() => {
    // استرجاع رسائل الجلسة من التخزين المحلي إن وُجدت
    try {
      const saved = sessionStorage.getItem(`ai_chat_${store?.id}`);
      if (saved) return JSON.parse(saved) as ChatMessageItem[];
    } catch {
      // تجاهل
    }
    return [];
  });

  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // حفظ المحادثة في الجلسة المحلية
  useEffect(() => {
    if (store?.id && messages.length > 0) {
      try {
        sessionStorage.setItem(`ai_chat_${store.id}`, JSON.stringify(messages));
      } catch {
        // تجاهل
      }
    }
  }, [messages, store?.id]);

  // التمرير التلقائي لأسفل المحادثة
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSendMessage = async (customPrompt?: string) => {
    const text = (customPrompt || inputMessage).trim();
    if (!text || !store?.id || isTyping) return;

    setErrorMessage(null);
    setInputMessage('');

    const userMsg: ChatMessageItem = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const historyPayload = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await sendAiChatMessage(store.id, text, historyPayload);

      const assistantMsg: ChatMessageItem = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: res.reply,
        timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
        toolsUsed: res.tools_used,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : ar.aiServiceError;
      setErrorMessage(errorText);

      const errorMsg: ChatMessageItem = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: errorText,
        timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
      inputRef.current?.focus();
    }
  };

  const handleClearChat = () => {
    if (window.confirm(ar.aiClearChatConfirm)) {
      setMessages([]);
      setErrorMessage(null);
      if (store?.id) {
        sessionStorage.removeItem(`ai_chat_${store.id}`);
      }
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-145px)] max-h-[850px] -mb-20 space-y-3" dir="rtl">
      {/* الترويسة العلوية للشات */}
      <Card className="p-3 bg-slate-900/90 border-slate-800 shadow-md shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 text-emerald-400 border border-emerald-500/30">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-white">{ar.aiChatTitle}</h2>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
              <p className="text-[11px] text-slate-400">{ar.aiChatSubtitle}</p>
            </div>
          </div>

          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearChat}
              className="text-xs text-slate-400 hover:text-rose-400 border-slate-800 px-2.5 py-1"
              icon={<Trash2 className="w-3.5 h-3.5" />}
            >
              <span className="hidden sm:inline">{ar.aiClearChat}</span>
            </Button>
          )}
        </div>

        {!isOwner && (
          <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-950/40 border border-sky-800/40 text-[11px] text-sky-300">
            <ShieldAlert className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>{ar.aiStaffNotice}</span>
          </div>
        )}
      </Card>

      {/* منطقة الرسائل */}
      <div className="flex-1 overflow-y-auto px-1 space-y-3 scrollbar-thin scrollbar-thumb-slate-800">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col justify-center items-center text-center p-4 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-inner">
              <Sparkles className="w-7 h-7" />
            </div>
            <div className="max-w-xs space-y-1">
              <h3 className="text-base font-bold text-white">{ar.aiWelcomeTitle}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{ar.aiWelcomeDesc}</p>
            </div>

            {/* أزرار الأسئلة الجاهزة المقترحة */}
            <div className="w-full max-w-sm pt-2 space-y-2">
              <p className="text-[11px] font-bold text-slate-400 text-right">{ar.aiSamplePromptsTitle}</p>
              <div className="flex flex-wrap gap-1.5 justify-start">
                {SAMPLE_AI_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => void handleSendMessage(prompt)}
                    className="text-right text-xs px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-emerald-500/40 transition active:scale-[0.98]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}
                >
                  <div
                    className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed shadow-md ${
                      isUser
                        ? 'bg-emerald-600 text-white rounded-tr-sm'
                        : msg.isError
                        ? 'bg-rose-950/80 border border-rose-800/80 text-rose-200 rounded-tl-sm'
                        : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-sm'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>

                    {/* الأدوات المستخدمة في الرد */}
                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1 text-[10px] text-slate-400 font-mono">
                        <Wrench className="w-3 h-3 text-emerald-400" />
                        <span>{ar.aiToolsUsedLabel}</span>
                        {msg.toolsUsed.map((tool, tIdx) => (
                          <span
                            key={tIdx}
                            className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-emerald-300"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <span className="text-[10px] text-slate-500 mt-1 px-1 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {msg.timestamp}
                  </span>
                </div>
              );
            })}

            {/* حالة يكتب الآن */}
            {isTyping && (
              <div className="flex flex-col items-end">
                <div className="rounded-2xl rounded-tl-sm bg-slate-900 border border-slate-800 px-4 py-3 shadow-md flex items-center gap-2">
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.2s]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.4s]"></span>
                  </div>
                  <span className="text-xs text-slate-400 mr-2">{ar.aiTyping}</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* شريط الإدخال السفلي */}
      <div className="shrink-0 space-y-2 pt-1">
        {errorMessage && (
          <div className="p-2 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-1.5 truncate">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span className="truncate">{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleSendMessage()}
              className="text-xs font-bold text-rose-300 underline shrink-0 mr-2"
            >
              {ar.aiRetry}
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendMessage();
          }}
          className="flex items-center gap-2 bg-slate-900/95 border border-slate-800 rounded-2xl p-1.5 shadow-lg focus-within:border-emerald-500/50 transition"
        >
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-0 px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none"
            placeholder={ar.aiInputPlaceholder}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={isTyping}
            maxLength={500}
          />

          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!inputMessage.trim() || isTyping}
            isLoading={isTyping}
            className="rounded-xl px-4 py-2 shrink-0 shadow-md shadow-emerald-500/20"
            icon={<Send className="w-4 h-4 rotate-180" />}
          >
            <span className="hidden sm:inline">{ar.aiSend}</span>
          </Button>
        </form>
      </div>
    </div>
  );
}
