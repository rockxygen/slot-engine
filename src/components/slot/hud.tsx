'use client'

import { useEffect } from 'react'
import { BET_OPTIONS, formatMinor, useGameStore } from '@/store/game-store'
import { useAccountStore } from '@/store/account-store'

function useSpinHotkey(canSpin: boolean): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (canSpin) useGameStore.getState().spin()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canSpin])
}

/// Otomatik dönüş sürücüsü (Faz 8): tur `settle` olup phase idle'a dönünce
/// kısa gecikmeyle bir sonraki turu atar. Durdurma koşulları burada toplanır:
/// hata (limit/KYC/402), bakiye yetersiz, kalan tur 0, elle durdurma.
function useAutoSpinDriver(): void {
  const autoRemaining = useGameStore((s) => s.autoRemaining)
  const phase = useGameStore((s) => s.phase)
  const error = useGameStore((s) => s.error)
  const balance = useGameStore((s) => s.balance)
  const bet = useGameStore((s) => s.bet)

  useEffect(() => {
    if (autoRemaining === null) return
    if (autoRemaining <= 0) {
      // Geri sayım bitti → temiz kapanış (buton ön ayara döner)
      useGameStore.getState().stopAuto()
      return
    }
    if (phase !== 'idle') return // tur animasyonda — settle beklenir
    if (error !== null || balance === null || balance < bet) {
      useGameStore.getState().stopAuto()
      return
    }
    const timer = setTimeout(() => {
      const s = useGameStore.getState()
      // phase senkron kilitli (spin içinde) — bu tick'te yalnızca idle ise at
      if (s.phase !== 'idle' || s.autoRemaining === null) return
      void s.spin()
      useGameStore.getState().decAuto() // bu tur da sayıldı
    }, 650)
    return () => clearTimeout(timer)
  }, [autoRemaining, phase, error, balance, bet])
}

