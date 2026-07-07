'use client';

import { useEffect, useRef, useState } from 'react';

export interface ChatbotState {
  businessType: string;
  modalIdr: number;
  userContext: string;
  sqlCategory: string;
  kotaKab: string;
  darkMode: boolean;
  hasResults: boolean;
  topRankings: Array<{ rank: number; kelurahan: string; kecamatan: string; score: number }>;
  selectedKelurahan: { kelurahan: string; kecamatan: string; rank: number; score: number } | null;
  spotsForSelected: Array<{ rank: number; name: string; placeType: string; anchorName: string; score: number }>;
}

export interface ChatbotActions {
  setBusinessType: (type: string) => void;
  setModalIdr: (amount: number) => void;
  setUserContext: (context: string) => void;
  setKotaKab: (kotaKab: string) => void;
  triggerSearch: (overrides?: { businessType?: string; modalIdr?: number; userContext?: string; kotaKab?: string }) => void;
  selectKelurahan: (rank: number) => void;
  flyToSpot: (spotRank: number) => void;
  compareKelurahan: (rankA: number, rankB: number) => void;
  exportPDF: () => void;
  toggleDarkMode: () => void;
}

type ToolCall = { name: string; input: Record<string, unknown> };

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  setBusinessType: i => `Jenis usaha → ${i.type}`,
  setModalIdr: i => `Modal → Rp ${Number(i.amount).toLocaleString('id-ID')}`,
  setUserContext: i => `Konteks → "${i.context}"`,
  setKotaKab: i => `Kota → ${i.kotaKab}`,
  triggerSearch: () => `Menjalankan analisis...`,
  selectKelurahan: i => `Pilih ranking #${i.rank}`,
  flyToSpot: i => `Zoom ke spot #${i.spotRank}`,
  compareKelurahan: i => `Bandingkan #${i.rankA} vs #${i.rankB}`,
  exportPDF: () => `Export PDF`,
  toggleDarkMode: () => `Toggle tema`,
};

const SUGGESTIONS = [
  'Ganti jenis usaha menjadi Toko Roti',
  'Pindah analisis ke Depok dengan modal 100 juta',
  'Pilih ranking #2',
  'Apa kekurangan lokasi #1?',
];

