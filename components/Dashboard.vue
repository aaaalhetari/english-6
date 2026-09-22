<script setup lang="ts">
const emit = defineEmits(['close'])
const db = useVocabDB()
const { speak, prefetching, selectedVoice, voiceOptions, lastError: ttsError } = useTTS()
const { llmModel, LLM_OPTIONS, ttsRepeat, ttsPrefetch, levelOverride, highlightPool, inactivityThreshold, activeTarget } = useSettings()
const { preload, loading: llmLoading, progress: llmProgress, error: llmError, option: llmOption, lastMs } = useLocalLLM()

const tab = ref<'overview' | 'words' | 'settings'>('overview')
const stats = ref({ active: 0, inactive: 0, pool: 0, total: 0 })
const level = ref<any>(null)
const words = ref<any[]>([])
const cards = ref(0)
const clips = ref(0)
const filter = ref<'all' | 'active' | 'inactive' | 'pool'>('active')
const search = ref('')

const filtered = computed(() => {
  let list = words.value
  if (filter.value !== 'all') list = list.filter(w => w.status === filter.value)
  const q = search.value.trim().toLowerCase()
  if (q) list = list.filter(w => w.lemma.includes(q))
  return list.slice(0, 300)
})

const topClicked = computed(() =>
  [...words.value].filter(w => w.total_clicks > 0).sort((a, b) => b.total_clicks - a.total_clicks).slice(0, 8))

const byLevel = computed(() => {
  const counts: Record<string, number> = {}
  for (const w of words.value) if (w.status !== 'pool') counts[w.cefr] = (counts[w.cefr] || 0) + 1
  const max = Math.max(1, ...Object.values(counts))
  return ['B1', 'B2', 'C1', 'C2'].map(b => ({ band: b, n: counts[b] || 0, pct: Math.round(((counts[b] || 0) / max) * 100) }))
})

async function refresh() {
  const [s, all, lv, c, a] = await Promise.all([db.getStats(), db.getAllWords(), db.getLevelReport(), db.countCards(), db.countAudio()])
  stats.value = s
  words.value = all.sort((x, y) => x.freq_rank - y.freq_rank)
  level.value = lv
  cards.value = c
  clips.value = a
}

async function setStatus(lemma: string, status: any) { await db.setStatus(lemma, status); await refresh() }
async function reset(lemma: string) { await db.resetWord(lemma); await refresh() }