export function TopBar() {
  const balance = useGameStore((s) => s.balance)
  const soundOn = useGameStore((s) => s.soundOn)
  const player = useAccountStore((s) => s.player)

  return (
    <header className="flex w-full max-w-[1080px] items-center justify-between gap-4">
      <h1 className="text-2xl font-black tracking-wide text-amber-300 sm:text-3xl">
        🍀 CLOVER LINK BELLS
      </h1>
      <div className="flex items-center gap-2">
        {/* Hesap + limit paneli tetikleyicileri (Faz 7 UI) */}
        <button
          type="button"
          onClick={() => useAccountStore.getState().openPanel('account')}
          className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition hover:bg-white/5 ${
            player === null
              ? 'border-white/20 text-slate-300'
              : player.kycStatus === 'verified'
                ? 'border-emerald-400/40 text-emerald-300'
                : player.kycStatus === 'pending'
                  ? 'border-amber-400/40 text-amber-300'
                  : 'border-rose-400/40 text-rose-300'
          }`}
          title={player ? `${player.username} — ${player.kycStatus}` : 'Giriş / kayıt'}
        >
          {player === null ? '👤 Giriş' : `👤 ${player.username}`}
          {player && (
            <span aria-hidden>
              {player.kycStatus === 'verified'
                ? '✓'
                : player.kycStatus === 'pending'
                  ? '…'
                  : '!'}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => useAccountStore.getState().openPanel('limits')}
          className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/5"
          title="Sorumlu oyun limitleri"
        >
          Limitler
        </button>
        <button
          type="button"
          onClick={() => useGameStore.getState().toggleSound()}
          className="rounded-full border border-white/20 px-3 py-2 text-sm transition hover:bg-white/5"
          title={soundOn ? 'Sesi kapat' : 'Sesi aç'}
          aria-label={soundOn ? 'Sesi kapat' : 'Sesi aç'}
        >
          {soundOn ? '🔊' : '🔇'}
        </button>
        <div className="flex items-center gap-2 rounded-full border border-amber-400/40 bg-slate-900 px-5 py-2 text-sm font-semibold text-slate-300 sm:text-base">
          BAKİYE
          <span className="font-mono text-amber-300">
            {balance === null ? '…' : `${formatMinor(balance)} ₺`}
          </span>
        </div>
      </div>
    </header>
  )
}

export function Controls() {
  const balance = useGameStore((s) => s.balance)
  const bet = useGameStore((s) => s.bet)
  const phase = useGameStore((s) => s.phase)
  const winShown = useGameStore((s) => s.winShown)
  const fsLabel = useGameStore((s) => s.fsLabel)
  const error = useGameStore((s) => s.error)
  const autoRemaining = useGameStore((s) => s.autoRemaining)
  const autoPreset = useGameStore((s) => s.autoPreset)
  useAutoSpinDriver()

  const idle = phase === 'idle'
  const autoRunning = autoRemaining !== null
  const canSpin = idle && balance !== null && balance >= bet
  useSpinHotkey(canSpin)

  const statusLabel =
    balance === null
      ? 'BAKİYE YÜKLENİYOR…'
      : phase === 'spinning'
        ? 'ÇEVİRİLİYOR…'
        : phase === 'link'
          ? 'LINK BONUS!'
          : phase === 'freespins'
            ? (fsLabel ?? 'BEDAVA DÖNÜŞLER')
            : autoRunning
              ? `OTOMATİK — ${autoRemaining} TUR`
              : winShown > 0
                ? 'KAZANÇ'
                : 'HAZIR — ÇEVİR!'

  return (
    <footer className="flex w-full max-w-[1080px] flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      {/* Bahis seçimi */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase text-slate-400">
          Bahis
        </span>
        <div className="flex gap-1">
          {BET_OPTIONS.map((b) => (
            <button
              key={b}
              type="button"
              disabled={!idle || autoRunning}
              onClick={() => useGameStore.getState().setBet(b)}
              className={`rounded-lg border px-3 py-1.5 font-mono text-sm transition disabled:opacity-40 ${
                bet === b
                  ? 'border-amber-400 bg-amber-400/10 text-amber-300'
                  : 'border-white/10 text-slate-300 hover:bg-white/5'
              }`}
            >
              {formatMinor(b)}
            </button>
          ))}
        </div>
      </div>

      {/* Durum + kazanç + hata */}
      <div className="order-3 min-w-[220px] text-center sm:order-none">
        <div
          className={`text-xs font-semibold uppercase tracking-widest ${
            error ? 'text-rose-400' : autoRunning ? 'text-amber-300' : 'text-slate-400'
          }`}
        >
          {error ?? statusLabel}
        </div>
        <div
          className={`font-mono text-2xl font-bold ${
            winShown > 0 ? 'text-amber-300' : 'text-white/30'
          }`}
        >
          {winShown > 0 ? `${formatMinor(winShown)} ₺` : '—'}
        </div>
      </div>

      {/* Otomatik dönüş + SPIN / bakiye yenileme */}
      <div className="flex items-center gap-3">
        {!canSpin && balance !== null && balance < bet && idle && (
          <button
            type="button"
            onClick={() => void useGameStore.getState().refill()}
            className="rounded-xl border border-rose-400/50 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/20"
          >
            Demo bakiye yükle
          </button>
        )}

        {/* Otomatik dönüş: ön ayar (10/25/50) + başlat/durdur */}
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            disabled={autoRunning || !idle}
            onClick={() => useGameStore.getState().cycleAutoPreset()}
            className="rounded-lg border border-white/10 px-2.5 py-1 font-mono text-xs text-slate-400 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            title="Otomatik dönüş tur sayısı"
          >
            ×{autoPreset}
          </button>
          <button
            type="button"
            onClick={() => useGameStore.getState().toggleAuto()}
            className={`rounded-xl border px-4 py-2.5 text-sm font-bold transition ${
              autoRunning
                ? 'border-rose-400/60 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                : canSpin
                  ? 'border-amber-400/50 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20'
                  : 'border-white/10 text-slate-500'
            }`}
            title={
              autoRunning
                ? 'Otomatik dönüşü durdur'
                : `Otomatik ${autoPreset} tur başlat`
            }
          >
            {autoRunning ? `AUTO ■ ${autoRemaining}` : `AUTO ▶ ×${autoPreset}`}
          </button>
        </div>

        <button
          type="button"
          disabled={!canSpin}
          onClick={() => useGameStore.getState().spin()}
          className="h-20 w-20 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-lg font-black text-slate-900 shadow-lg shadow-amber-500/30 transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:h-24 sm:w-24"
        >
          ÇEVİR
        </button>
      </div>
    </footer>
  )
}
