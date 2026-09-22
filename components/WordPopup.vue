<script setup lang="ts">
import dictionaryData from '~/data/dictionary.json'

const props = defineProps<{
  word: string
  contextMeanings: Record<string, string>
  contextSentence: string
}>()
const emit = defineEmits(['close'])

const { registerClick, getCard, saveCard, setStatus, getAllWords } = useVocabDB()
const { askWordCard } = useClaude()
const { define: defineLocal, enabled: localEnabled, option: localOption, loading: localLoading, progress: localProgress, lastMs } = useLocalLLM()
const { speak, downloading, downloadProgress } = useTTS()
const { apiKey } = useApiKey()
const { levelOverride, ttsRepeat } = useSettings()
const { getLevelReport } = useVocabDB()

const definition = ref('')
const examples = ref<string[]>([])
const source = ref('')
const loading = ref(false)
const note = ref('')
const info = ref<any>(null)

const dict = dictionaryData as Record<string, string>

async function currentLevel() {
  if (levelOverride.value !== 'auto') return levelOverride.value
  const r = await getLevelReport()
  return r.level
}

async function resolve() {
  registerClick(props.word)
  const all = await getAllWords()
  info.value = all.find(w => w.lemma === props.word) || null

  // 1. a card generated earlier for this exact sentence
  const saved = await getCard(props.word, props.contextSentence)
  if (saved) {
    definition.value = saved.definition
    examples.value = saved.examples
    source.value = saved.source === 'claude' ? 'Claude (saved)' : saved.source === 'local' ? 'on-device (saved)' : 'dictionary'
    return
  }

  // 2. meaning Claude already gave inside the reply itself (free, instant)
  if (props.contextMeanings[props.word]) {
    definition.value = props.contextMeanings[props.word]
    source.value = 'this reply'
    return
  }

  const level = await currentLevel()
  loading.value = true

  // 3. on-device model, if the user turned one on
  if (localEnabled.value) {
    const res = await defineLocal(props.word, props.contextSentence, level)
    if (res?.definition) {
      definition.value = res.definition
      examples.value = res.examples
      source.value = `${localOption.value.label} · ${lastMs.value} ms`
      loading.value = false
      await saveCard({ lemma: props.word, context: props.contextSentence, definition: res.definition, examples: res.examples, source: 'local', level })
      return
    }
    note.value = 'The on-device model did not answer; used the next source.'
  }

  // 4. Claude
  if (apiKey.value) {
    const res = await askWordCard(props.word, props.contextSentence, level)
    if (res?.definition) {
      definition.value = res.definition
      examples.value = res.examples
      source.value = 'Claude'
      loading.value = false
      await saveCard({ lemma: props.word, context: props.contextSentence, definition: res.definition, examples: res.examples, source: 'claude', level })
      return
    }
  }

  // 5. offline dictionary
  definition.value = dict[props.word] || 'No definition available offline for this word.'
  source.value = 'dictionary'
  loading.value = false
}

async function markKnown() {
  await setStatus(props.word, 'inactive')
  emit('close')
}
async function keepStudying() {
  await setStatus(props.word, 'active')
  emit('close')
}

onMounted(resolve)
</script>

<template>
  <div class="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-50" @click.self="emit('close')">
    <div class="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-md shadow-xl max-h-[85vh] overflow-y-auto">
      <div class="flex items-start justify-between mb-1">
        <div>
          <h3 class="font-bold text-xl">{{ word }}</h3>
          <p v-if="info" class="text-[11px] text-slate-400">
            {{ info.cefr }} · rank {{ info.freq_rank }} · seen {{ info.total_exposures }} · clicked {{ info.total_clicks }}
          </p>
        </div>
        <button class="text-slate-500 text-sm border border-slate-200 rounded-lg px-3 py-1.5" @click="speak(word)">
          {{ downloading ? `${downloadProgress}%` : `🔊${ttsRepeat > 1 ? ' ×' + ttsRepeat : ''}` }}
        </button>
      </div>

      <p v-if="localLoading" class="text-xs text-slate-400 my-2">Loading the on-device model… {{ localProgress }}%</p>
      <p v-else-if="loading" class="text-sm text-slate-400 my-3">Working on it…</p>

      <template v-if="!loading">
        <p class="text-[15px] text-slate-800 leading-relaxed mt-3">{{ definition }}</p>

        <ul v-if="examples.length" class="mt-3 space-y-1.5">
          <li v-for="(ex, i) in examples" :key="i" class="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{{ ex }}</li>
        </ul>

        <p v-if="note" class="text-[11px] text-amber-600 mt-2">{{ note }}</p>
        <p class="text-[11px] text-slate-400 mt-2">Source: {{ source }}</p>
      </template>

      <div class="flex gap-2 mt-5">
        <button class="flex-1 bg-slate-100 rounded-lg py-2 text-sm" @click="markKnown">I know this now</button>
        <button class="flex-1 bg-emerald-600 text-white rounded-lg py-2 text-sm" @click="keepStudying">Keep studying</button>
      </div>
      <button class="mt-2 w-full text-slate-400 text-sm py-1" @click="emit('close')">Close</button>
    </div>
  </div>
</template>