async function handleExport() {
  const json = await db.exportData()
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `vocab_backup_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
function triggerImport() {
  const el = document.createElement('input')
  el.type = 'file'; el.accept = 'application/json'
  el.onchange = async (e: any) => {
    const f = e.target.files[0]
    if (f) { await db.importData(await f.text()); await refresh() }
  }
  el.click()
}

onMounted(refresh)
</script>

<template>
  <div class="fixed inset-0 bg-slate-50 z-50 flex flex-col">
    <header class="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
      <h2 class="font-bold">Dashboard</h2>
      <button class="text-sm text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-100" @click="emit('close')">Done</button>
    </header>

    <nav class="bg-white border-b border-slate-200 flex text-sm">
      <button v-for="t in (['overview','words','settings'] as const)" :key="t"
        class="flex-1 py-2.5 capitalize border-b-2"
        :class="tab === t ? 'border-emerald-600 text-emerald-700 font-medium' : 'border-transparent text-slate-500'"
        @click="tab = t">{{ t }}</button>
    </nav>

    <div class="flex-1 overflow-y-auto">
      <div class="max-w-3xl mx-auto p-4 space-y-4">

        <!-- OVERVIEW -->
        <template v-if="tab === 'overview'">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="bg-white rounded-xl p-3 border border-slate-200">
              <p class="text-2xl font-bold text-emerald-600">{{ stats.active }}</p><p class="text-xs text-slate-500">active</p>
            </div>
            <div class="bg-white rounded-xl p-3 border border-slate-200">
              <p class="text-2xl font-bold text-slate-400">{{ stats.inactive }}</p><p class="text-xs text-slate-500">dormant</p>
            </div>
            <div class="bg-white rounded-xl p-3 border border-slate-200">
              <p class="text-2xl font-bold text-sky-500">{{ stats.pool }}</p><p class="text-xs text-slate-500">pool</p>
            </div>
            <div class="bg-white rounded-xl p-3 border border-slate-200">
              <p class="text-2xl font-bold">{{ stats.total }}</p><p class="text-xs text-slate-500">tracked</p>
            </div>
          </div>

          <div v-if="level" class="bg-white rounded-xl p-4 border border-slate-200">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-medium text-sm">Estimated level</h3>
              <span class="text-lg font-bold text-emerald-600">{{ level.level }}</span>
            </div>
            <p class="text-[11px] text-slate-400 mb-3">
              Of the words seen at least {{ level.minSeen }} times in a band, the share you never needed to tap.
              A band counts as passed at {{ Math.round(level.pass * 100) }}% (and at least 10 words seen).
            </p>
            <div v-for="r in level.rows" :key="r.band" class="mb-2">
              <div class="flex justify-between text-xs mb-1">
                <span :class="r.enough && r.ratio >= level.pass ? 'text-emerald-700 font-medium' : 'text-slate-500'">{{ r.band }}</span>
                <span class="text-slate-400">{{ r.understood }}/{{ r.seen }} <template v-if="!r.enough">(needs 10+)</template></span>
              </div>
              <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full rounded-full" :class="r.ratio >= level.pass ? 'bg-emerald-500' : 'bg-slate-300'"
                     :style="{ width: Math.round(r.ratio * 100) + '%' }"></div>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200">
            <h3 class="font-medium text-sm mb-3">Words you meet, by level</h3>
            <div v-for="b in byLevel" :key="b.band" class="flex items-center gap-2 mb-1.5">
              <span class="text-xs w-6 text-slate-500">{{ b.band }}</span>
              <div class="flex-1 h-3 bg-slate-100 rounded"><div class="h-full bg-sky-400 rounded" :style="{ width: b.pct + '%' }"></div></div>
              <span class="text-xs w-8 text-right text-slate-400">{{ b.n }}</span>
            </div>
          </div>

          <div v-if="topClicked.length" class="bg-white rounded-xl p-4 border border-slate-200">
            <h3 class="font-medium text-sm mb-2">Hardest words (most taps)</h3>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="w in topClicked" :key="w.lemma" class="text-xs bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                {{ w.lemma }} <span class="text-amber-600">×{{ w.total_clicks }}</span>
              </span>
            </div>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 text-xs text-slate-500 space-y-1">
            <p>Saved definition cards: <strong>{{ cards }}</strong> (work offline)</p>
            <p>Cached audio clips: <strong>{{ clips }}</strong><span v-if="prefetching"> · preparing {{ prefetching }} more</span></p>
            <p v-if="ttsError" class="text-amber-600">Voice: {{ ttsError }}</p>
          </div>
        </template>

        <!-- WORDS -->
        <template v-else-if="tab === 'words'">
          <div class="flex gap-2">
            <input v-model="search" placeholder="Search a word…" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <select v-model="filter" class="border border-slate-300 rounded-lg px-2 text-sm">
              <option value="active">active</option><option value="inactive">dormant</option>
              <option value="pool">pool</option><option value="all">all</option>
            </select>
          </div>
          <p class="text-xs text-slate-400">{{ filtered.length }} shown</p>
          <div class="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            <div v-for="w in filtered" :key="w.lemma" class="p-3 flex items-center gap-3">
              <button class="text-slate-400" @click="speak(w.lemma)">🔊</button>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ w.lemma }}</p>
                <p class="text-[11px] text-slate-400">{{ w.cefr }} · seen {{ w.total_exposures }} · taps {{ w.total_clicks }} · {{ w.since_last_click }} since tap</p>
              </div>
              <select :value="w.status" class="text-xs border border-slate-200 rounded px-1.5 py-1"
                      @change="setStatus(w.lemma, ($event.target as HTMLSelectElement).value)">
                <option value="active">active</option><option value="inactive">dormant</option><option value="pool">pool</option>
              </select>
              <button class="text-[11px] text-slate-400 underline" @click="reset(w.lemma)">reset</button>
            </div>
            <p v-if="!filtered.length" class="p-6 text-center text-sm text-slate-400">Nothing here yet.</p>
          </div>
        </template>

        <!-- SETTINGS -->
        <template v-else>
          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
            <h3 class="font-medium text-sm">Voice</h3>
            <label class="block text-xs text-slate-500">Voice
              <select v-model="selectedVoice" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
                <option v-for="v in voiceOptions" :key="v.id" :value="v.id">{{ v.label }}</option>
              </select>
            </label>
            <label class="block text-xs text-slate-500">Repeat each word {{ ttsRepeat }}×
              <input v-model.number="ttsRepeat" type="range" min="1" max="5" class="w-full mt-1" />
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="ttsPrefetch" type="checkbox" /> Prepare audio in advance (instant playback)
            </label>
            <button class="text-xs bg-slate-100 rounded-lg px-3 py-1.5" @click="speak('resilient')">Test the voice</button>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-3">
            <h3 class="font-medium text-sm">On-device model (for offline definitions)</h3>
            <select v-model="llmModel" class="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
              <option v-for="o in LLM_OPTIONS" :key="o.id" :value="o.id">{{ o.label }} — {{ o.size }}</option>
            </select>
            <p class="text-xs text-slate-500">{{ llmOption.note }}</p>
            <div class="flex items-center gap-2">
              <button class="text-xs bg-slate-100 rounded-lg px-3 py-1.5" :disabled="llmModel === 'off'" @click="preload">Download / load now</button>
              <span v-if="llmLoading" class="text-xs text-slate-400">{{ llmProgress }}%</span>
              <span v-else-if="lastMs" class="text-xs text-slate-400">last answer {{ lastMs }} ms</span>
            </div>
            <p v-if="llmError" class="text-xs text-amber-600">{{ llmError }}</p>
            <p class="text-[11px] text-slate-400">
              These models are downloaded from Hugging Face on first use and then work offline.
              Quality and speed vary by device — try one, and switch if it disappoints.
            </p>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
            <h3 class="font-medium text-sm">Learning</h3>
            <label class="block text-xs text-slate-500">Level used for explanations
              <select v-model="levelOverride" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
                <option value="auto">Automatic (from your taps)</option>
                <option v-for="l in ['A2','B1','B2','C1','C2']" :key="l" :value="l">{{ l }}</option>
              </select>
            </label>
            <label class="block text-xs text-slate-500">Goes dormant after {{ inactivityThreshold }} views without a tap
              <input v-model.number="inactivityThreshold" type="range" min="3" max="12" class="w-full mt-1" />
            </label>
            <label class="block text-xs text-slate-500">Words offered to the AI per reply: {{ activeTarget }}
              <input v-model.number="activeTarget" type="range" min="10" max="100" step="5" class="w-full mt-1" />
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="highlightPool" type="checkbox" /> Also mark candidate (pool) words
            </label>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-2">
            <h3 class="font-medium text-sm">Data</h3>
            <div class="flex gap-2">
              <button class="flex-1 text-xs bg-slate-100 rounded-lg px-3 py-2" @click="handleExport">⬇ Export</button>
              <button class="flex-1 text-xs bg-slate-100 rounded-lg px-3 py-2" @click="triggerImport">⬆ Import</button>
            </div>
            <p class="text-[11px] text-slate-400">Everything is stored in this browser only. Export to move it to another device.</p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
