<script setup lang="ts">
import type { ChatTurn } from '~/composables/useClaude'

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  meanings?: Record<string, string>
  chunks?: string[]      // set on "ask about selection" questions
  side?: boolean         // selection Q&A: shown in chat, not sent as chat history
  error?: boolean
}

const { ask, askAboutSelection } = useClaude()
const { tokenize, lemmatize } = useLemmatizer()
const { recordExposures, getTopActiveWords, getStats, getAllWords, exportData, importData } = useVocabDB()
const { clearKey } = useApiKey()
const { prefetch } = useTTS()
const { preload: preloadLlm } = useLocalLLM()
const showDashboard = ref(false)

const messages = ref<Message[]>([])
const input = ref('')
const loading = ref(false)
const stats = ref({ active: 0, inactive: 0, pool: 0, total: 0 })
const knownStatus = ref(new Map<string, string>())
const chunks = ref<string[]>([])
const scroller = ref<HTMLElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)
const menuOpen = ref(false)
let nextId = 1
let lastFailed: (() => Promise<void>) | null = null

const suggestions = [
  'Tell me a short story about a lighthouse keeper.',
  'How do coral reefs recover after damage?',
  'Explain how airplanes stay in the air.',
  'What habits help people learn faster?'
]

async function refreshWordState() {
  const [s, all] = await Promise.all([getStats(), getAllWords()])
  stats.value = s
  knownStatus.value = new Map(all.map(w => [w.lemma, w.status]))
  // generate audio for the words most likely to be tapped next
  prefetch(all.filter(w => w.status === 'active').sort((a, b) => a.freq_rank - b.freq_rank).slice(0, 40).map(w => w.lemma))
}

function scrollToBottom() {
  nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  })
}

function autoGrow() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}

// Local scanning engine: reads the real reply text (no AI call), one DB batch
async function scanReply(text: string) {
  const pairs = tokenize(text).map(t => ({ lemma: lemmatize(t), form: t }))
  await recordExposures(pairs)
}

function history(): ChatTurn[] {
  return messages.value
    .filter(m => !m.side && !m.error)
    .map(m => ({ role: m.role, content: m.content }))
}

function pushError(err: any, retry: () => Promise<void>) {
  const msg = err instanceof TypeError
    ? 'Network error: check your internet connection and try again.'
    : (err?.message || 'Something went wrong.')
  messages.value.push({ id: nextId++, role: 'assistant', content: msg, error: true })
  lastFailed = retry
}

async function sendText(text: string) {
  const q = text.trim()
  if (!q || loading.value) return
  const priorHistory = history()
  messages.value.push({ id: nextId++, role: 'user', content: q })
  scrollToBottom()

  const run = async () => {
    loading.value = true
    scrollToBottom()
    try {
      const activeWords = (await getTopActiveWords()).map(w => w.lemma)
      const { text: reply, meanings } = await ask(q, priorHistory, activeWords)
      messages.value.push({ id: nextId++, role: 'assistant', content: reply, meanings })
      lastFailed = null
      loading.value = false
      scrollToBottom()
      // vocabulary bookkeeping happens after the reply is already visible
      await scanReply(reply)
      await refreshWordState()
    } catch (e) {
      pushError(e, run)
    } finally {
      loading.value = false
      scrollToBottom()
    }
  }
  await run()
}

async function send() {
  if (chunks.value.length) return askSelection()
  const text = input.value
  input.value = ''
  nextTick(autoGrow)
  await sendText(text)
}

async function askSelection() {
  const q = input.value.trim()
  if (!q || loading.value || !chunks.value.length) return
  const selected = [...chunks.value]
  input.value = ''
  chunks.value = []
  nextTick(autoGrow)
  messages.value.push({ id: nextId++, role: 'user', content: q, chunks: selected, side: true })
  scrollToBottom()

  const run = async () => {
    loading.value = true
    scrollToBottom()
    try {
      const answer = await askAboutSelection(selected, q)
      messages.value.push({ id: nextId++, role: 'assistant', content: answer, side: true })
      lastFailed = null
      loading.value = false
      scrollToBottom()
      await scanReply(answer)
      await refreshWordState()
    } catch (e) {
      pushError(e, run)
    } finally {
      loading.value = false
      scrollToBottom()
    }
  }
  await run()
}

