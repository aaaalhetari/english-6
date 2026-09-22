// All user-tunable settings, stored on this device only.
export interface LlmOption {
  id: string
  label: string
  repo: string
  task: 'text-generation' | 'text2text-generation'
  size: string
  note: string
}

// Browser-ready ONNX builds. Availability/quality is not verified by us -
// try them on your own device and keep the one that works best.
export const LLM_OPTIONS: LlmOption[] = [
  { id: 'off', label: 'Off (use Claude / dictionary)', repo: '', task: 'text-generation', size: '0 MB', note: 'No local model. Needs internet for new words.' },
  { id: 'qwen3-0.6b', label: 'Qwen3 0.6B', repo: 'onnx-community/Qwen3-0.6B-ONNX', task: 'text-generation', size: '~550 MB', note: 'Good balance. Recommended first try.' },
  { id: 'lfm25-350m', label: 'LFM2.5 350M', repo: 'onnx-community/LFM2.5-350M-ONNX', task: 'text-generation', size: '~280 MB', note: 'Fastest and smallest. Quality may be weaker.' },
  { id: 'gemma3-270m', label: 'Gemma 3 270M', repo: 'onnx-community/gemma-3-270m-it-ONNX', task: 'text-generation', size: '~300 MB', note: 'Very small. May invent meanings.' },
  { id: 'qwen3-1.7b', label: 'Qwen3 1.7B', repo: 'onnx-community/Qwen3-1.7B-ONNX', task: 'text-generation', size: '~1.4 GB', note: 'Best quality, heaviest. May fail on weak phones.' },
  { id: 'lamini-flan-248m', label: 'LaMini-Flan-T5 248M', repo: 'Xenova/LaMini-Flan-T5-248M', task: 'text2text-generation', size: '~250 MB', note: 'Seq2seq, instruction-tuned. Short answers.' }
]

const defs = {
  ttsRepeat: 1,
  ttsPrefetch: true,
  voiceId: 'af_heart',
  llmModel: 'off',
  levelOverride: 'auto',      // auto | A2 | B1 | B2 | C1 | C2
  inactivityThreshold: 5,      // exposures without a click -> dormant
  activeTarget: 50,            // words sent to Claude per reply
  highlightPool: true          // also underline pool words
}

let cache: any = null

export function useSettings() {
  if (!cache) {
    cache = {
      ttsRepeat: useLocalStorage('set_tts_repeat', defs.ttsRepeat),
      ttsPrefetch: useLocalStorage('set_tts_prefetch', defs.ttsPrefetch),
      voiceId: useLocalStorage('vocab_app_voice_id', defs.voiceId),
      llmModel: useLocalStorage('set_llm_model', defs.llmModel),
      levelOverride: useLocalStorage('set_level_override', defs.levelOverride),
      inactivityThreshold: useLocalStorage('set_inactivity', defs.inactivityThreshold),
      activeTarget: useLocalStorage('set_active_target', defs.activeTarget),
      highlightPool: useLocalStorage('set_highlight_pool', defs.highlightPool)
    }
  }
  return { ...cache, LLM_OPTIONS, defaults: defs }
}
