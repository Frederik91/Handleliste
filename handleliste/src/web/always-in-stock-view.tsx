import { useEffect, useMemo, useRef, useState, type FormEvent, type SyntheticEvent } from "react";
import type {
  AlwaysInStockDefinition,
  AlwaysInStockDefinitionInput,
  AlwaysInStockSelection,
  AlwaysInStockSelectionInput,
  PackageUnit,
  Product,
} from "../shared/shopping-list.js";

export interface AlwaysInStockLabels {
  addDefinition: string;
  alwaysInStock: string;
  archive: string;
  archived: string;
  cancel: string;
  close: string;
  defaultQuantity: string;
  decrease: string;
  definitions: string;
  editDefinition: string;
  enable: string;
  increase: string;
  manageAlwaysInStock: string;
  moveDown: string;
  moveUp: string;
  noDefinitions: string;
  noProducts: string;
  packageOption: string;
  product: string;
  quantity: string;
  restore: string;
  save: string;
  searchDefinitions: string;
  selectionFailed: string;
  submitAlwaysInStock: string;
  unit: string;
}

interface DefinitionManagementProps {
  definitions: readonly AlwaysInStockDefinition[];
  labels: AlwaysInStockLabels;
  onArchive(definitionId: number, archived: boolean): Promise<boolean>;
  onClose(): void;
  onCreate(input: AlwaysInStockDefinitionInput): Promise<boolean>;
  onReorder(definitionIds: readonly number[]): Promise<boolean>;
  onUpdate(definitionId: number, input: AlwaysInStockDefinitionInput): Promise<boolean>;
  open: boolean;
  products: readonly Product[];
}

interface DefinitionEditorState {
  defaultQuantity: number;
  definitionId?: number;
  packageOptionId?: number;
  productId?: number;
}

function useModalDialog(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      const activeElement = document.activeElement;
      returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function cancelDialog(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onClose();
  }

  function synchronizeClosedDialog() {
    if (open) onClose();
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  }

  return { cancelDialog, dialogRef, synchronizeClosedDialog };
}

