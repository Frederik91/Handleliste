import type { FormEvent } from "react";
import type { Product } from "../domain/shopping-list.js";
import { normalizeProductName } from "../domain/product-name.js";

interface QuickEntryFormProps {
  addLabel: string;
  entry: string;
  inputLabel: string;
  onChange(value: string): void;
  onSelect(product: Product): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  products: readonly Product[];
}

export function QuickEntryForm({
  addLabel,
  entry,
  inputLabel,
  onChange,
  onSelect,
  onSubmit,
  products,
}: QuickEntryFormProps) {
  const query = normalizeProductName(entry);
  const suggestions = query === "" ? [] : products.filter((product) => {
    const name = normalizeProductName(product.name);
    return name.startsWith(query) && name !== query;
  }).slice(0, 5);

  return (
    <form className="quick-entry" onSubmit={onSubmit}>
      <label className="visually-hidden" htmlFor="quick-entry">{inputLabel}</label>
      <div className="quick-entry-input">
        <input
          aria-label={inputLabel}
          aria-autocomplete="list"
          aria-controls="product-suggestions"
          aria-expanded={suggestions.length > 0}
          autoComplete="off"
          id="quick-entry"
          onChange={(event) => onChange(event.target.value)}
          placeholder={inputLabel}
          role="combobox"
          value={entry}
        />
        {suggestions.length > 0 ? (
          <div className="product-suggestions" id="product-suggestions" role="listbox">
            {suggestions.map((product) => (
              <button
                aria-selected="false"
                key={product.id}
                onClick={() => onSelect(product)}
                role="option"
                type="button"
              >
                {product.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button type="submit">{addLabel}</button>
    </form>
  );
}
