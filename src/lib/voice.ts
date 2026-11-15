// Voice-set parser + Web Speech wrapper, ported from the Macrotrophy bundle (q_/J_/Y_/X_/Z_/Q_/tv/nv/rv/iv/lv).
// Never guesses: when unsure, `sure` is false and the caller only fills the set in.
const q_: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, ate: 8, won: 1, ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, che: 6, chhe: 6, chhah: 6, saat: 7, sat: 7, aath: 8, aat: 8, nau: 9, das: 10, dus: 10, gyarah: 11, gyara: 11, barah: 12, bara: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19 }
const J_: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, bees: 20, bis: 20, tees: 30, tis: 30, chalis: 40, chaalis: 40, pachas: 50, pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90 }
const Y_: Record<string, number> = { pachees: 25, pachis: 25, paintees: 35, paintis: 35, paintalis: 45, pachpan: 55, painsath: 65, pachattar: 75, pachasi: 85, pachanve: 95, sau: 100, hundred: 100 }
const X_: Record<string, 'kg' | 'lb'> = { kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', killo: 'kg', kilogram: 'kg', kilograms: 'kg', kilogramme: 'kg', k: 'kg', kay: 'kg', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb' }
const Z_ = new Set(['rep', 'reps', 'raps', 'rap', 'wraps', 'repetition', 'repetitions', 'baar', 'bar', 'times'])
const Q_ = new Set(['ke', 'k', 'ka', 'ki', 'kay', 'key', 'into', 'x', 'by', 'for', 'pe', 'par', 'se', 'cross', 'times'])
const SAME = [/^same( again| set| as (before|last))?$/, /^(wahi|vahi|wohi)( wala| set)?$/, /^phir se$/, /^(again|repeat)$/, /^ek (aur|baar aur)$/]
const FILLER = new Set(['and', 'aur', 'a', 'the', 'of', 'with', 'at', 'set', 'did', 'done', 'kiya', 'kiye', 'ho', 'gaya', 'hua'])

export const normalise = (e: string) =>
  e.toLowerCase().replace(/(\d),(\d)/g, '$1$2').replace(/(\d)\s*(kgs?|kilos?|lbs?)\b/g, '$1 $2').replace(/(\d)\s*[x×*]\s*(\d)/g, '$1 x $2')
    .replace(/[०-९]/g, (c) => String('०१२३४५६७८९'.indexOf(c))).replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim()

function parseNumber(e: string[], t: number): { value: number; next: number } | null {
  let n = t, r = 0
  const i = e[n]
  if (i === 'dhai' || i === 'adhai') return { value: 2.5, next: n + 1 }
  if (i === 'dedh') return { value: 1.5, next: n + 1 }
  if (i === 'sadhe' || i === 'saadhe' || i === 'sade') r = 0.5
  else if (i === 'sawa' || i === 'sava') r = 0.25
  else if (i === 'paune' || i === 'pone') r = -0.25
  if (r) n += 1
  let a: number | null = null
  const o = e[n]
  if (o === undefined) return null
  if (/^\d+(\.\d+)?$/.test(o)) { a = Number(o); n += 1 }
  else if (o in Y_) {
    a = Y_[o]; n += 1
    if (a === 100) {
      if (e[n] === 'and') n += 1
      const t2 = parseNumber(e, n)
      if (t2 && t2.value < 100 && Number.isInteger(t2.value)) { a += t2.value; n = t2.next }
      else if (e[n - 1] === 'and') --n
    }
  } else if (o in J_) {
    a = J_[o]; n += 1
    const t2 = e[n]
    if (t2 !== undefined && t2 in q_ && q_[t2] < 10 && q_[t2] > 0) { a += q_[t2]; n += 1 }
  } else if (o in q_) {
    a = q_[o]; n += 1
    if ((e[n] === 'hundred' || e[n] === 'sau') && a > 0 && a < 10) {
      a *= 100; n += 1
      if (e[n] === 'and') n += 1
      const t2 = parseNumber(e, n)
      if (t2 && t2.value < 100 && Number.isInteger(t2.value)) { a += t2.value; n = t2.next }
    }
  }
  if (a === null) return null
  if (e[n] === 'point' && e[n + 1] !== undefined) {
    const t2 = /^\d$/.test(e[n + 1]) ? Number(e[n + 1]) : q_[e[n + 1]]
    if (t2 !== undefined && t2 >= 0 && t2 < 10) { a += t2 / 10; n += 2 }
  } else if (e[n] === 'and' && e[n + 1] === 'a' && e[n + 2] === 'half') { a += 0.5; n += 3 }
  return { value: a + r, next: n }
}