export function AlwaysInStockDefinitionManagement({
  definitions,
  labels,
  onArchive,
  onClose,
  onCreate,
  onReorder,
  onUpdate,
  open,
  products,
}: DefinitionManagementProps) {
  const { cancelDialog, dialogRef, synchronizeClosedDialog } = useModalDialog(open, onClose);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<DefinitionEditorState>();
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setEditor(undefined);
    setSaveError(false);
  }, [open]);

  const visibleDefinitions = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return definitions.filter((definition) => {
      if (!normalizedSearch) return true;
      const product = products.find((candidate) => candidate.id === definition.productId);
      return product?.name.toLocaleLowerCase().includes(normalizedSearch) ?? false;
    });
  }, [definitions, products, search]);

  function startCreate() {
    const product = products[0];
    const packageOption = product?.packageOptions.find((option) => option.isDefault) ?? product?.packageOptions[0];
    setSaveError(false);
    setEditor({
      defaultQuantity: 1,
      packageOptionId: packageOption?.id,
      productId: product?.id,
    });
  }

  function startEdit(definition: AlwaysInStockDefinition) {
    setSaveError(false);
    setEditor({
      defaultQuantity: definition.defaultQuantity,
      definitionId: definition.id,
      packageOptionId: definition.packageOptionId,
      productId: definition.productId,
    });
  }

  function selectProduct(productId: number | undefined) {
    const product = products.find((candidate) => candidate.id === productId);
    const packageOption = product?.packageOptions.find((option) => option.isDefault) ?? product?.packageOptions[0];
    setEditor((current) => ({
      defaultQuantity: current?.defaultQuantity ?? 1,
      definitionId: current?.definitionId,
      packageOptionId: packageOption?.id,
      productId,
    }));
  }

  async function saveDefinition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor?.productId || !editor.packageOptionId || !Number.isSafeInteger(editor.defaultQuantity) || editor.defaultQuantity < 1) {
      setSaveError(true);
      return;
    }
    const input = {
      defaultQuantity: editor.defaultQuantity,
      packageOptionId: editor.packageOptionId,
      productId: editor.productId,
    } satisfies AlwaysInStockDefinitionInput;
    const saved = editor.definitionId === undefined
      ? await onCreate(input)
      : await onUpdate(editor.definitionId, input);
    if (saved) {
      setEditor(undefined);
      setSaveError(false);
    } else {
      setSaveError(true);
    }
  }

  async function moveDefinition(definitionId: number, offset: -1 | 1) {
    const currentIndex = definitions.findIndex((definition) => definition.id === definitionId);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= definitions.length) return;
    const nextOrder = definitions.map((definition) => definition.id);
    [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex]!, nextOrder[currentIndex]!];
    await onReorder(nextOrder);
  }

  return (
    <dialog
      aria-labelledby="always-in-stock-management-title"
      className="always-in-stock-dialog"
      onCancel={cancelDialog}
      onClose={synchronizeClosedDialog}
      ref={dialogRef}
    >
      <div className="always-in-stock-dialog-header">
        <h2 id="always-in-stock-management-title">{labels.manageAlwaysInStock}</h2>
        <button aria-label={labels.close} onClick={onClose} type="button">×</button>
      </div>
      <label className="always-in-stock-search">
        <span>{labels.searchDefinitions}</span>
        <input
          aria-label={labels.searchDefinitions}
          onChange={(event) => setSearch(event.target.value)}
          type="search"
          value={search}
        />
      </label>
      <div className="always-in-stock-definition-actions">
        <button disabled={products.length === 0} onClick={startCreate} type="button">{labels.addDefinition}</button>
      </div>
      {products.length === 0 ? <p>{labels.noProducts}</p> : null}
      {visibleDefinitions.length === 0 && products.length > 0 ? <p>{labels.noDefinitions}</p> : null}
      <ul aria-label={labels.definitions} className="always-in-stock-definitions">
        {visibleDefinitions.map((definition) => {
          const product = products.find((candidate) => candidate.id === definition.productId);
          const packageOption = product?.packageOptions.find((option) => option.id === definition.packageOptionId);
          if (!product || !packageOption) return null;
          const definitionIndex = definitions.findIndex((candidate) => candidate.id === definition.id);
          return (
            <li className="always-in-stock-definition" key={definition.id}>
              <div>
                <strong>{product.name}</strong>
                <span>{formatPackageOption(packageOption, labels.unit)}</span>
                <small>{definition.defaultQuantity} × {labels.defaultQuantity}</small>
                {definition.archived ? <small>{labels.archived}</small> : null}
              </div>
              <div className="always-in-stock-definition-actions">
                <button onClick={() => startEdit(definition)} type="button">{labels.editDefinition}</button>
                <button
                  aria-label={`${definition.archived ? labels.restore : labels.archive} ${product.name}`}
                  onClick={() => void onArchive(definition.id, !definition.archived)}
                  type="button"
                >
                  {definition.archived ? labels.restore : labels.archive}
                </button>
                <button
                  aria-label={`${labels.moveUp} ${product.name}`}
                  disabled={definitionIndex <= 0}
                  onClick={() => void moveDefinition(definition.id, -1)}
                  type="button"
                >↑</button>
                <button
                  aria-label={`${labels.moveDown} ${product.name}`}
                  disabled={definitionIndex === definitions.length - 1}
                  onClick={() => void moveDefinition(definition.id, 1)}
                  type="button"
                >↓</button>
              </div>
            </li>
          );
        })}
      </ul>
      {editor ? (
        <form aria-label={editor.definitionId === undefined ? labels.addDefinition : labels.editDefinition} className="always-in-stock-editor" onSubmit={(event) => void saveDefinition(event)}>
          <h3>{editor.definitionId === undefined ? labels.addDefinition : labels.editDefinition}</h3>
          <label>
            <span>{labels.product}</span>
            <select
              aria-label={labels.product}
              onChange={(event) => selectProduct(event.target.value ? Number(event.target.value) : undefined)}
              required
              value={editor.productId ?? ""}
            >
              <option value="">{labels.product}</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label>
            <span>{labels.packageOption}</span>
            <select
              aria-label={labels.packageOption}
              disabled={!editor.productId}
              onChange={(event) => setEditor({ ...editor, packageOptionId: Number(event.target.value) })}
              required
              value={editor.packageOptionId ?? ""}
            >
              <option value="">{labels.packageOption}</option>
              {products.find((product) => product.id === editor.productId)?.packageOptions.map((option) => (
                <option key={option.id} value={option.id}>{formatPackageOption(option, labels.alwaysInStock)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{labels.defaultQuantity}</span>
            <input
              aria-label={labels.defaultQuantity}
              min="1"
              onChange={(event) => setEditor({ ...editor, defaultQuantity: Number(event.target.value) })}
              required
              step="1"
              type="number"
              value={editor.defaultQuantity}
            />
          </label>
          <div className="always-in-stock-editor-actions">
            <button type="submit">{labels.save}</button>
            <button onClick={() => setEditor(undefined)} type="button">{labels.cancel}</button>
          </div>
          {saveError ? <p className="error" role="alert">{labels.selectionFailed}</p> : null}
        </form>
      ) : null}
    </dialog>
  );
}

interface TripSelectionProps {
  definitions: readonly AlwaysInStockDefinition[];
  labels: AlwaysInStockLabels;
  onClose(): void;
  onSave(selections: readonly AlwaysInStockSelectionInput[]): Promise<boolean>;
  open: boolean;
  products: readonly Product[];
  revision: number;
  selections: readonly AlwaysInStockSelection[];
}

export function AlwaysInStockTripSelection({
  definitions,
  labels,
  onClose,
  onSave,
  open,
  products,
  revision,
  selections,
}: TripSelectionProps) {
  const { cancelDialog, dialogRef, synchronizeClosedDialog } = useModalDialog(open, onClose);
  const [selectedQuantities, setSelectedQuantities] = useState<Map<number, number>>(new Map());
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedQuantities(new Map(selections.map((selection) => [selection.definitionId, selection.quantity])));
    setSaveError(false);
  }, [open, revision, selections]);

  async function saveSelections(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = definitions
      .filter((definition) => !definition.archived && selectedQuantities.has(definition.id))
      .map((definition) => ({
        definitionId: definition.id,
        quantity: selectedQuantities.get(definition.id)!,
      }));
    if (await onSave(selected)) {
      setSaveError(false);
      onClose();
    } else {
      setSaveError(true);
    }
  }

  return (
    <dialog
      aria-labelledby="always-in-stock-selection-title"
      className="always-in-stock-dialog"
      onCancel={cancelDialog}
      onClose={synchronizeClosedDialog}
      ref={dialogRef}
    >
      <div className="always-in-stock-dialog-header">
        <h2 id="always-in-stock-selection-title">{labels.alwaysInStock}</h2>
        <button aria-label={labels.close} onClick={onClose} type="button">×</button>
      </div>
      {definitions.every((definition) => definition.archived) ? <p>{labels.noDefinitions}</p> : null}
      <form onSubmit={(event) => void saveSelections(event)}>
        <ul aria-label={labels.alwaysInStock} className="always-in-stock-selections">
          {definitions.filter((definition) => !definition.archived).map((definition) => {
            const product = products.find((candidate) => candidate.id === definition.productId);
            const packageOption = product?.packageOptions.find((option) => option.id === definition.packageOptionId);
            if (!product || !packageOption) return null;
            const quantity = selectedQuantities.get(definition.id);
            const enabled = quantity !== undefined;
            return (
              <li className="always-in-stock-selection" key={definition.id}>
                <label>
                  <input
                    aria-label={`${labels.enable} ${product.name}`}
                    checked={enabled}
                    onChange={(event) => {
                      setSelectedQuantities((current) => {
                        const next = new Map(current);
                        if (event.target.checked) next.set(definition.id, definition.defaultQuantity);
                        else next.delete(definition.id);
                        return next;
                      });
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>{product.name}</strong>
                    <small>{formatPackageOption(packageOption, labels.unit)}</small>
                  </span>
                </label>
                {enabled ? (
                  <div className="always-in-stock-quantity">
                    <button
                      aria-label={`${labels.decrease} ${product.name}`}
                      disabled={quantity <= 1}
                      onClick={() => setSelectedQuantities((current) => new Map(current).set(definition.id, quantity - 1))}
                      type="button"
                    >−</button>
                    <input
                      aria-label={`${labels.quantity} ${product.name}`}
                      min="1"
                      onChange={(event) => setSelectedQuantities((current) => new Map(current).set(definition.id, Number(event.target.value)))}
                      required
                      step="1"
                      type="number"
                      value={quantity}
                    />
                    <button
                      aria-label={`${labels.increase} ${product.name}`}
                      onClick={() => setSelectedQuantities((current) => new Map(current).set(definition.id, quantity + 1))}
                      type="button"
                    >+</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="always-in-stock-editor-actions">
          <button type="submit">{labels.submitAlwaysInStock}</button>
          <button onClick={onClose} type="button">{labels.cancel}</button>
        </div>
        {saveError ? <p className="error" role="alert">{labels.selectionFailed}</p> : null}
      </form>
    </dialog>
  );
}

function formatPackageOption(option: Product["packageOptions"][number], unitLabel: string): string {
  const size = Number.isInteger(option.size) ? option.size.toFixed(0) : String(option.size);
  const unit: PackageUnit = option.unit;
  return `${size} ${unit === "unit" ? unitLabel : unit}`;
}
