export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

// Static site = no server proxy. We call Anthropic directly from the browser
// using their official "bring your own key" CORS header. The key never
// leaves the user's device except in this direct request.
const API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

export function useClaude() {
  const { apiKey } = useApiKey()

  const SYSTEM_PROMPT = `You are a friendly conversational partner for an English learner (around B1-B2 level). Answer the user's question naturally, in clear English, in plain text only: no Markdown, no asterisks, no headings, no bullet symbols. Use short paragraphs separated by a blank line.
You are given an optional list of English vocabulary words in the user's message. If one of them fits naturally in your answer, use it. Do not force any word in or change your answer just to include one.
Right after your answer, add a line "---MEANINGS---" followed by ONLY a JSON object (no extra text) mapping each word from the list that you actually used to a short one-sentence English definition of it as used in this specific context. If you used none, return {}.`

  async function callApi(messages: any[], system?: string, maxTokens = 1000) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey.value,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: system || undefined,
        messages
      })
    })
    if (!res.ok) {
      let detail = ''
      try {
        const j = await res.json()
        detail = j?.error?.message || ''
      } catch {}
      if (res.status === 401) throw new Error('Invalid API key. Use "Change key" at the top to fix it.')
      if (res.status === 429) throw new Error('Rate limit reached. Wait a moment and try again.')
      if (res.status === 529 || res.status === 503) throw new Error('Anthropic is overloaded right now. Try again in a moment.')
      throw new Error(`API error ${res.status}${detail ? ': ' + detail : ''}`)
    }
    return res.json()
  }

  function splitReply(raw: string): { text: string; meanings: Record<string, string> } {
    const marker = '---MEANINGS---'
    const idx = raw.indexOf(marker)
    if (idx === -1) return { text: raw.trim(), meanings: {} }
    const text = raw.slice(0, idx).trim()
    const jsonPart = raw.slice(idx + marker.length).trim()
    try {
      return { text, meanings: JSON.parse(jsonPart) }
    } catch {
      return { text, meanings: {} }
    }
  }

  async function ask(question: string, history: ChatTurn[], activeWords: string[]) {
    const wordsLine = activeWords.length
      ? `\n\n[Optional vocabulary list: ${activeWords.join(', ')}]`
      : ''
    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: question + wordsLine }
    ]
    const res = await callApi(messages, SYSTEM_PROMPT, 1200)
    const rawText = res.content?.find((c: any) => c.type === 'text')?.text || ''
    return splitReply(rawText)
  }

  async function askAboutSelection(chunks: string[], question: string) {
    const chunksBlock = chunks.map((c, i) => `${i + 1}. "${c}"`).join('\n')
    const prompt = `Selected passages:\n${chunksBlock}\n\nUser question: "${question}"\n\nAnswer based on these passages.`
    const res = await callApi([{ role: 'user', content: prompt }], undefined, 500)
    return res.content?.find((c: any) => c.type === 'text')?.text || ''
  }

  // Full card: contextual meaning + two examples, written for the learner's level
  async function askWordCard(word: string, context: string, level: string) {
    const prompt = `Sentence: "${context}"\nWord: "${word}"\nReader level: ${level}\n\nExplain the meaning of the word as used in this sentence, in simple English suitable for a ${level} learner, in one short sentence. Then give two short example sentences using the same meaning.\nReply with JSON only: {"definition": "...", "examples": ["...", "..."]}`
    try {
      const res = await callApi([{ role: 'user', content: prompt }], undefined, 300)
      const raw = res.content?.find((c: any) => c.type === 'text')?.text || ''
      const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
      if (start !== -1 && end > start) {
        const o = JSON.parse(raw.slice(start, end + 1))
        return { definition: String(o.definition || '').trim(), examples: Array.isArray(o.examples) ? o.examples.slice(0, 2).map(String) : [] }
      }
      return { definition: raw.trim(), examples: [] }
    } catch {
      return null
    }
  }

  async function askWordMeaning(word: string, context: string) {
    const prompt = `Give only a short one-sentence English definition of the word "${word}" as used in this context: "${context}". No preamble, just the definition.`
    const res = await callApi([{ role: 'user', content: prompt }], undefined, 100)
    return res.content?.find((c: any) => c.type === 'text')?.text?.trim() || ''
  }

  return { ask, askAboutSelection, askWordMeaning, askWordCard }
}
