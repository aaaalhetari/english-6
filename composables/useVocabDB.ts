import Dexie, { type Table } from 'dexie'
import frequencyData from '~/data/frequency.json'

export interface VocabWord {
  lemma: string
  forms_seen: string[]
  freq_rank: number
  cefr: string
  total_exposures: number
  total_clicks: number
  since_last_click: number
  status: 'active' | 'inactive' | 'pool'
}

export interface DefCard {
  key: string            // `${lemma}::${contextHash}`
  lemma: string
  context: string
  definition: string
  examples: string[]
  source: 'claude' | 'local' | 'dictionary'
  level: string
  created: number
}

export interface AudioClip {
  key: string            // `${voice}|${lemma}`
  blob: Blob
}

class VocabDatabase extends Dexie {
  words!: Table<VocabWord, string>
  cards!: Table<DefCard, string>
  audio!: Table<AudioClip, string>

  constructor() {
    super('vocab_reader_db')
    this.version(1).stores({
      words: 'lemma, status, freq_rank'
    })
    // v2: the vocabulary list was rebuilt (9,000 WordNet-checked words).
    // Drop records that are no longer tracked or are below the learner's level,
    // and refresh rank/level for the rest - learning progress is kept.
    this.version(2).stores({
      words: 'lemma, status, freq_rank'
    }).upgrade(async tx => {
      const freq = frequencyData as Record<string, { rank: number; cefr: string }>
      await tx.table('words').toCollection().modify((w: VocabWord, ref: any) => {
        const meta = freq[w.lemma]
        if (!meta || meta.cefr === 'A1' || meta.cefr === 'A2') {
          delete ref.value
          return
        }
        w.freq_rank = meta.rank
        w.cefr = meta.cefr
      })
    })
    // v3: stores for generated definition cards and cached audio clips
    this.version(3).stores({
      words: 'lemma, status, freq_rank',
      cards: 'key, lemma',
      audio: 'key'
    })
  }
}

const db = new VocabDatabase()
const DEFAULT_INACTIVITY = 5
const DEFAULT_ACTIVE_TARGET = 50
// Words below the learner's level (B1-B2) are never tracked - they are already known
const SKIP_LEVELS = new Set(['A1', 'A2'])

