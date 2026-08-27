import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizeProductName } from "../shared/product-name.js";
import type { RecipeInput, RecipePreview } from "../shared/recipe.js";
import type {
  AlwaysInStockDefinitionInput,
  AlwaysInStockSelectionInput,
  Product,
  ShoppingItemEdit,
  ShoppingListMutation,
  ShoppingListSnapshot,
} from "../shared/shopping-list.js";
import { followHomeAssistantTheme } from "./home-assistant-theme.js";
import { AlwaysInStockDefinitionManagement, AlwaysInStockTripSelection } from "./always-in-stock-view.js";
import { QuickEntryForm } from "./quick-entry-form.js";
import { RecipeManagement } from "./recipe-view.js";
import { ShoppingListView } from "./shopping-list-view.js";
import "./styles.css";

interface BootstrapData {
  identity: { displayName: string; id: string; name: string };
  locale: Locale;
  shoppingList: ShoppingListSnapshot;
}

type Locale = "en" | "nb";

type UndoNotice =
  | { kind: "clear-completed"; token: string }
  | { kind: "quick-entry"; token: string };

const translations = {
  en: {
    add: "Add", addDefinition: "Add definition", addIngredient: "Add ingredient", addItem: "Add item",
    addItemFailed: "Could not add the item. Try again.", addRecipe: "Add recipe", alwaysInStock: "Always in Stock",
    amount: "Amount", archive: "Archive", archived: "Archived", cancel: "Cancel", clearCompleted: "Clear completed",
    close: "Close", complete: "Complete", completed: "Completed", decrease: "Decrease", defaultQuantity: "Default Quantity",
    definitions: "Always in Stock definitions", edit: "Edit", editDefinition: "Edit definition",
    editItemFailed: "Could not save the item. Try again.", editRecipe: "Edit recipe",
    emptyDescription: "Items you add will appear here.", emptyTitle: "Your shopping list is ready", enable: "Enable",
    increase: "Increase", ingredient: "Ingredient", itemAdded: "Item added", itemsCleared: "Completed items cleared",
    language: "Language", manageAlwaysInStock: "Manage Always in Stock", manageRecipes: "Manage Recipes",
    moveDown: "Move down", moveUp: "Move up", newTrip: "New shopping trip",
    newTripWarning: "Start a new shopping trip? All active, completed, and purchased items from this trip will be removed.",
    noDefinitions: "No Always in Stock definitions yet.", noProducts: "Add a Product to the Shopping List before creating a definition.",
    noProductsForRecipes: "Add a Product to the Shopping List before creating a Recipe.", noRecipes: "No Recipes yet.",
    note: "Note", packageOption: "Package Option", packageSize: "Package size", preview: "Preview", product: "Product",
    quantity: "Quantity", recipeCount: "Recipe count", recipeName: "Recipe name", recipePreview: "Recipe preview",
    recipes: "Recipes", removeIngredient: "Remove ingredient", restore: "Restore", save: "Save",
    saveRecipeFailed: "Could not save the Recipe. Check its Ingredient dimensions.", searchDefinitions: "Search definitions",
    searchRecipes: "Search recipes", selectionFailed: "Could not save Always in Stock. Try again.",
    submitAlwaysInStock: "Add to Shopping List", undo: "Undo", unit: "unit", unitLabel: "Unit",
  },
  nb: {
    add: "Legg til", addDefinition: "Legg til definisjon", addIngredient: "Legg til ingrediens", addItem: "Legg til vare",
    addItemFailed: "Kunne ikke legge til varen. Prøv igjen.", addRecipe: "Legg til oppskrift", alwaysInStock: "Alltid på lager",
    amount: "Mengde", archive: "Arkiver", archived: "Arkivert", cancel: "Avbryt", clearCompleted: "Fjern fullførte",
    close: "Lukk", complete: "Fullfør", completed: "Fullført", decrease: "Reduser", defaultQuantity: "Standardantall",
    definitions: "Definisjoner for alltid på lager", edit: "Rediger", editDefinition: "Rediger definisjon",
    editItemFailed: "Kunne ikke lagre varen. Prøv igjen.", editRecipe: "Rediger oppskrift",
    emptyDescription: "Varer du legger til, vises her.", emptyTitle: "Handlelisten din er klar", enable: "Aktiver",
    increase: "Øk", ingredient: "Ingrediens", itemAdded: "Vare lagt til", itemsCleared: "Fullførte varer fjernet",
    language: "Språk", manageAlwaysInStock: "Administrer alltid på lager", manageRecipes: "Administrer oppskrifter",
    moveDown: "Flytt ned", moveUp: "Flytt opp", newTrip: "Ny handletur",
    newTripWarning: "Starte en ny handletur? Alle aktive, fullførte og kjøpte varer fra denne turen blir fjernet.",
    noDefinitions: "Ingen definisjoner for alltid på lager ennå.", noProducts: "Legg et Produkt i Handlelisten før du lager en definisjon.",
    noProductsForRecipes: "Legg et Produkt i Handlelisten før du lager en oppskrift.", noRecipes: "Ingen oppskrifter ennå.",
    note: "Notat", packageOption: "Pakningsalternativ", packageSize: "Pakningsstørrelse", preview: "Forhåndsvis",
    product: "Produkt", quantity: "Antall", recipeCount: "Antall oppskrifter", recipeName: "Navn på oppskrift",
    recipePreview: "Forhåndsvisning av oppskrift", recipes: "Oppskrifter", removeIngredient: "Fjern ingrediens",
    restore: "Gjenopprett", save: "Lagre", saveRecipeFailed: "Kunne ikke lagre oppskriften. Kontroller ingrediensenhetene.",
    searchDefinitions: "Søk i definisjoner", searchRecipes: "Søk i oppskrifter",
    selectionFailed: "Kunne ikke lagre alltid på lager. Prøv igjen.", submitAlwaysInStock: "Legg til i handlelisten",
    undo: "Angre", unit: "enhet", unitLabel: "Enhet",
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
  const [definitionManagementOpen, setDefinitionManagementOpen] = useState(false);
  const [recipeManagementOpen, setRecipeManagementOpen] = useState(false);
  const [tripSelectionOpen, setTripSelectionOpen] = useState(false);
  const [undoNotice, setUndoNotice] = useState<UndoNotice>();
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
    if (!undoNotice) return;
    const timeout = window.setTimeout(() => setUndoNotice(undefined), 6_000);
    return () => window.clearTimeout(timeout);
  }, [undoNotice]);

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
      applyShoppingListSnapshot(updated);
      setUndoNotice({ kind: "quick-entry", token: updated.undoToken });
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
      setUndoNotice(undefined);
      return true;
    } catch {
      return false;
    }
  }

  async function undoQuickEntry() {
    if (undoNotice?.kind !== "quick-entry") return;
    try {
      const response = await fetch("api/shopping-list/quick-entry/undo", {
        body: JSON.stringify({ token: undoNotice.token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) return;
      applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
      setUndoNotice(undefined);
    } catch {
      // The action expires unobtrusively; live updates still keep the list current.
    }
  }

  async function toggleCompletion(itemId: number, completed: boolean) {
    const response = await fetch(`api/shopping-list/items/${itemId}/completion`, {
      body: JSON.stringify({ completed }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) return;
    applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
    setUndoNotice(undefined);
  }

  async function clearCompleted() {
    const response = await fetch("api/shopping-list/completed/clear", { method: "POST" });
    if (!response.ok) return;
    const updated = await response.json() as ShoppingListMutation;
    applyShoppingListSnapshot(updated);
    setUndoNotice({ kind: "clear-completed", token: updated.undoToken });
  }

  async function undoClearCompleted() {
    if (undoNotice?.kind !== "clear-completed") return;
    const response = await fetch("api/shopping-list/completed/undo-clear", {
      body: JSON.stringify({ token: undoNotice.token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) return;
    applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
    setUndoNotice(undefined);
  }

  async function createAlwaysInStockDefinition(input: AlwaysInStockDefinitionInput): Promise<boolean> {
    try {
      const response = await fetch("api/shopping-list/always-in-stock/definitions", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) return false;
      return applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
    } catch {
      return false;
    }
  }

  async function updateAlwaysInStockDefinition(definitionId: number, input: AlwaysInStockDefinitionInput): Promise<boolean> {
    try {
      const response = await fetch(`api/shopping-list/always-in-stock/definitions/${definitionId}`, {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) return false;
      return applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
    } catch {
      return false;
    }
  }

  async function archiveAlwaysInStockDefinition(definitionId: number, archived: boolean): Promise<boolean> {
    try {
      const response = await fetch(`api/shopping-list/always-in-stock/definitions/${definitionId}/archive`, {
        body: JSON.stringify({ archived }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) return false;
      return applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
    } catch {
      return false;
    }
  }

  async function reorderAlwaysInStockDefinitions(definitionIds: readonly number[]): Promise<boolean> {
    try {
      const response = await fetch("api/shopping-list/always-in-stock/definitions/reorder", {
        body: JSON.stringify({ definitionIds }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) return false;
      return applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
    } catch {
      return false;
    }
  }

  async function saveAlwaysInStockSelections(selections: readonly AlwaysInStockSelectionInput[]): Promise<boolean> {
    try {
      const response = await fetch("api/shopping-list/always-in-stock/selections", {
        body: JSON.stringify({ selections }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      if (!response.ok) return false;
      return applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
    } catch {
      return false;
    }
  }

  async function saveRecipeRequest(url: string, method: "PATCH" | "POST", input: RecipeInput): Promise<boolean> {
    try {
      const response = await fetch(url, {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method,
      });
      if (!response.ok) return false;
      return applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
    } catch {
      return false;
    }
  }

  function createRecipe(input: RecipeInput): Promise<boolean> {
    return saveRecipeRequest("api/recipes", "POST", input);
  }

  function updateRecipe(recipeId: number, input: RecipeInput): Promise<boolean> {
    return saveRecipeRequest(`api/recipes/${recipeId}`, "PATCH", input);
  }

  async function archiveRecipe(recipeId: number, archived: boolean): Promise<boolean> {
    try {
      const response = await fetch(`api/recipes/${recipeId}/archive`, {
        body: JSON.stringify({ archived }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) return false;
      return applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
    } catch {
      return false;
    }
  }

  async function previewRecipe(recipeId: number, count: number): Promise<RecipePreview | undefined> {
    try {
      const response = await fetch(`api/recipes/${recipeId}/preview`, {
        body: JSON.stringify({ count }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return response.ok ? await response.json() as RecipePreview : undefined;
    } catch {
      return undefined;
    }
  }

  async function startNewTrip() {
    if (!window.confirm(text.newTripWarning)) return;
    const response = await fetch("api/shopping-list/trips/new", { method: "POST" });
    if (!response.ok) return;
    applyShoppingListSnapshot(await response.json() as ShoppingListSnapshot);
    setUndoNotice(undefined);
  }

  function undoLastAction() {
    if (undoNotice?.kind === "quick-entry") {
      void undoQuickEntry();
      return;
    }
    if (undoNotice?.kind === "clear-completed") void undoClearCompleted();
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
        <div className="trip-actions">
          <button onClick={() => setRecipeManagementOpen(true)} type="button">{text.manageRecipes}</button>
          <button onClick={() => setTripSelectionOpen(true)} type="button">{text.alwaysInStock}</button>
          <button onClick={() => setDefinitionManagementOpen(true)} type="button">{text.manageAlwaysInStock}</button>
          <button onClick={() => void startNewTrip()} type="button">{text.newTrip}</button>
          {shoppingList.items.some((item) => item.state.kind === "completed") ? (
            <button onClick={() => void clearCompleted()} type="button">{text.clearCompleted}</button>
          ) : null}
        </div>
        {shoppingList.items.length === 0 ? (
          <div className="empty-state" aria-labelledby="empty-title">
            <div className="cart" aria-hidden="true">🛒</div>
            <h2 id="empty-title">{text.emptyTitle}</h2>
            <p>{text.emptyDescription}</p>
          </div>
        ) : (
          <ShoppingListView
            labels={text}
            onSave={saveItem}
            onToggleCompletion={(itemId, completed) => void toggleCompletion(itemId, completed)}
            shoppingList={shoppingList}
          />
        )}
      </section>
      <AlwaysInStockDefinitionManagement
        definitions={shoppingList.alwaysInStockDefinitions}
        labels={text}
        onArchive={archiveAlwaysInStockDefinition}
        onClose={() => setDefinitionManagementOpen(false)}
        onCreate={createAlwaysInStockDefinition}
        onReorder={reorderAlwaysInStockDefinitions}
        onUpdate={updateAlwaysInStockDefinition}
        open={definitionManagementOpen}
        products={shoppingList.products}
      />
      <AlwaysInStockTripSelection
        definitions={shoppingList.alwaysInStockDefinitions}
        labels={text}
        onClose={() => setTripSelectionOpen(false)}
        onSave={saveAlwaysInStockSelections}
        open={tripSelectionOpen}
        products={shoppingList.products}
        revision={shoppingList.revision}
        selections={shoppingList.alwaysInStockSelections}
      />
      <RecipeManagement
        labels={text}
        onArchive={archiveRecipe}
        onClose={() => setRecipeManagementOpen(false)}
        onCreate={createRecipe}
        onPreview={previewRecipe}
        onUpdate={updateRecipe}
        open={recipeManagementOpen}
        products={shoppingList.products}
        recipes={shoppingList.recipes}
        revision={shoppingList.revision}
      />
      {undoNotice ? (
        <div className="undo-notification" role="status">
          <span>{undoNotice.kind === "quick-entry" ? text.itemAdded : text.itemsCleared}</span>
          <button onClick={undoLastAction} type="button">{text.undo}</button>
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
