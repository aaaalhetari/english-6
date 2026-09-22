import lemmatizer from 'wink-lemmatizer'

export function useLemmatizer() {
  function tokenize(text: string): string[] {
    return (text.match(/[A-Za-z']+/g) || []).map(t => t.toLowerCase())
  }

  // يحاول الأشكال الثلاثة (اسم/فعل/صفة) ويأخذ أول جذر مختلف عن الأصل، وإلا يُعيد الكلمة كما هي
  function lemmatize(word: string): string {
    const noun = lemmatizer.noun(word)
    if (noun !== word) return noun
    const verb = lemmatizer.verb(word)
    if (verb !== word) return verb
    const adj = lemmatizer.adjective(word)
    if (adj !== word) return adj
    return word
  }

  return { tokenize, lemmatize }
}
