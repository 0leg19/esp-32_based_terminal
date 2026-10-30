import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ar from "./locales/ar.json";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ka from "./locales/ka.json";
import zh from "./locales/zh.json";

export const LANGUAGES = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "ka", name: "ქართული", dir: "ltr" },
  { code: "fr", name: "Français", dir: "ltr" },
  { code: "de", name: "Deutsch", dir: "ltr" },
  { code: "es", name: "Español", dir: "ltr" },
  { code: "zh", name: "中文", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
] as const;

const STORAGE_KEY = "nfc-tm.lang";

function savedLanguage(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && LANGUAGES.some((l) => l.code === v)) return v;
  } catch {
    /* storage unavailable */
  }
  return "en";
}

function applyDocumentLanguage(code: string): void {
  const lang = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
  document.documentElement.lang = lang.code;
  document.documentElement.dir = lang.dir;
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ka: { translation: ka },
    fr: { translation: fr },
    de: { translation: de },
    es: { translation: es },
    zh: { translation: zh },
    ar: { translation: ar },
  },
  lng: savedLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

applyDocumentLanguage(i18n.language);
i18n.on("languageChanged", (code) => {
  applyDocumentLanguage(code);
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* storage unavailable */
  }
});

export default i18n;
