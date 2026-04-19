'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { Lang, translations, TranslationKeys } from '@/lib/i18n';

interface LangContextValue {
  lang: Lang;
  t: TranslationKeys;
  toggleLang: () => void;
}

const LangContext = createContext<LangContextValue>({
  lang: 'zh',
  t: translations.zh,
  toggleLang: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('zh');

  const toggleLang = () => setLang((prev) => (prev === 'zh' ? 'en' : 'zh'));

  return (
    <LangContext.Provider value={{ lang, t: translations[lang], toggleLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
