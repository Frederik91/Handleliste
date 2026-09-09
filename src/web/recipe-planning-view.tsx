import { useState } from "react";
import type { Recipe } from "../domain/recipe.js";
import type { RecipeDemand, RecipeSelectionInput, SelectedRecipe } from "../domain/recipe-planning.js";
import { useModalDialog } from "./use-modal-dialog.js";

export interface RecipePlanningLabels {
  planRecipes: string; selectedRecipes: string; select: string; recipeCount: string;
  save: string; close: string; recipeSelectionFailed: string; recipesNeed: string;
  outsideRecipes: string; missingRecipes: string; recipeBreakdown: string;
  clearedPurchased: string; baseline: string; recipes: string;
}
export function RecipeTripSelection({ open, onClose, recipes, selections, onSave, labels }: {
  open: boolean; onClose(): void; recipes: readonly Recipe[]; selections: readonly SelectedRecipe[];
  onSave(inputs: RecipeSelectionInput[]): Promise<boolean>; labels: RecipePlanningLabels;
}) {
  const { dialogRef, cancelDialog, synchronizeClosedDialog } = useModalDialog(open, closeSelection);
  function closeSelection() {
    dialogRef.current?.close();
    onClose();
  }
  const [draft, setDraft] = useState<RecipeSelectionInput[]>(() => selections.map(({ recipeId, count }) => ({ recipeId, count })));
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  return <dialog aria-label={labels.planRecipes} className="always-in-stock-dialog recipe-dialog" ref={dialogRef} onCancel={cancelDialog} onClose={synchronizeClosedDialog}>
    <div className="always-in-stock-dialog-header"><h2>{labels.planRecipes}</h2><button aria-label={labels.close} onClick={closeSelection} type="button">×</button></div>
    <form onSubmit={(event) => {
      event.preventDefault(); setSaving(true);
      void onSave(draft).then((saved) => { setSaving(false); setError(!saved); if (saved) closeSelection(); });
    }}>
      {recipes.filter((recipe) => !recipe.archived || selections.some((selection) => selection.recipeId === recipe.id)).map((recipe) => {
        const selection = draft.find((candidate) => candidate.recipeId === recipe.id);
        return <div className="recipe-selection" key={recipe.id}>
          <label><input type="checkbox" aria-label={`${labels.select} ${recipe.name}`} checked={!!selection} onChange={(event) => setDraft(event.target.checked ? [...draft, { recipeId: recipe.id, count: 1 }] : draft.filter((candidate) => candidate.recipeId !== recipe.id))} />{recipe.name}</label>
          {selection ? <label>{labels.recipeCount}<input aria-label={`${labels.recipeCount} ${recipe.name}`} type="number" min="1" step="1" required value={selection.count} onChange={(event) => setDraft(draft.map((candidate) => candidate.recipeId === recipe.id ? { ...candidate, count: Number(event.target.value) } : candidate))} /></label> : null}
        </div>;
      })}
      {error ? <p role="alert">{labels.recipeSelectionFailed}</p> : null}
      <button disabled={saving} type="submit">{labels.save}</button>
    </form>
  </dialog>;
}
const amount = (value: number) => String(Number(value.toFixed(6)));
export function RecipeDemandSummary({ demand, labels }: { demand: RecipeDemand; labels: RecipePlanningLabels }) {
  const extra = demand.supply - demand.amount;
  return <div className="recipe-demand">
    <p>{labels.recipesNeed} {amount(demand.amount)} {demand.unit} · {extra >= -1e-9 ? labels.outsideRecipes : labels.missingRecipes} {amount(Math.abs(extra))} {demand.unit}</p>
    <details><summary>{labels.recipeBreakdown}</summary>
      {demand.contributions.map((recipe) => <p key={recipe.recipeId}>{recipe.name} × {recipe.count}: {amount(recipe.amount)} {demand.unit}</p>)}
      <p>{labels.baseline}: {amount(demand.baseline)} {demand.unit}</p>
      {demand.clearedPurchased > 0 ? <p>{labels.clearedPurchased}: {amount(demand.clearedPurchased)} {demand.unit}</p> : null}
    </details>
  </div>;
}
