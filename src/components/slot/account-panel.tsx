'use client'

import { useState } from 'react'
import type { KycStatus, LimitsState, LimitsUsage } from '@/lib/api-types'
import {
  formatMinorInput,
  formatMinuteInput,
  parseMinuteInput,
  parseMinorInput,
} from '@/lib/limit-input'
import { useAccountStore } from '@/store/account-store'
import { formatMinor } from '@/store/game-store'

/// Hesap + limit paneli (Faz 7 UI): sunucu gerçeğini gösterir, form
/// dönüşümleri `limit-input.ts` saf fonksiyonlarıdır (testli).

const KYC_BADGE: Record<
  KycStatus,
  { icon: string; text: string; cls: string }
> = {
  verified: {
    icon: '✓',
    text: 'KYC doğrulandı',
    cls: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
  },
  pending: {
    icon: '…',
    text: 'KYC bekliyor',
    cls: 'border-amber-400/40 bg-amber-500/10 text-amber-300',
  },
  rejected: {
    icon: '!',
    text: 'KYC reddedildi',
    cls: 'border-rose-400/40 bg-rose-500/10 text-rose-300',
  },
}

const inputCls =
  'w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none'
const btnCls =
  'rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/5 disabled:opacity-40'
const primaryCls =
  'rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900 transition hover:brightness-110 disabled:opacity-40'

function Flash() {
  const error = useAccountStore((s) => s.error)
  const notice = useAccountStore((s) => s.notice)
  if (!error && !notice) return null
  return (
    <p
      className={`text-xs font-semibold ${error ? 'text-rose-400' : 'text-emerald-300'}`}
    >
      {error ?? notice}
    </p>
  )
}

