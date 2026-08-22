import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizeProductName } from "../shared/product-name.js";
import type {
  Product,
  ShoppingItemEdit,
  ShoppingListMutation,
  ShoppingListSnapshot,
} from "../shared/shopping-list.js";
import { followHomeAssistantTheme } from "./home-assistant-theme.js";
import { QuickEntryForm } from "./quick-entry-form.js";
import { ShoppingListView } from "./shopping-list-view.js";
import "./styles.css";

interface BootstrapData {
  identity: { displayName: string; id: string; name: string };
  locale: Locale;
  shoppingList: ShoppingListSnapshot;
}

type Locale = "en" | "nb";

const translations = {
  en: {
    add: "Add",
    addItem: "Add item",
    addItemFailed: "Could not add the item. Try again.",
    cancel: "Cancel",
    edit: "Edit",
    editItemFailed: "Could not save the item. Try again.",
    emptyDescription: "Items you add will appear here.",
    emptyTitle: "Your shopping list is ready",
    itemAdded: "Item added",
    language: "Language",
    packageSize: "Package size",
    product: "Product",
    quantity: "Quantity",
    save: "Save",
    undo: "Undo",
    unit: "unit",
    unitLabel: "Unit",
  },
  nb: {
    add: "Legg til",
    addItem: "Legg til vare",
    addItemFailed: "Kunne ikke legge til varen. Prøv igjen.",
    cancel: "Avbryt",
    edit: "Rediger",
    editItemFailed: "Kunne ikke lagre varen. Prøv igjen.",
    emptyDescription: "Varer du legger til, vises her.",
    emptyTitle: "Handlelisten din er klar",
    itemAdded: "Vare lagt til",
    language: "Språk",
    packageSize: "Pakningsstørrelse",
    product: "Produkt",
    quantity: "Antall",
    save: "Lagre",
    undo: "Angre",
    unit: "enhet",
    unitLabel: "Enhet",
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
  const [selectedProductId, setSelectedProductId] = useState<number>();
  const [addError, setAddError] = useState(false);
  const [undoToken, setUndoToken] = useState<string>();
  const entryRevision = useRef(0);
  const shoppingListRevision = useRef(shoppingList.revision);
  const text = translations[locale];

  const applyShoppingListSnapshot = useCallback((updated: ShoppingListSnapshot) => {
    if (updated.revision < shoppingListRevision.current) return false;
    shoppingListRevision.current = updated.revision;
    setShoppingList(updated);
    return true;
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    let active = true;
    const refreshShoppingList = async () => {
      try {
        const response = await fetch("api/shopping-list");
        if (!response.ok || !active) return;
        const updated = await response.json() as ShoppingListSnapshot;
        if (active) applyShoppingListSnapshot(updated);
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

  useEffect(() => {
    if (!undoToken) return;
    const timeout = window.setTimeout(() => setUndoToken(undefined), 6_000);
    return () => window.clearTimeout(timeout);
  }, [undoToken]);

  async function changeLocale(nextLocale: Locale) {
    const response = await fetch("api/preferences/locale", {
      body: JSON.stringify({ locale: nextLocale }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) throw new Error("Could not save language preference");
    setLocale(nextLocale);
  }

  function changeEntry(value: string) {
    entryRevision.current += 1;
    setEntry(value);
    const selectedProduct = shoppingList.products.find((product) => product.id === selectedProductId);
    const normalizedEntry = normalizeProductName(value);
    const normalizedSelectedName = selectedProduct && normalizeProductName(selectedProduct.name);
    if (!normalizedSelectedName || (normalizedEntry !== normalizedSelectedName && !normalizedEntry.startsWith(`${normalizedSelectedName} `))) {
      setSelectedProductId(undefined);
    }
  }

  function selectProduct(product: Product) {
    entryRevision.current += 1;
    setEntry(product.name);
    setSelectedProductId(product.id);
  }

  async function addItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entry.trim()) return;
    const submittedEntry = entry;
    const submittedEntryRevision = entryRevision.current;
    setAddError(false);
    try {
      const response = await fetch("api/shopping-list/items", {
        body: JSON.stringify({ entry: submittedEntry, productId: selectedProductId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        setAddError(true);
        return;
      }
      const updated = await response.json() as ShoppingListMutation;
      if (applyShoppingListSnapshot(updated)) setUndoToken(updated.undoToken);
      if (entryRevision.current === submittedEntryRevision) {
        setEntry("");
        setSelectedProductId(undefined);
      }
    } catch {
      setAddError(true);
    }
  }

  async function saveItem(edit: ShoppingItemEdit): Promise<boolean> {
    try {
      const response = await fetch(`api/shopping-list/items/${edit.itemId}`, {
        body: JSON.stringify(edit),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) return false;
      applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
      setUndoToken(undefined);
      return true;
    } catch {
      return false;
    }
  }

  async function undoQuickEntry() {
    if (!undoToken) return;
    try {
      const response = await fetch("api/shopping-list/quick-entry/undo", {
        body: JSON.stringify({ token: undoToken }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) return;
      applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
      setUndoToken(undefined);
    } catch {
      // The action expires unobtrusively; live updates still keep the list current.
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
        <QuickEntryForm
          addLabel={text.add}
          entry={entry}
          inputLabel={text.addItem}
          onChange={changeEntry}
          onSelect={selectProduct}
          onSubmit={(event) => void addItem(event)}
          products={shoppingList.products}
        />
        {addError ? <p className="error" role="alert">{text.addItemFailed}</p> : null}
        {shoppingList.items.length === 0 ? (
          <div className="empty-state" aria-labelledby="empty-title">
            <div className="cart" aria-hidden="true">🛒</div>
            <h2 id="empty-title">{text.emptyTitle}</h2>
            <p>{text.emptyDescription}</p>
          </div>
        ) : (
          <ShoppingListView labels={text} onSave={saveItem} shoppingList={shoppingList} />
        )}
      </section>
      {undoToken ? (
        <div className="undo-notification" role="status">
          <span>{text.itemAdded}</span>
          <button onClick={() => void undoQuickEntry()} type="button">{text.undo}</button>
        </div>
      ) : null}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Handleliste root element is missing");

followHomeAssistantTheme();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
