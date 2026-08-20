import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { followHomeAssistantTheme } from "./home-assistant-theme.js";
import "./styles.css";

interface BootstrapData {
  identity: {
    displayName: string;
    id: string;
    name: string;
  };
  locale: Locale;
}

type Locale = "en" | "nb";

const translations = {
  en: {
    emptyDescription: "Items you add will appear here.",
    emptyTitle: "Your shopping list is ready",
    language: "Language",
  },
  nb: {
    emptyDescription: "Varer du legger til, vises her.",
    emptyTitle: "Handlelisten din er klar",
    language: "Språk",
  },
} satisfies Record<Locale, Record<string, string>>;

declare global {
  interface Window {
    __HANDLELISTE_BOOTSTRAP__: BootstrapData;
  }
}

function App() {
  const { identity } = window.__HANDLELISTE_BOOTSTRAP__;
  const [locale, setLocale] = useState(window.__HANDLELISTE_BOOTSTRAP__.locale);
  const text = translations[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  async function changeLocale(nextLocale: Locale) {
    const response = await fetch("api/preferences/locale", {
      body: JSON.stringify({ locale: nextLocale }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("Could not save language preference");
    }
    setLocale(nextLocale);
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <h1>Handleliste</h1>
        <div className="top-bar-actions">
          <label className="visually-hidden" htmlFor="language">{text.language}</label>
          <select
            aria-label={text.language}
            id="language"
            onChange={(event) => void changeLocale(event.target.value as Locale)}
            value={locale}
          >
            <option value="en">English</option>
            <option value="nb">Norsk</option>
          </select>
          <span className="identity">{identity.displayName}</span>
        </div>
      </header>
      <section className="empty-state" aria-labelledby="empty-title">
        <div className="cart" aria-hidden="true">🛒</div>
        <h2 id="empty-title">{text.emptyTitle}</h2>
        <p>{text.emptyDescription}</p>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Handleliste root element is missing");
}

followHomeAssistantTheme();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