function KycBadge({ status }: { status: KycStatus }) {
  const b = KYC_BADGE[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${b.cls}`}
    >
      <span aria-hidden>{b.icon}</span>
      {b.text}
    </span>
  )
}

function AccountTab() {
  const player = useAccountStore((s) => s.player)
  const busy = useAccountStore((s) => s.busy)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const submit = async (mode: 'login' | 'register'): Promise<void> => {
    const store = useAccountStore.getState()
    const ok =
      mode === 'login'
        ? await store.login(username, password)
        : await store.register(username, password)
    if (ok) {
      setUsername('')
      setPassword('')
    }
  }

  if (!player) {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit('login')
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
          Kullanıcı adı
          <input
            className={inputCls}
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            placeholder="3–32 karakter · a-z, 0-9, _ -"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
          Parola
          <input
            className={inputCls}
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="en az 8 karakter"
          />
        </label>
        <Flash />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || username === '' || password === ''}
            className={primaryCls}
          >
            Giriş
          </button>
          <button
            type="button"
            disabled={busy || username === '' || password === ''}
            onClick={() => void submit('register')}
            className={btnCls}
          >
            Kayıt ol
          </button>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          Kayıt = demo hesap; <strong className="text-slate-400">kyc_status: pending</strong>{' '}
          iken tur oynamak <strong className="text-rose-400">403</strong> ile
          engellenir. Onay, gerçek üründe KYC sağlayıcısının webhook&#39;u ile
          gelir (demo: aşağıdaki buton).
        </p>
      </form>
    )
  }

  const kyc = player.kycStatus
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase text-slate-500">
            Hesap
          </div>
          <div className="text-lg font-bold text-white">{player.username}</div>
        </div>
        <KycBadge status={kyc} />
      </div>

      {kyc !== 'verified' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-800/60 p-3">
          <span className="text-xs text-slate-400">Demo KYC:</span>
          {kyc === 'pending' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void useAccountStore.getState().verifyKyc('verified')}
                className={primaryCls}
              >
                Belgeleri onayla
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void useAccountStore.getState().verifyKyc('rejected')}
                className={btnCls}
              >
                Reddet
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void useAccountStore.getState().verifyKyc('pending')}
              className={btnCls}
            >
              Belgeleri yeniden gönder (beklemeye al)
            </button>
          )}
        </div>
      )}

      <Flash />
      <button
        type="button"
        disabled={busy}
        onClick={() => void useAccountStore.getState().logout()}
        className={btnCls}
      >
        Çıkış yap
      </button>
      <p className="text-xs leading-relaxed text-slate-500">
        Bakiye/ledger oturumda kalır — giriş yalnızca <em>kimliktir</em>, para
        hareketlerini etkilemez.
      </p>
    </div>
  )
}

function LimitsTab() {
  const limits = useAccountStore((s) => s.limits)
  const usage = useAccountStore((s) => s.usage)

  if (!limits) {
    return <p className="text-sm text-slate-400">Limitler yükleniyor…</p>
  }
  // `key`: sunucu ONAYLI yeni limit geldiğinde form yeniden montaj olur →
  // inputlar her zaman server değeriyle açılır (efekt içinde setState yok).
  return (
    <LimitsForm key={JSON.stringify(limits)} limits={limits} usage={usage} />
  )
}

function LimitsForm({
  limits,
  usage,
}: {
  limits: LimitsState
  usage: LimitsUsage | null
}) {
  const busy = useAccountStore((s) => s.busy)
  const [loss, setLoss] = useState(() => formatMinorInput(limits.lossLimit))
  const [spend, setSpend] = useState(() => formatMinorInput(limits.spendLimit))
  const [minutes, setMinutes] = useState(() =>
    formatMinuteInput(limits.sessionLimitSec),
  )
  const [inputError, setInputError] = useState<string | null>(null)

  const save = async (reset: boolean): Promise<void> => {
    const pLoss = reset ? { ok: true, value: null } : parseMinorInput(loss)
    const pSpend = reset ? { ok: true, value: null } : parseMinorInput(spend)
    const pMin = reset ? { ok: true, value: null } : parseMinuteInput(minutes)
    if (!pLoss.ok || !pSpend.ok || !pMin.ok) {
      setInputError(
        'Geçersiz değer: tutar ₺ (örn. 500 veya 500,50), süre dakika (örn. 60)',
      )
      return
    }
    setInputError(null)
    await useAccountStore.getState().saveLimits({
      lossLimit: pLoss.value,
      spendLimit: pSpend.value,
      sessionLimitSec: pMin.value,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-slate-500">
          Sorumlu oyun limitleri
        </span>
        <span className="text-xs text-slate-500">boş = sınırsız</span>
      </div>

      {usage && (
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/10 bg-slate-800/60 p-3 text-center">
          <div>
            <div className="text-[10px] uppercase text-slate-500">Net</div>
            <div
              className={`font-mono text-sm font-bold ${usage.netLoss > 0 ? 'text-rose-400' : 'text-emerald-300'}`}
            >
              {formatMinor(Math.abs(usage.netLoss))} ₺
            </div>
            <div className="text-[10px] text-slate-500">
              {usage.netLoss > 0 ? 'kayıp' : 'kazanç'}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500">Ciro</div>
            <div className="font-mono text-sm font-bold text-slate-200">
              {formatMinor(usage.spend)} ₺
            </div>
            <div className="text-[10px] text-slate-500">toplam bahis</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500">Süre</div>
            <div className="font-mono text-sm font-bold text-slate-200">
              {Math.floor(usage.playSeconds / 60)} dk
            </div>
            <div className="text-[10px] text-slate-500">oturum</div>
          </div>
        </div>
      )}

      <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
        Kayıp limiti
        <span className="flex items-center gap-2">
          <input
            className={`${inputCls} w-36 text-right font-mono`}
            inputMode="decimal"
            value={loss}
            onChange={(e) => setLoss(e.target.value)}
            placeholder="500,00"
          />
          <span className="text-xs text-slate-500">₺</span>
        </span>
      </label>
      <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
        Harcama (ciro) limiti
        <span className="flex items-center gap-2">
          <input
            className={`${inputCls} w-36 text-right font-mono`}
            inputMode="decimal"
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
            placeholder="1000,00"
          />
          <span className="text-xs text-slate-500">₺</span>
        </span>
      </label>
      <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
        Oturum süresi
        <span className="flex items-center gap-2">
          <input
            className={`${inputCls} w-36 text-right font-mono`}
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="60"
          />
          <span className="text-xs text-slate-500">dk</span>
        </span>
      </label>

      {inputError && <p className="text-xs font-semibold text-rose-400">{inputError}</p>}
      <Flash />

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(false)}
          className={primaryCls}
        >
          Kaydet
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(true)}
          className={btnCls}
        >
          Tümünü sınırsız yap
        </button>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        Limitler <strong className="text-slate-400">sunucuda</strong> zorlanır —
        aşıldığında tur <code className="text-rose-400">403 limit_exceeded</code>{' '}
        ile üretilmez ve hiçbir kayıt yazılmaz.
      </p>
    </div>
  )
}

export function AccountPanel() {
  const panel = useAccountStore((s) => s.panel)
  const close = useAccountStore((s) => s.closePanel)

  if (panel === 'closed') return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={close}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={panel === 'account' ? 'Hesap' : 'Limitler'}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-amber-300">
            {panel === 'account' ? 'HESAP GİRİŞİ' : 'LİMİTLER'}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Kapat"
            className="rounded-lg border border-white/10 px-3 py-1 text-sm text-slate-400 hover:bg-white/5"
          >
            ✕
          </button>
        </div>
        {panel === 'account' ? <AccountTab /> : <LimitsTab />}
      </div>
    </div>
  )
}