async function retry() {
  if (!lastFailed || loading.value) return
  const fn = lastFailed
  // remove the error bubble before retrying
  const last = messages.value[messages.value.length - 1]
  if (last?.error) messages.value.pop()
  await fn()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

function addChunk(text: string) {
  chunks.value.push(text)
  nextTick(() => textarea.value?.focus())
}

function newChat() {
  if (loading.value) return
  messages.value = []
  chunks.value = []
  lastFailed = null
  menuOpen.value = false
}

function changeKey() {
  menuOpen.value = false
  clearKey()
}

async function handleExport() {
  menuOpen.value = false
  const json = await exportData()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `vocab_backup_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function triggerImport() {
  menuOpen.value = false
  const el = document.createElement('input')
  el.type = 'file'
  el.accept = 'application/json'
  el.onchange = async (e: any) => {
    const file = e.target.files[0]
    if (!file) return
    await importData(await file.text())
    await refreshWordState()
  }
  el.click()
}

onMounted(() => { refreshWordState(); preloadLlm() })
</script>

<template>
  <div class="flex flex-col h-[100dvh] bg-slate-50">
    <!-- Header -->
    <header class="bg-white border-b border-slate-200">
      <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-bold leading-tight">Vocab Reader</h1>
          <div class="text-[11px] text-slate-500 flex gap-3">
            <span><span class="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1"></span>active {{ stats.active }}</span>
            <span><span class="inline-block w-2 h-2 rounded-full bg-slate-300 mr-1"></span>dormant {{ stats.inactive }}</span>
            <span><span class="inline-block w-2 h-2 rounded-full bg-sky-400 mr-1"></span>pool {{ stats.pool }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 relative">
          <button class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40" :disabled="loading" @click="newChat">＋ New chat</button>
              <button class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50" @click="showDashboard = true">Dashboard</button>
          <button class="text-lg leading-none px-2 py-1 rounded-lg hover:bg-slate-100" aria-label="Menu" @click="menuOpen = !menuOpen">⋯</button>
          <div v-if="menuOpen" class="absolute right-0 top-10 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-48 text-sm">
            <button class="w-full text-left px-4 py-2 hover:bg-slate-50" @click="handleExport">⬇ Export vocab data</button>
            <button class="w-full text-left px-4 py-2 hover:bg-slate-50" @click="triggerImport">⬆ Import vocab data</button>
            <button class="w-full text-left px-4 py-2 hover:bg-slate-50 text-rose-600" @click="changeKey">🔑 Change API key</button>
          </div>
        </div>
      </div>
    </header>

    <!-- Messages -->
    <main ref="scroller" class="flex-1 overflow-y-auto" @click="menuOpen = false">
      <div class="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div v-if="!messages.length" class="text-center pt-10">
          <p class="text-slate-500 text-sm mb-1">Ask about anything — a story, a topic, an idea.</p>
          <p class="text-slate-400 text-xs mb-6">Underlined words are tracked vocabulary. Tap one to see its meaning.</p>
          <div class="grid sm:grid-cols-2 gap-2 max-w-xl mx-auto">
            <button
              v-for="s in suggestions" :key="s"
              class="text-left text-sm bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-emerald-400 hover:bg-emerald-50 transition"
              @click="sendText(s)"
            >{{ s }}</button>
          </div>
        </div>

        <template v-for="m in messages" :key="m.id">
          <!-- user -->
          <div v-if="m.role === 'user'" class="flex justify-end">
            <div class="max-w-[85%] bg-emerald-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] whitespace-pre-wrap">
              <div v-if="m.chunks" class="mb-2 space-y-1">
                <div v-for="(c, i) in m.chunks" :key="i" class="text-xs bg-emerald-700/60 rounded-lg px-2 py-1 italic">“{{ c }}”</div>
              </div>
              {{ m.content }}
            </div>
          </div>

          <!-- assistant error -->
          <div v-else-if="m.error" class="flex justify-start">
            <div class="max-w-[85%] bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl rounded-bl-md px-4 py-3 text-sm">
              <p>{{ m.content }}</p>
              <button class="mt-2 text-xs font-medium underline disabled:opacity-40" :disabled="loading" @click="retry">Try again</button>
            </div>
          </div>

          <!-- assistant -->
          <div v-else class="flex justify-start gap-2">
            <div class="w-7 h-7 shrink-0 rounded-full bg-slate-800 text-white text-xs flex items-center justify-center mt-0.5">AI</div>
            <div class="max-w-[85%] bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
              <ClickableText
                :text="m.content"
                :context-meanings="m.meanings || {}"
                :known-status="knownStatus"
                @add-chunk="addChunk"
                @word-closed="refreshWordState"
              />
            </div>
          </div>
        </template>

        <!-- typing indicator -->
        <div v-if="loading" class="flex justify-start gap-2">
          <div class="w-7 h-7 shrink-0 rounded-full bg-slate-800 text-white text-xs flex items-center justify-center">AI</div>
          <div class="bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm flex items-center gap-1.5">
            <span class="dot"></span><span class="dot" style="animation-delay:.15s"></span><span class="dot" style="animation-delay:.3s"></span>
            <span class="text-xs text-slate-400 ml-2">thinking…</span>
          </div>
        </div>
      </div>
    </main>

    <!-- Composer -->
    <footer class="bg-white border-t border-slate-200">
      <div class="max-w-3xl mx-auto px-4 py-3">
        <div v-if="chunks.length" class="mb-2 bg-amber-50 border border-amber-200 rounded-xl p-2">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-amber-800 font-medium">Asking about {{ chunks.length }} selected passage{{ chunks.length > 1 ? 's' : '' }}</span>
            <button class="text-xs text-amber-700 underline" @click="chunks = []">Clear</button>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span v-for="(c, i) in chunks" :key="i" class="selection-marked text-xs px-2 py-1 flex items-center gap-1">
              “{{ c.length > 40 ? c.slice(0, 40) + '…' : c }}”
              <button class="text-amber-800 font-bold" @click="chunks.splice(i, 1)">×</button>
            </span>
          </div>
        </div>

        <div class="flex items-end gap-2">
          <textarea
            ref="textarea"
            v-model="input"
            rows="1"
            class="flex-1 resize-none border border-slate-300 rounded-2xl px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50"
            :placeholder="chunks.length ? 'Ask about the selected passages…' : 'Message… (Enter to send, Shift+Enter for a new line)'"
            :disabled="loading"
            @input="autoGrow"
            @keydown="onKeydown"
          ></textarea>
          <button
            class="h-12 px-5 rounded-2xl text-white text-sm font-medium disabled:opacity-40"
            :class="chunks.length ? 'bg-amber-500' : 'bg-emerald-600'"
            :disabled="loading || !input.trim()"
            @click="send"
          >{{ loading ? '…' : (chunks.length ? 'Ask' : 'Send') }}</button>
        </div>
      </div>
    </footer>
    <ClientOnly>
      <Dashboard v-if="showDashboard" @close="showDashboard = false; refreshWordState()" />
    </ClientOnly>
  </div>
</template>

<style scoped>
.dot {
  width: 7px; height: 7px; border-radius: 9999px; background: #94a3b8;
  display: inline-block; animation: bounce 1s infinite ease-in-out;
}
@keyframes bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: .5 }
  40% { transform: translateY(-5px); opacity: 1 }
}
</style>
