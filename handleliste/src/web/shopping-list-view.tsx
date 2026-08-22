import { useState } from "react";
import { packageUnits } from "../shared/package-option.js";
import { normalizeProductName } from "../shared/product-name.js";
import type {
  PackageUnit,
  Product,
  ShoppingItemEdit,
  ShoppingListItem,
  ShoppingListSnapshot,
} from "../shared/shopping-list.js";

interface ShoppingListLabels {
  cancel: string;
  edit: string;
  editItemFailed: string;
  packageSize: string;
  product: string;
  quantity: string;
  save: string;
  unit: string;
  unitLabel: string;
}

interface ShoppingListViewProps {
  labels: ShoppingListLabels;
  onSave(edit: ShoppingItemEdit): Promise<boolean>;
  shoppingList: ShoppingListSnapshot;
}

export function ShoppingListView({ labels, onSave, shoppingList }: ShoppingListViewProps) {
  const [editingItemId, setEditingItemId] = useState<number>();
  const [editError, setEditError] = useState(false);

  async function save(edit: ShoppingItemEdit) {
    setEditError(false);
    if (await onSave(edit)) {
      setEditingItemId(undefined);
      return;
    }
    setEditError(true);
  }

  return (
    <div className="shopping-list" aria-live="polite">
      {groupItemsByProduct(shoppingList).map(({ items, product }) => (
        <section aria-label={product.name} className="product-group" key={product.id} role="group">
          <h2>{product.name}</h2>
          <ul>
            {items.map((item) => (
              <li className="shopping-item" key={item.id}>
                <strong className="visually-hidden">{product.name}</strong>
                {editingItemId === item.id ? (
                  <ShoppingItemEditor
                    editError={editError}
                    item={item}
                    labels={labels}
                    onCancel={() => setEditingItemId(undefined)}
                    onSave={(edit) => void save(edit)}
                    products={shoppingList.products}
                  />
                ) : (
                  <>
                    <span>
                      {item.quantity} × {formatSize(item.packageOption.size)} {formatUnit(item.packageOption.unit, labels.unit)}
                    </span>
                    <button
                      className="edit-item"
                      onClick={() => {
                        setEditError(false);
                        setEditingItemId(item.id);
                      }}
                      type="button"
                    >
                      {labels.edit}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface ShoppingItemEditorProps {
  editError: boolean;
  item: ShoppingListItem;
  labels: ShoppingListLabels;
  onCancel(): void;
  onSave(edit: ShoppingItemEdit): void;
  products: readonly Product[];
}

function ShoppingItemEditor({
  editError,
  item,
  labels,
  onCancel,
  onSave,
  products,
}: ShoppingItemEditorProps) {
  const [edit, setEdit] = useState<ShoppingItemEdit>({
    itemId: item.id,
    packageSize: item.packageOption.size,
    packageUnit: item.packageOption.unit,
    productId: item.product.id,
    productName: item.product.name,
    quantity: item.quantity,
  });

  return (
    <form
      className="item-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(edit);
      }}
    >
      <label>
        <span>{labels.product}</span>
        <input
          aria-label={labels.product}
          list="item-editor-products"
          onChange={(event) => {
            const productName = event.target.value;
            const selectedProduct = products.find(
              (candidate) => normalizeProductName(candidate.name) === normalizeProductName(productName),
            );
            if (!selectedProduct) {
              setEdit({ ...edit, productId: undefined, productName });
              return;
            }
            const defaultOption = selectedProduct.packageOptions.find((option) => option.isDefault)
              ?? selectedProduct.packageOptions[0]!;
            setEdit({
              ...edit,
              packageSize: defaultOption.size,
              packageUnit: defaultOption.unit,
              productId: selectedProduct.id,
              productName,
            });
          }}
          value={edit.productName}
        />
        <datalist id="item-editor-products">
          {products.map((candidate) => <option key={candidate.id} value={candidate.name} />)}
        </datalist>
      </label>
      <label>
        <span>{labels.packageSize}</span>
        <input
          aria-label={labels.packageSize}
          min="0.001"
          onChange={(event) => setEdit({ ...edit, packageSize: Number(event.target.value) })}
          required
          step="any"
          type="number"
          value={edit.packageSize}
        />
      </label>
      <label>
        <span>{labels.unitLabel}</span>
        <select
          aria-label={labels.unitLabel}
          onChange={(event) => setEdit({ ...edit, packageUnit: event.target.value as PackageUnit })}
          value={edit.packageUnit}
        >
          {packageUnits.map((unit) => (
            <option key={unit} value={unit}>{formatUnit(unit, labels.unit)}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{labels.quantity}</span>
        <input
          aria-label={labels.quantity}
          min="1"
          onChange={(event) => setEdit({ ...edit, quantity: Number(event.target.value) })}
          required
          step="1"
          type="number"
          value={edit.quantity}
        />
      </label>
      <div className="item-editor-actions">
        <button type="submit">{labels.save}</button>
        <button onClick={onCancel} type="button">{labels.cancel}</button>
      </div>
      {editError ? <p className="error" role="alert">{labels.editItemFailed}</p> : null}
    </form>
  );
}

function groupItemsByProduct(shoppingList: ShoppingListSnapshot) {
  return shoppingList.products.flatMap((product) => {
    const items = shoppingList.items.filter((item) => item.product.id === product.id);
    return items.length > 0 ? [{ items, product }] : [];
  });
}

function formatSize(size: number): string {
  return Number.isInteger(size) ? size.toFixed(0) : String(size);
}

function formatUnit(unit: PackageUnit, translatedUnit: string): string {
  return unit === "unit" ? translatedUnit : unit;
}