export function Chatbot({ state, actions }: { state: ChatbotState; actions: ChatbotActions }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
    if (open) setHasNew(false);
  }, [open]);

  // Tutup panel saat klik di luar panel
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function executeToolCalls(toolCalls: ToolCall[]) {
    const overrides: { businessType?: string; modalIdr?: number; userContext?: string; kotaKab?: string } = {};
    for (const call of toolCalls) {
      if (call.name === 'setBusinessType') overrides.businessType = String(call.input.type ?? '');
      if (call.name === 'setModalIdr') overrides.modalIdr = Number(call.input.amount ?? 0);
      if (call.name === 'setUserContext') overrides.userContext = String(call.input.context ?? '');
      if (call.name === 'setKotaKab') overrides.kotaKab = String(call.input.kotaKab ?? '');
    }

    for (const call of toolCalls) {
      try {
        switch (call.name) {
          case 'setBusinessType':
            actions.setBusinessType(String(call.input.type ?? ''));
            break;
          case 'setModalIdr':
            actions.setModalIdr(Number(call.input.amount ?? 0));
            break;
          case 'setUserContext':
            actions.setUserContext(String(call.input.context ?? ''));
            break;
          case 'setKotaKab':
            actions.setKotaKab(String(call.input.kotaKab ?? ''));
            break;
          case 'triggerSearch':
            actions.triggerSearch(Object.keys(overrides).length > 0 ? overrides : undefined);
            break;
          case 'selectKelurahan':
            actions.selectKelurahan(Number(call.input.rank ?? 1));
            break;
          case 'flyToSpot':
            actions.flyToSpot(Number(call.input.spotRank ?? 1));
            break;
          case 'compareKelurahan':
            actions.compareKelurahan(Number(call.input.rankA ?? 1), Number(call.input.rankB ?? 2));
            break;
          case 'exportPDF':
            actions.exportPDF();
            break;
          case 'toggleDarkMode':
            actions.toggleDarkMode();
            break;
        }
      } catch (err) {
        console.warn(`Tool ${call.name} failed:`, err);
      }
    }
  }

  async function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          state,
        }),
      });
      if (!res.ok) throw new Error('Chat API error');
      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.text || '',
        toolCalls: data.toolCalls?.length ? data.toolCalls : undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);

      if (data.toolCalls?.length) {
        executeToolCalls(data.toolCalls);
      }
      if (!open) setHasNew(true);
    } catch (err) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Maaf, terjadi kesalahan. Silakan coba lagi.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Buka asisten PetaCuan"
        style={{
          position: 'fixed',
          bottom: 22,
          right: 22,
          padding: '11px 16px 11px 11px',
          borderRadius: 999,
          border: '1px solid var(--border-active)',
          background: 'var(--bg-card)',
          backdropFilter: 'blur(20px)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '-0.005em',
          boxShadow: 'var(--chatbot-fab-shadow)',
          zIndex: 900,
          transition: 'transform 0.2s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s ease, border-color 0.2s ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = 'var(--chatbot-fab-shadow-hover)';
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'var(--chatbot-fab-shadow)';
          e.currentTarget.style.borderColor = 'var(--border-active)';
        }}
      >
        {/* Avatar with sparkle + pulse ring */}
        <span
          style={{
            position: 'relative',
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--violet) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 14px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.25)',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--chatbot-icon)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15l-1.6-4.2L6 9.2l4.4-1.6L12 3z" />
            <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
          </svg>
          <span
            style={{
              position: 'absolute',
              inset: -3,
              borderRadius: '50%',
              border: '1.5px solid var(--chatbot-ring)',
              animation: 'chat-pulse 2.4s cubic-bezier(0.16,1,0.3,1) infinite',
              pointerEvents: 'none',
            }}
          />
        </span>

        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, lineHeight: 1 }}>
          <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>Asisten AI</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 500, letterSpacing: '0.01em' }}>
            Tanya apa saja
          </span>
        </span>

        {hasNew && (
          <span
            style={{
              position: 'absolute',
              top: 6,
              right: 8,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'var(--red)',
              boxShadow: '0 0 8px var(--red), 0 0 0 2px var(--bg-base)',
            }}
          />
        )}
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className="animate-fade-up"
      style={{
        position: 'fixed',
        bottom: 22,
        right: 22,
        width: 380,
        height: 560,
        maxHeight: 'calc(100vh - 44px)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        boxShadow: 'var(--chatbot-panel-shadow)',
        backdropFilter: 'blur(20px)',
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'var(--font-body)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, var(--accent-dim) 0%, transparent 100%)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--violet) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 12px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--chatbot-icon)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15l-1.6-4.2L6 9.2l4.4-1.6L12 3z" />
            <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.1 }}>
            Asisten PetaCuan
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            Dapat mengganti input & menjalankan aksi
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          title="Tutup"
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            border: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          <div style={{ padding: '6px 4px' }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 12 }}>
              Halo! Saya dapat membantu mengganti input, menjalankan analisis, atau menjelaskan hasil. Silakan coba contoh berikut:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                    fontSize: 11.5,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                    transition: 'all 0.12s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--accent-dim)';
                    e.currentTarget.style.color = 'var(--accent)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'var(--bg-surface)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  → {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(m => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
              gap: 4,
            }}
          >
            <div
              style={{
                maxWidth: '85%',
                padding: '8px 11px',
                borderRadius: 12,
                background: m.role === 'user' ? 'var(--accent-dim)' : 'var(--bg-surface)',
                border: m.role === 'user' ? '1px solid var(--border-active)' : '1px solid var(--border)',
                color: m.role === 'user' ? 'var(--accent)' : 'var(--text-primary)',
                fontSize: 12.5,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.content || (m.toolCalls ? '...' : '')}
            </div>
            {m.toolCalls && m.toolCalls.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: '85%' }}>
                {m.toolCalls.map((tc, idx) => {
                  const label = TOOL_LABELS[tc.name]?.(tc.input) ?? tc.name;
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: 'color-mix(in srgb, var(--emerald) 10%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--emerald) 32%, transparent)',
                        color: 'var(--emerald)',
                        fontSize: 10.5,
                        fontWeight: 600,
                        width: 'fit-content',
                      }}
                    >
                      <span style={{ fontSize: 9 }}>⚡</span>
                      {label}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 12,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                display: 'flex',
                gap: 4,
                alignItems: 'center',
              }}
            >
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    animation: `pulse-soft 1.2s ease-in-out ${i * 0.15}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div
        style={{
          padding: 10,
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-sidebar)',
          display: 'flex',
          gap: 7,
          alignItems: 'flex-end',
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tanyakan atau minta tindakan..."
          rows={1}
          disabled={loading}
          style={{
            flex: 1,
            padding: '8px 10px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text-primary)',
            fontSize: 12.5,
            fontFamily: 'var(--font-body)',
            resize: 'none',
            outline: 'none',
            maxHeight: 90,
            lineHeight: 1.45,
          }}
        />
        <button
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: !input.trim() || loading ? '1px solid var(--border)' : '1px solid var(--accent)',
            background: !input.trim() || loading
              ? 'var(--bg-surface)'
              : 'linear-gradient(135deg, var(--accent) 0%, var(--violet) 100%)',
            color: !input.trim() || loading ? 'var(--text-muted)' : 'var(--chatbot-icon)',
            fontWeight: 700,
            fontSize: 14,
            cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-body)',
            flexShrink: 0,
            boxShadow: !input.trim() || loading ? 'none' : '0 0 12px var(--accent-glow)',
            transition: 'all 0.15s ease',
          }}
          title="Kirim (Enter)"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
