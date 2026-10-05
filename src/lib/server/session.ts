import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { getDb } from './db'
import { createSession, getSession } from './wallet'

export const SESSION_COOKIE = 'slot_sid'

/**
 * Cookie'den oturumu alır; yoksa demo cüzdanı açıp cookie yazar.
 *
 * DEMO KİMLİĞİ: rastgele UUID + HttpOnly cookie. Gerçek para modunda bu
 * fonksiyonun yerini hesap/KYC kimliği alır (burası değişmez kalır).
 *
 * Sadece Route Handler / Server Action'dan çağrılabilir (`cookies()`
 * bağımı gerekiyor).
 */
export async function getOrCreateSessionId(): Promise<string> {
  const store = await cookies()
  const existing = store.get(SESSION_COOKIE)?.value
  if (existing && getSession(getDb(), existing)) {
    return existing
  }

  // İlk ziyaret: cüzdan aç (eşzamanlı istekte en son yazan cookie kazanır;
  // atanmayan oturumlar demo bakiyesiyle izole kalır, para taşınmaz)
  const id = randomUUID()
  createSession(getDb(), id)
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })
  return id
}
