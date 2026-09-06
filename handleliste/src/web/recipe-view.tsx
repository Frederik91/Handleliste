import { useEffect, useMemo, useState, type FormEvent } from "react";
import { isRecipeUnit, recipeUnits, type IngredientRequirement, type Recipe, type RecipeInput, type RecipePreview } from "../domain/recipe.js";
import type { Product } from "../domain/shopping-list.js";
import { useModalDialog } from "./use-modal-dialog.js";

export interface RecipeLabels {
  addIngredient: string;
  addRecipe: string;
  amount: string;
  archive: string;
  archived: string;
  cancel: string;
  close: string;
  editRecipe: string;
  ingredient: string;
  manageRecipes: string;
  noProductsForRecipes: string;
  noRecipes: string;
  note: string;
  preview: string;
  product: string;
  recipeCount: string;
  recipeName: string;
  recipePreview: string;
  recipes: string;
  removeIngredient: string;
  restore: string;
  save: string;
  saveRecipeFailed: string;
  searchRecipes: string;
  unitLabel: string;
}

interface RecipeManagementProps {
  labels: RecipeLabels;
  onArchive(recipeId: number, archived: boolean): Promise<boolean>;
  onClose(): void;
  onCreate(input: RecipeInput): Promise<boolean>;
  onPreview(recipeId: number, count: number): Promise<RecipePreview | undefined>;
  onUpdate(recipeId: number, input: RecipeInput): Promise<boolean>;
  open: boolean;
  products: readonly Product[];
  recipes: readonly Recipe[];
  revision: number;
}

interface EditorState {
  name: string;
  note: string;
  recipeId?: number;
  requirements: IngredientRequirement[];
}

interface PreviewState {
  count: number;
  recipeId: number;
  result?: RecipePreview;
}