export function useVocabDB() {
  const { inactivityThreshold, activeTarget } = useSettings()
  const INACTIVITY_THRESHOLD = inactivityThreshold?.value ?? DEFAULT_INACTIVITY
  // Creates a new record for a word discovered for the first time (enters pool)
  async function discoverWord(lemma: string, form: string) {
    const existing = await db.words.get(lemma)
    if (existing) {
      if (!existing.forms_seen.includes(form)) {
        existing.forms_seen.push(form)
        await db.words.put(existing)
      }
      return existing
    }
    const meta = (frequencyData as Record<string, { rank: number; cefr: string }>)[lemma]
    if (!meta || SKIP_LEVELS.has(meta.cefr)) return null // unknown or below learner level

    const word: VocabWord = {
      lemma,
      forms_seen: [form],
      freq_rank: meta.rank,
      cefr: meta.cefr,
      total_exposures: 0,
      total_clicks: 0,
      since_last_click: 0,
      status: 'pool'
    }
    await db.words.put(word)
    return word
  }

  // Registers an actual appearance of a word (found by scanning the AI reply text)
  async function registerExposure(lemma: string) {
    const word = await db.words.get(lemma)
    if (!word) return
    word.total_exposures += 1
    word.since_last_click += 1
    if (word.since_last_click >= INACTIVITY_THRESHOLD && word.status === 'active') {
      word.status = 'inactive'
    }
    await db.words.put(word)
  }

  // Registers a user click on a word
  async function registerClick(lemma: string) {
    const word = await db.words.get(lemma)
    if (!word) return
    word.total_clicks += 1
    word.since_last_click = 0
    word.status = 'active'
    await db.words.put(word)
  }

  // Selects the top N active words to send to the AI, ranked by frequency,
  // topped up from the pool if there are not enough active words yet
  async function getTopActiveWords(limit = activeTarget?.value ?? DEFAULT_ACTIVE_TARGET): Promise<VocabWord[]> {
    const active = await db.words.where('status').equals('active').sortBy('freq_rank')
    if (active.length >= limit) return active.slice(0, limit)

    const pool = await db.words.where('status').equals('pool').sortBy('freq_rank')
    const filler = pool.slice(0, limit - active.length)
    return [...active, ...filler]
  }

  // Batch version used by the scanning engine: one database round-trip for a
  // whole reply instead of two per word (keeps the UI smooth on long replies)
  async function recordExposures(pairs: { lemma: string; form: string }[]) {
    const unique = new Map<string, string>()
    for (const p of pairs) if (!unique.has(p.lemma)) unique.set(p.lemma, p.form)
    const lemmas = [...unique.keys()]
    const freq = frequencyData as Record<string, { rank: number; cefr: string }>

    await db.transaction('rw', db.words, async () => {
      const existing = await db.words.bulkGet(lemmas)
      const toSave: VocabWord[] = []
      lemmas.forEach((lemma, i) => {
        const form = unique.get(lemma)!
        let word = existing[i]
        if (!word) {
          const meta = freq[lemma]
          if (!meta || SKIP_LEVELS.has(meta.cefr)) return // not tracked / below learner level
          word = {
            lemma, forms_seen: [form], freq_rank: meta.rank, cefr: meta.cefr,
            total_exposures: 0, total_clicks: 0, since_last_click: 0, status: 'pool'
          }
        } else if (!word.forms_seen.includes(form)) {
          word.forms_seen.push(form)
        }
        word.total_exposures += 1
        word.since_last_click += 1
        if (word.since_last_click >= INACTIVITY_THRESHOLD && word.status === 'active') {
          word.status = 'inactive'
        }
        toSave.push(word)
      })
      if (toSave.length) await db.words.bulkPut(toSave)
    })
  }

  // --- level estimate -------------------------------------------------
  // For each CEFR band: of the words seen at least MIN_SEEN times, what share
  // was never clicked? That share is treated as "understood". The user's level
  // is the highest band still understood at >= 80%.
  const BANDS = ['B1', 'B2', 'C1', 'C2']
  const MIN_SEEN = 3
  const PASS = 0.8

  async function getLevelReport() {
    const all = await db.words.toArray()
    const rows = BANDS.map(band => {
      const seen = all.filter(w => w.cefr === band && w.total_exposures >= MIN_SEEN)
      const understood = seen.filter(w => w.total_clicks === 0).length
      const ratio = seen.length ? understood / seen.length : 0
      return { band, seen: seen.length, understood, ratio, enough: seen.length >= 10 }
    })
    let level = 'B1'
    for (const r of rows) if (r.enough && r.ratio >= PASS) level = r.band
    return { level, rows, minSeen: MIN_SEEN, pass: PASS }
  }

  // --- manual controls (used by the popup and the dashboard) ------------
  async function setStatus(lemma: string, status: VocabWord['status']) {
    const w = await db.words.get(lemma)
    if (!w) return
    w.status = status
    if (status === 'active') w.since_last_click = 0
    await db.words.put(w)
  }

  async function resetWord(lemma: string) {
    const w = await db.words.get(lemma)
    if (!w) return
    w.total_clicks = 0
    w.total_exposures = 0
    w.since_last_click = 0
    w.status = 'pool'
    await db.words.put(w)
  }

  // --- definition cards --------------------------------------------------
  function cardKey(lemma: string, context: string) {
    // short stable hash of the sentence, so the same sentence reuses its card
    let h = 0
    for (let i = 0; i < context.length; i++) h = (h * 31 + context.charCodeAt(i)) | 0
    return `${lemma}::${h}`
  }

  async function getCard(lemma: string, context: string) {
    return db.cards.get(cardKey(lemma, context))
  }

  async function saveCard(card: Omit<DefCard, 'key' | 'created'>) {
    const full: DefCard = { ...card, key: cardKey(card.lemma, card.context), created: Date.now() }
    await db.cards.put(full)
    return full
  }

  async function countCards() {
    return db.cards.count()
  }

  // --- audio cache -------------------------------------------------------
  async function getAudio(key: string) {
    const row = await db.audio.get(key)
    return row?.blob || null
  }

  async function saveAudio(key: string, blob: Blob) {
    await db.audio.put({ key, blob })
  }

  async function countAudio() {
    return db.audio.count()
  }

  async function getAllWords() {
    return db.words.toArray()
  }

  async function getStats() {
    const all = await db.words.toArray()
    return {
      active: all.filter(w => w.status === 'active').length,
      inactive: all.filter(w => w.status === 'inactive').length,
      pool: all.filter(w => w.status === 'pool').length,
      total: all.length
    }
  }

  // One-time demo data so every feature can be tried before an API key is
  // entered. Only runs if the local database is still empty.
  async function seedDemo() {
    const count = await db.words.count()
    if (count > 0) return

    const now = () => ({ total_exposures: 4, total_clicks: 1, since_last_click: 1 })
    const demoWords: VocabWord[] = [
      { lemma: 'resilient', forms_seen: ['resilient'], freq_rank: 1, cefr: 'B2', status: 'active', ...now() },
      { lemma: 'acknowledge', forms_seen: ['acknowledge'], freq_rank: 2, cefr: 'B1', status: 'active', ...now() },
      { lemma: 'facilitate', forms_seen: ['facilitate'], freq_rank: 3, cefr: 'B1', status: 'active', ...now() },
      { lemma: 'substantial', forms_seen: ['substantial'], freq_rank: 4, cefr: 'B1', status: 'active', ...now() },
      { lemma: 'credible', forms_seen: ['credible'], freq_rank: 5, cefr: 'B1', status: 'active', ...now() },
      { lemma: 'marine', forms_seen: ['marine'], freq_rank: 6, cefr: 'B1', status: 'pool', total_exposures: 0, total_clicks: 0, since_last_click: 0 },
      { lemma: 'momentum', forms_seen: ['momentum'], freq_rank: 7, cefr: 'B2', status: 'pool', total_exposures: 0, total_clicks: 0, since_last_click: 0 },
      { lemma: 'notion', forms_seen: ['notion'], freq_rank: 8, cefr: 'B1', status: 'inactive', total_exposures: 5, total_clicks: 0, since_last_click: 5 },
      { lemma: 'profound', forms_seen: ['profound'], freq_rank: 9, cefr: 'B1', status: 'inactive', total_exposures: 6, total_clicks: 1, since_last_click: 5 }
    ]
    await db.words.bulkPut(demoWords)
  }

  async function exportData() {    const all = await db.words.toArray()
    return JSON.stringify({ exported_at: new Date().toISOString(), words: all }, null, 2)
  }

  async function importData(json: string) {
    const parsed = JSON.parse(json)
    const incoming: VocabWord[] = parsed.words || []
    for (const w of incoming) {
      const existing = await db.words.get(w.lemma)
      if (!existing) {
        await db.words.put(w)
      } else {
        // Merge: take the max cumulative values instead of overwriting,
        // to avoid losing progress made on another device
        existing.total_exposures = Math.max(existing.total_exposures, w.total_exposures)
        existing.total_clicks = Math.max(existing.total_clicks, w.total_clicks)
        existing.since_last_click = Math.min(existing.since_last_click, w.since_last_click)
        existing.status = existing.total_clicks >= w.total_clicks ? existing.status : w.status
        await db.words.put(existing)
      }
    }
  }

  return {
    discoverWord,
    registerExposure,
    recordExposures,
    registerClick,
    getTopActiveWords,
    getAllWords,
    getStats,
    exportData,
    importData,
    seedDemo,
    getLevelReport,
    setStatus,
    resetWord,
    getCard,
    saveCard,
    countCards,
    getAudio,
    saveAudio,
    countAudio
  }
}
