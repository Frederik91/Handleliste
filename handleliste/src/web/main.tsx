import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PackageUnit, ShoppingListSnapshot } from "../shared/shopping-list.js";
import { followHomeAssistantTheme } from "./home-assistant-theme.js";
import "./styles.css";

interface BootstrapData {
  identity: {
    displayName: string;
    id: string;
    name: string;
  };
  locale: Locale;
  shoppingList: ShoppingListSnapshot;
}

type Locale = "en" | "nb";

const translations = {
  en: {
    add: "Add",
    addItem: "Add item",
    addItemFailed: "Could not add the item. Try again.",
    emptyDescription: "Items you add will appear here.",
    emptyTitle: "Your shopping list is ready",
    language: "Language",
    unit: "unit",
  },
  nb: {
    add: "Legg til",
    addItem: "Legg til vare",
    addItemFailed: "Kunne ikke legge til varen. Prøv igjen.",
    emptyDescription: "Varer du legger til, vises her.",
    emptyTitle: "Handlelisten din er klar",
    language: "Språk",
    unit: "enhet",
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
  const [shoppingList, setShoppingList] = useState(window.__HANDLELISTE_BOOTSTRAP__.shoppingList);
  const [entry, setEntry] = useState("");
  const entryRevision = useRef(0);
  const [addError, setAddError] = useState(false);
  const text = translations[locale];
  const applyShoppingListSnapshot = useCallback((updated: ShoppingListSnapshot) => {
    setShoppingList((current) => updated.revision >= current.revision ? updated : current);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    let active = true;
    const refreshShoppingList = async () => {
      try {
        const response = await fetch("api/shopping-list");
        if (!response.ok || !active) {
          return;
        }
        const updated = await response.json() as ShoppingListSnapshot;
        if (active) {
          applyShoppingListSnapshot(updated);
        }
      } catch {
        // EventSource reconnects automatically; the next ready event refreshes the list.
      }
    };
    const events = new EventSource("api/shopping-list/events");
    events.addEventListener("ready", () => void refreshShoppingList());
    events.addEventListener("changed", () => void refreshShoppingList());

    return () => {
      active = false;
      events.close();
    };
  }, [applyShoppingListSnapshot]);

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

  async function addItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entry.trim()) {
      return;
    }
    const submittedEntry = entry;
    const submittedEntryRevision = entryRevision.current;
    setAddError(false);
    try {
      const response = await fetch("api/shopping-list/items", {
        body: JSON.stringify({ entry: submittedEntry }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        setAddError(true);
        return;
      }
      const updated = await response.json() as ShoppingListSnapshot;
      applyShoppingListSnapshot(updated);
      if (entryRevision.current === submittedEntryRevision) {
        setEntry("");
      }
    } catch {
      setAddError(true);
    }
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
      <section className="shopping-list-content">
        <form className="quick-entry" onSubmit={(event) => void addItem(event)}>
          <label className="visually-hidden" htmlFor="quick-entry">{text.addItem}</label>
          <input
            aria-label={text.addItem}
            autoComplete="off"
            id="quick-entry"
            onChange={(event) => {
              entryRevision.current += 1;
              setEntry(event.target.value);
            }}
            placeholder={text.addItem}
            value={entry}
          />
          <button type="submit">{text.add}</button>
        </form>
        {addError ? <p className="error" role="alert">{text.addItemFailed}</p> : null}
        {shoppingList.items.length === 0 ? (
          <div className="empty-state" aria-labelledby="empty-title">
            <div className="cart" aria-hidden="true">🛒</div>
            <h2 id="empty-title">{text.emptyTitle}</h2>
            <p>{text.emptyDescription}</p>
          </div>
        ) : (
          <ul className="shopping-list" aria-live="polite">
            {shoppingList.items.map((item) => (
              <li className="shopping-item" key={item.id}>
                <strong>{item.product.name}</strong>
                <span>
                  {item.quantity} × {formatSize(item.packageOption.size)} {formatUnit(item.packageOption.unit, text.unit)}
                </span>
              </li>
            ))}
          </ul>
        )}
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

function formatSize(size: number): string {
  return Number.isInteger(size) ? size.toFixed(0) : String(size);
}

function formatUnit(unit: PackageUnit, translatedUnit: string): string {
  return unit === "unit" ? translatedUnit : unit satisfies never;
}
