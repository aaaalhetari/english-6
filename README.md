# Vocab Reader — Nuxt 3

An interactive reading app: the AI generates natural answers while weaving in
target vocabulary words, and a local tracking system (active / dormant / pool)
prioritizes words that still need review.

Fully static — no backend server. The app calls the Anthropic API directly
from the browser using Anthropic's official "bring your own key" CORS header,
so it deploys as a plain static site (GitHub Pages, Netlify, anywhere).

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The first screen asks for your **Anthropic API
key** (stored only in `localStorage` on your device, sent directly to
Anthropic per request, never stored on any server).

## Deploy to GitHub Pages (automatic)

1. Push this project to a new GitHub repository.
2. In the repo: **Settings → Pages → Source → GitHub Actions**.
3. Push to `main` (or run the workflow manually from the Actions tab).

`.github/workflows/deploy.yml` is already included — it builds the static
site with `nuxt generate` and publishes it to GitHub Pages automatically on
every push to `main`. Your site will be live at:

```
https://<your-username>.github.io/<repo-name>/
```

No extra setup needed — the workflow sets the correct base path
automatically from your repository name.

## Libraries used and why

| Library | Why |
|---|---|
| **Nuxt 3** (`ssr: false`) | Static-site output, works on GitHub Pages with no server |
| **Pinia + @vueuse/nuxt** | Ready-made composables (`useLocalStorage`, etc.) |
| **Dexie** | IndexedDB wrapper — handles far more data than localStorage, and supports sorting/filtering directly (needed for the "top 50 active words" query) |
| **wink-lemmatizer** | Reduces words to their root locally (no API) — unifies leverage/leveraging, etc. |
| **kokoro-js** (Kokoro-82M) | Neural voice running fully in-browser via Transformers.js/WebGPU (WASM fallback) — free, no API, studio-grade quality (graded A/A- on the model's own benchmark for the voices offered). A small curated picker (5 top-graded English voices, American + British) is built in; switching voices does not re-download the base model. First playback downloads the base model once (~86-138MB in q8); native Web Speech API is the instant fallback if that fails |
| **Tailwind CSS** | Fast, clean styling |

## How reading works

- **One tap** on a marked word speaks it immediately. Clips are generated ahead
  of time in the background and cached, so playback is instant; repeat count is
  set in Settings.
- **Two taps** open the word card: contextual meaning + examples. Nothing is
  computed until you ask for it.
- Three visual tiers: **active** words (target vocabulary) get a filled green
  chip, **pool** candidates get a faint dotted underline, dormant words get no
  marking at all.
- Card sources, in order: a card saved earlier for that sentence → the meaning
  Claude already included in its reply → the on-device model (if enabled in
  Settings) → Claude → the offline WordNet dictionary. Every generated card is
  stored, so it opens instantly and offline next time.

## Dashboard

Three tabs: **Overview** (counts, estimated CEFR level with the evidence behind
it, words met per level, hardest words, cache sizes), **Words** (search, filter,
change any word's status, reset its counters), **Settings** (voice, repeat
count, audio prefetch, on-device model picker, level override, dormancy
threshold, words offered per reply, export/import).

## On-device model (optional, off by default)

Settings → On-device model lets you pick a small model that generates
contextual definitions offline. The options are downloaded from Hugging Face on
first use and cached by the browser. **These are untested on real devices** —
quality and speed vary a lot, and a model may fail to load on a weak phone. The
app falls back to Claude and then to the offline dictionary whenever the local
model is off, fails, or returns nothing.

## Honest notes on this version's scope

- **`data/frequency.json`** (9,000 words) and **`data/dictionary.json`**
  (an English definition for every one of them) are generated, not
  hand-typed: frequency order comes from
  [wordfreq-en-25000](https://github.com/aparrish/wordfreq-en-25000); each
  word is reduced with the app's own lemmatizer, then kept only if
  [WordNet](https://wordnet.princeton.edu/) lists it as a lowercase common
  word, which removes people, places and most brand names. Profanity,
  internet slang and a short manual list of name-like words are also
  removed. Definitions are WordNet's most frequent sense. CEFR levels are an
  approximation from frequency rank, not a linguist-reviewed
  classification. A1/A2 words are never tracked (already known at B1-B2).
- **Local data upgrades itself**: when the vocabulary list changes, the
  browser database is migrated on first load — untracked/below-level words
  are removed and your click/exposure progress on the rest is kept.
- **Voice runs in a Web Worker** so generating speech never freezes the page.
- **Try before you connect a key**: the setup screen offers "Try a demo
  first" — it seeds sample vocabulary data and a sample AI reply so you can
  test clicking words, the neural voice, and multi-passage selection with
  zero API calls, then lets you paste your key right there to switch into
  the real app.
- **Scanning engine** matches by lemma (root form) only — it doesn't
  disambiguate between two meanings of the same spelling (e.g. "bank" as a
  financial institution vs. a riverbank).
- **Cross-device sync**: manual Export/Import (JSON) buttons only. Drop the
  exported file in a synced Google Drive folder to move data between devices
  — there's no automatic upload/download in this version.
- **API key security**: calling Anthropic directly from the browser means the
  key is visible to anyone with access to the browser's dev tools on that
  device. Fine for a personal, bring-your-own-key tool like this; not
  suitable for a public multi-user product without a server-side key.

## Project structure

```
composables/
  useApiKey.ts       ← stores the key locally
  useVocabDB.ts        ← Dexie database + ranking/status logic
  useLemmatizer.ts     ← tokenizing and lemmatizing text
  useClaude.ts          ← builds prompts, calls Anthropic directly
  useTTS.ts             ← neural + fallback voice
components/
  ApiKeySetup.vue
  DemoPanel.vue          ← try every feature with sample data, no key needed
  ReaderPanel.vue         ← main interface (used once a key is set)
  ClickableText.vue       ← clickable text + multi-selection tool
  WordPopup.vue           ← three-layer meaning popup + voice picker
data/
  frequency.json        ← frequency ranks (starter set, expand it)
  dictionary.json        ← fallback local dictionary (starter set, expand it)
.github/workflows/
  deploy.yml            ← builds and deploys to GitHub Pages on push
```
