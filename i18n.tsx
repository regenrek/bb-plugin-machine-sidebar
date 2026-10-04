// The texts for the current `language` setting, shared through context.
// One provider per plugin entry point reads the setting once; components call
// `useStrings()`. Without a provider (tests, tooling) the texts are English.
import { createContext, useContext, type ReactNode } from "react";
import { useSettings } from "@get-bb/plugin-sdk/app";
import { ENGLISH, LANGUAGE_SETTING, resolveStrings, type Strings } from "./strings";

const StringsContext = createContext<Strings>(ENGLISH);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { values } = useSettings();
  const browser = typeof navigator === "undefined" ? undefined : navigator.language;
  return (
    <StringsContext.Provider value={resolveStrings(values?.[LANGUAGE_SETTING], browser)}>
      {children}
    </StringsContext.Provider>
  );
}

export function useStrings(): Strings {
  return useContext(StringsContext);
}
