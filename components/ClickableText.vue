<script setup lang="ts">
const props = defineProps<{
  text: string
  contextMeanings: Record<string, string>
  knownStatus: Map<string, string>
}>()
const emit = defineEmits<{
  (e: 'add-chunk', text: string): void
  (e: 'word-closed'): void
}>()

const { lemmatize } = useLemmatizer()
const { speak, stop } = useTTS()
const { highlightPool } = useSettings()

interface Segment { raw: string; isWord: boolean; lemma?: string }
const root = ref<HTMLElement | null>(null)
const popupWord = ref<string | null>(null)
const popupSentence = ref('')

// Segments depend only on the text, so compute them once (no DB access here)
const segments = computed<Segment[]>(() =>
  props.text.split(/([A-Za-z']+)/g).map(part =>
    /^[A-Za-z']+$/.test(part)
      ? { raw: part, isWord: true, lemma: lemmatize(part.toLowerCase()) }
      : { raw: part, isWord: false }
  )
)

function classFor(seg: Segment) {
  if (!seg.isWord || !seg.lemma) return ''
  const status = props.knownStatus.get(seg.lemma)
  if (status === 'active') return 'word-active'          // target words: strongest
  if (status === 'pool' && highlightPool.value) return 'word-pool'  // candidates: subtle
  return ''                                               // dormant: no marking
}

// Sentence around the clicked word, used as context if the AI fallback is needed
function sentenceAround(index: number) {
  const offset = segments.value.slice(0, index).reduce((n, s) => n + s.raw.length, 0)
  const full = props.text
  const prev = Math.max(full.lastIndexOf('.', offset), full.lastIndexOf('!', offset), full.lastIndexOf('?', offset), full.lastIndexOf('\n', offset))
  const nextCandidates = ['.', '!', '?', '\n'].map(c => full.indexOf(c, offset)).filter(i => i >= 0)
  const next = nextCandidates.length ? Math.min(...nextCandidates) + 1 : full.length
  return full.slice(prev + 1, next).trim()
}

// One tap speaks the word immediately (no waiting), two taps open the card.
let tapTimer: any = null
let tapCount = 0

function onWordClick(seg: Segment, index: number) {
  if (!seg.lemma || !props.knownStatus.has(seg.lemma)) return
  const sel = window.getSelection()
  if (sel && sel.toString().trim().length > 0) return   // this was a text selection

  tapCount++
  if (tapCount === 1) {
    speak(seg.raw.toLowerCase())                        // instant, from cache
    tapTimer = setTimeout(() => { tapCount = 0 }, 280)
  } else {
    clearTimeout(tapTimer)
    tapCount = 0
    stop()                                              // second tap: silence, show card
    popupSentence.value = sentenceAround(index)
    popupWord.value = seg.lemma
  }
}

// ---- Selection → "Add to selection" button (scoped to THIS message only) ----
const showAdd = ref(false)
const addPos = ref({ top: 0, left: 0 })
let pendingText = ''

function onSelectionChange() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() || ''
  if (!sel || !text || sel.rangeCount === 0 || !root.value) {
    showAdd.value = false
    return
  }
  const range = sel.getRangeAt(0)
  if (!root.value.contains(range.commonAncestorContainer)) {
    showAdd.value = false
    return
  }
  const rect = range.getBoundingClientRect()
  pendingText = text
  addPos.value = { top: Math.max(8, rect.top - 44), left: Math.max(8, rect.left) }
  showAdd.value = true
}

function addChunk() {
  if (pendingText) emit('add-chunk', pendingText)
  window.getSelection()?.removeAllRanges()
  showAdd.value = false
  pendingText = ''
}

function closePopup() {
  popupWord.value = null
  emit('word-closed')
}

onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
onUnmounted(() => document.removeEventListener('selectionchange', onSelectionChange))
</script>

<template>
  <div ref="root" class="leading-7 text-[15px] whitespace-pre-wrap select-text">
    <span
      v-for="(seg, i) in segments"
      :key="i"
      :class="classFor(seg)"
      @click="onWordClick(seg, i)"
    >{{ seg.raw }}</span>

    <Teleport to="body">
      <button
        v-if="showAdd"
        class="fixed z-40 bg-amber-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg"
        :style="{ top: addPos.top + 'px', left: addPos.left + 'px' }"
        @mousedown.prevent
        @touchstart.prevent="addChunk"
        @click="addChunk"
      >
        + Add to selection
      </button>

      <WordPopup
        v-if="popupWord"
        :word="popupWord"
        :context-meanings="contextMeanings"
        :context-sentence="popupSentence"
        @close="closePopup"
      />
    </Teleport>
  </div>
</template>