export type VoiceSet = { kind: 'set'; weight: number | null; unit: 'kg' | 'lb' | null; reps: number | null; exercise: string | null; sure: boolean }
export type VoiceResult = { kind: 'same' } | VoiceSet

export function parseVoiceSet(text: string): VoiceResult | null {
  const t = normalise(text)
  if (!t) return null
  if (SAME.some((r) => r.test(t))) return { kind: 'same' }
  const n = t.split(' ')
  const nums: { value: number; at: number; next: number }[] = []
  for (let e = 0; e < n.length;) {
    const p = parseNumber(n, e)
    if (p) { nums.push({ value: p.value, at: e, next: p.next }); e = p.next } else e += 1
  }
  if (nums.length === 0 || nums.length > 2) return null
  const i = nums[0]
  const exercise = n.slice(0, i.at).filter((w) => !FILLER.has(w)).join(' ').trim() || null
  const after = (x: { next: number }) => n[x.next]
  let weight: number | null = null, unit: 'kg' | 'lb' | null = null, reps: number | null = null, sure = false
  if (nums.length === 2) {
    const e = nums[1]
    const mid = n.slice(i.next, e.at)
    const a = mid.find((w) => w in X_)
    const d = mid.some((w) => Q_.has(w))
    const f = Z_.has(after(e) ?? '')
    const p = mid.some((w) => Z_.has(w))
    const m = X_[after(e) ?? '']
    if (p || (m && !a)) { reps = i.value; weight = e.value; unit = m ?? null; sure = p && !!m }
    else { weight = i.value; reps = e.value; unit = a ? X_[a] : null; sure = !!a || d || f }
  } else {
    const e = after(i) ?? ''
    if (e in X_) { weight = i.value; unit = X_[e] }
    else if (Z_.has(e)) reps = i.value
    else return null
  }
  if ((reps !== null && (!Number.isInteger(reps) || reps < 1 || reps > 100)) || (weight !== null && (weight < 0 || weight > 600))) return null
  if (weight !== null && Math.abs(weight * 4 - Math.round(weight * 4)) > 1e-9) sure = false
  if (weight === null || reps === null) sure = false
  return { kind: 'set', weight, unit, reps, exercise, sure }
}

/** Match a spoken exercise name to exactly one candidate, else null. */
export function matchExercise<T extends { name: string }>(spoken: string, list: T[]): T | null {
  const words = normalise(spoken).split(' ').filter(Boolean)
  if (!words.length) return null
  const hits = list.filter((x) => { const t = normalise(x.name).split(' '); return words.every((w) => t.some((v) => v === w || (w.length >= 3 && v.startsWith(w)))) })
  return hits.length === 1 ? hits[0] : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const speechCtor = (): any => (typeof window === 'undefined' ? null : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null)

export function speechErrorText(code: string): string {
  switch (code) {
    case 'not-allowed': case 'service-not-allowed': return 'The microphone is not allowed here. Allow it in browser settings, or use the mic on your keyboard.'
    case 'no-speech': return 'Nothing was heard. Tap the mic and speak, or use the mic on your keyboard.'
    case 'network': return 'Voice needs an internet connection. Type it, or use the mic on your keyboard.'
    case 'audio-capture': return 'No microphone was found. Use the mic on your keyboard instead.'
    default: return 'Voice did not work this time. Try again, or use the mic on your keyboard.'
  }
}

/** One-shot en-IN recognition. Resolves with the final transcript. */
export function listenOnce(onInterim?: (t: string) => void): { promise: Promise<string>; stop: () => void } {
  const C = speechCtor()
  let rec: { stop: () => void } | null = null
  const promise = new Promise<string>((resolve, reject) => {
    if (!C) return reject(new Error('unavailable'))
    const r = new C()
    rec = r
    r.lang = 'en-IN'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1
    let final = ''
    let err: string | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (ev: any) => {
      let f = '', i2 = ''
      for (let k = 0; k < ev.results.length; k++) { const x = ev.results[k]; if (x.isFinal) f += x[0].transcript; else i2 += x[0].transcript }
      if (f) final = f
      onInterim?.((f + ' ' + i2).trim())
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onerror = (ev: any) => { if (ev.error !== 'no-speech' && ev.error !== 'aborted') err = ev.error ?? 'unknown' }
    r.onend = () => (err ? reject(new Error(err)) : final.trim() ? resolve(final.replace(/\s+/g, ' ').trim()) : reject(new Error('no-speech')))
    try { r.start() } catch { reject(new Error('unavailable')) }
  })
  return { promise, stop: () => rec?.stop() }
}
