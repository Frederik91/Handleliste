# Recipe planning

Use **Manage Recipes** to create reusable Recipes with measured Ingredient Requirements. **Plan from Recipes** selects Recipes and positive whole-number counts for the current Shopping Trip. Selected Recipes remain visible above the Shopping List.

The first selection captures the measured capacity of all packages already planned, including Always in Stock, completed rows, and cleared Purchased Supply. This Recipe Planning Baseline stays fixed until a new Shopping Trip, even if all Recipes are deselected or a Package Option is edited.

Recipe Demand combines compatible units by Product. A shortfall adds whole Default Package Option packages. Package rows show separate baseline and Recipe-generated quantities; later household additions remain extra. Changing a Recipe count or deselecting a Recipe recalculates its Products and removes only active Recipe-Generated Supply. Completed and cleared generated packages remain Purchased Supply.

Each participating Product shows **Recipes need** and either **Outside recipes** or **Missing for recipes**. **Recipe breakdown** lists each Recipe's contribution, the captured baseline, and relevant cleared purchases. The explanation remains available when no active package row remains.

Selections, their captured Ingredient Requirements, baseline measurements, and generated quantities persist in SQLite and update other household sessions. Editing a reusable Recipe does not silently change an existing selection; deselecting and selecting it again uses the updated definition. Starting a new Shopping Trip clears planning and purchases while keeping reusable Recipes, Products, and Always in Stock definitions.

Relative Manual Adjustments, Accepted Shortage confirmations, and confirmation workflows for changing selected Recipe definitions belong to issue #9. For now, reducing supply can show **Missing for recipes** without automatically replacing those packages.

Browser acceptance coverage is in `tests/acceptance/recipe-planning.spec.ts`; it runs against the complete application, temporary SQLite storage, and the Home Assistant Ingress test boundary.
