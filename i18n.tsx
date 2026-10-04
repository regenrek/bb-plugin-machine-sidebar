// The texts for the current `language` setting, shared through context.
// One provider per plugin entry point reads the setting once; components call
// `useStrings()`. Without a provider (tests, tooling) the texts are English.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSettings } from "@get-bb/plugin-sdk/app";
import { ENGLISH, LANGUAGE_SETTING, resolveStrings, type Strings } from "./strings";

const StringsContext = createContext<Strings>(ENGLISH);
const browserLanguage = () => typeof navigator === "undefined" ? undefined : navigator.language;

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { values } = useSettings();
  const language = values?.[LANGUAGE_SETTING];
  const [browser, setBrowser] = useState(browserLanguage);
  useEffect(() => {
    if (language !== "auto" || typeof window === "undefined") return;
    const update = () => setBrowser(browserLanguage());
    window.addEventListener("languagechange", update);
    update();
    return () => window.removeEventListener("languagechange", update);
  }, [language]);
  return (
    <StringsContext.Provider value={resolveStrings(language, browser)}>
      {children}
    </StringsContext.Provider>
  );
}

export function useStrings(): Strings {
  return useContext(StringsContext);
}