export function RecipeManagement({
  labels,
  onArchive,
  onClose,
  onCreate,
  onPreview,
  onUpdate,
  open,
  products,
  recipes,
  revision,
}: RecipeManagementProps) {
  const { cancelDialog, dialogRef, synchronizeClosedDialog } = useModalDialog(open, onClose);
  const [editor, setEditor] = useState<EditorState>();
  const [preview, setPreview] = useState<PreviewState>();
  const [saveError, setSaveError] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setEditor(undefined);
    setPreview(undefined);
    setSaveError(false);
    setSearch("");
  }, [open]);

  useEffect(() => {
    if (!preview || !open) return;
    const recipe = recipes.find((candidate) => candidate.id === preview.recipeId);
    if (!recipe) setPreview(undefined);
  }, [open, preview, recipes, revision]);

  const visibleRecipes = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return recipes;
    return recipes.filter((recipe) => `${recipe.name} ${recipe.note ?? ""}`.toLocaleLowerCase().includes(term));
  }, [recipes, search]);

  function defaultRequirement(): IngredientRequirement {
    const product = products[0];
    const dimensions = new Set(product?.packageOptions.map((option) => option.measurementDimension));
    const unit = dimensions.has("mass") ? "g" : dimensions.has("volume") ? "ml" : "piece";
    return { amount: 1, productId: product?.id ?? 0, unit };
  }

  function startCreate() {
    setPreview(undefined);
    setSaveError(false);
    setEditor({ name: "", note: "", requirements: [defaultRequirement()] });
  }

  function startEdit(recipe: Recipe) {
    setPreview(undefined);
    setSaveError(false);
    setEditor({
      name: recipe.name,
      note: recipe.note ?? "",
      recipeId: recipe.id,
      requirements: recipe.requirements.map((requirement) => ({ ...requirement })),
    });
  }

  function updateRequirement(index: number, update: Partial<IngredientRequirement>) {
    setEditor((current) => current && ({
      ...current,
      requirements: current.requirements.map((requirement, requirementIndex) => (
        requirementIndex === index ? { ...requirement, ...update } : requirement
      )),
    }));
  }

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !editor.name.trim() || editor.requirements.some((requirement) => (
      !requirement.productId || !Number.isFinite(requirement.amount) || requirement.amount <= 0
    ))) {
      setSaveError(true);
      return;
    }
    const input = {
      name: editor.name,
      ...(editor.note.trim() ? { note: editor.note } : {}),
      requirements: editor.requirements,
    } satisfies RecipeInput;
    const saved = editor.recipeId === undefined
      ? await onCreate(input)
      : await onUpdate(editor.recipeId, input);
    if (saved) {
      setEditor(undefined);
      setSaveError(false);
    } else {
      setSaveError(true);
    }
  }

  async function showPreview(recipeId: number, count: number) {
    setEditor(undefined);
    setPreview({ count, recipeId, result: await onPreview(recipeId, count) });
  }

  return (
    <dialog
      aria-labelledby="recipe-management-title"
      className="always-in-stock-dialog recipe-dialog"
      onCancel={cancelDialog}
      onClose={synchronizeClosedDialog}
      ref={dialogRef}
    >
      <div className="always-in-stock-dialog-header">
        <h2 id="recipe-management-title">{labels.manageRecipes}</h2>
        <button aria-label={labels.close} onClick={onClose} type="button">×</button>
      </div>
      <label className="always-in-stock-search">
        <span>{labels.searchRecipes}</span>
        <input aria-label={labels.searchRecipes} onChange={(event) => setSearch(event.target.value)} type="search" value={search} />
      </label>
      <div className="always-in-stock-definition-actions">
        <button disabled={products.length === 0} onClick={startCreate} type="button">{labels.addRecipe}</button>
      </div>
      {products.length === 0 ? <p>{labels.noProductsForRecipes}</p> : null}
      {visibleRecipes.length === 0 && products.length > 0 ? <p>{labels.noRecipes}</p> : null}
      <ul aria-label={labels.recipes} className="always-in-stock-definitions recipe-list">
        {visibleRecipes.map((recipe) => (
          <li className="always-in-stock-definition" key={recipe.id}>
            <div>
              <strong>{recipe.name}</strong>
              {recipe.note ? <span>{recipe.note}</span> : null}
              <small>{recipe.requirements.length} {labels.ingredient}</small>
              {recipe.archived ? <small>{labels.archived}</small> : null}
            </div>
            <div className="always-in-stock-definition-actions">
              <button aria-label={`${labels.preview} ${recipe.name}`} disabled={recipe.archived} onClick={() => void showPreview(recipe.id, 1)} type="button">{labels.preview}</button>
              <button aria-label={`${labels.editRecipe} ${recipe.name}`} onClick={() => startEdit(recipe)} type="button">{labels.editRecipe}</button>
              <button aria-label={`${recipe.archived ? labels.restore : labels.archive} ${recipe.name}`} onClick={() => void onArchive(recipe.id, !recipe.archived)} type="button">
                {recipe.archived ? labels.restore : labels.archive}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editor ? (
        <form aria-label={editor.recipeId === undefined ? labels.addRecipe : labels.editRecipe} className="always-in-stock-editor recipe-editor" onSubmit={(event) => void saveRecipe(event)}>
          <h3>{editor.recipeId === undefined ? labels.addRecipe : labels.editRecipe}</h3>
          <label><span>{labels.recipeName}</span><input aria-label={labels.recipeName} onChange={(event) => setEditor({ ...editor, name: event.target.value })} required value={editor.name} /></label>
          <label><span>{labels.note}</span><textarea aria-label={labels.note} onChange={(event) => setEditor({ ...editor, note: event.target.value })} value={editor.note} /></label>
          <div className="recipe-requirements">
            {editor.requirements.map((requirement, index) => (
              <fieldset aria-label={`${labels.ingredient} ${index + 1}`} key={index}>
                <legend>{labels.ingredient} {index + 1}</legend>
                <label>
                  <span>{labels.product}</span>
                  <select aria-label={labels.product} onChange={(event) => updateRequirement(index, { productId: Number(event.target.value) })} required value={requirement.productId || ""}>
                    <option value="">{labels.product}</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                  </select>
                </label>
                <label><span>{labels.amount}</span><input aria-label={labels.amount} min="0.000001" onChange={(event) => updateRequirement(index, { amount: Number(event.target.value) })} required step="any" type="number" value={requirement.amount} /></label>
                <label>
                  <span>{labels.unitLabel}</span>
                  <select aria-label={labels.unitLabel} onChange={(event) => {
                    if (isRecipeUnit(event.target.value)) updateRequirement(index, { unit: event.target.value });
                  }} value={requirement.unit}>
                    {recipeUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>
                {editor.requirements.length > 1 ? <button aria-label={`${labels.removeIngredient} ${index + 1}`} onClick={() => setEditor({ ...editor, requirements: editor.requirements.filter((_, requirementIndex) => requirementIndex !== index) })} type="button">{labels.removeIngredient}</button> : null}
              </fieldset>
            ))}
          </div>
          <div className="always-in-stock-editor-actions">
            <button onClick={() => setEditor({ ...editor, requirements: [...editor.requirements, defaultRequirement()] })} type="button">{labels.addIngredient}</button>
            <button type="submit">{labels.save}</button>
            <button onClick={() => setEditor(undefined)} type="button">{labels.cancel}</button>
          </div>
          {saveError ? <p className="error" role="alert">{labels.saveRecipeFailed}</p> : null}
        </form>
      ) : null}
      {preview ? (
        <section aria-label={labels.recipePreview} className="recipe-preview">
          <label><span>{labels.recipeCount}</span><input aria-label={labels.recipeCount} min="1" onChange={(event) => void showPreview(preview.recipeId, Number(event.target.value))} step="1" type="number" value={preview.count} /></label>
          <ul>
            {preview.result?.lines.map((line) => {
              const product = products.find((candidate) => candidate.id === line.productId);
              return <li key={line.productId}>{product?.name} {formatAmount(line.amount)} {line.unit}</li>;
            })}
          </ul>
        </section>
      ) : null}
    </dialog>
  );
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? amount.toFixed(0) : String(Number(amount.toFixed(6)));
}
