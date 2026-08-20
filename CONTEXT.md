# Handleliste

Handleliste is a shared household shopping list organized around the physical journey through one store.

## Language

**Shopping List**:
The household's single shared collection of things to buy.
_Avoid_: Private list, personal list

**Shopping Trip**:
The current lifecycle of the Shopping List, including its active and completed items, selected Recipes, Always in Stock selections, accepted shortages, organization, and manual adjustments. Starting a new Shopping Trip discards this state after warning the household while preserving reusable definitions and configuration.
_Avoid_: Parallel list

**Shopping Item**:
A requested numeric quantity of a Product in one selected Package Option.
_Avoid_: Product

**Product Group**:
All Shopping Items for one Product, kept together for display and assigned one place during Organization even when they use different Package Options.
_Avoid_: Store section, merged package

**Quick Entry**:
A single text entry that may contain a Product name, Quantity, Package Size, and Unit, such as "Chorizo 300g." The parser turns recognized values into Product and Shopping Item data without opening a setup form.
_Avoid_: Product setup form, advanced entry

**Product**:
A stable identity for something the household buys, such as milk or bread. When no size is specified, the application supplies "1 unit." An explicit merge combines matching Package Options and moves every reference and contribution to the surviving Product.
_Avoid_: Shopping item, known item

**Package Option**:
One configured size and unit in which a Product can be bought, such as 1 L or 1.75 L. Shopping Items for the same Product merge only when their Package Options also match; a referenced option is archived rather than destructively deleted.
_Avoid_: Quantity, amount

**Default Package Option**:
The Package Option selected when Quick Entry has no explicit size. A new Product gets an implicit "1 unit" option, so the user does not have to configure one. Changing the default never changes existing Shopping Items.
_Avoid_: Suggested size

**Quantity**:
The numeric number of packages requested for a Shopping Item.
_Avoid_: Package size, unit

**Recipe**:
A reusable, already-sized shopping calculation containing a name, optional short note, and Ingredient Requirements for one preparation. A positive whole-number Recipe count multiplies its requirements; cooking instructions and meal planning are outside this concept.
_Avoid_: Item group, product bundle

**Selected Recipe**:
A Recipe and whole-number count included in the current Shopping Trip. It remains visible and adjustable, and changes recalculate only Recipe-Generated Supply.
_Avoid_: Added recipe, recipe item

**Ingredient Requirement**:
The measured amount and unit of a specific Product required by a Recipe, such as 200 g of mozzarella. Its unit must be deterministically convertible to the measurement dimension of that Product's Package Options.
_Avoid_: Package option, shopping item

**Recipe Demand**:
The total measured amount of a Product required by all selected Recipe counts. A participating Product shows "Recipes need" with either "Outside recipes" or "Missing for recipes." A per-Recipe breakdown explains the total, while package quantities remain the main shopping instruction.
_Avoid_: Package quantity

**Always in Stock**:
A household-configured checklist of Products it regularly buys, each with a Package Option and default Quantity. Its selections and adjusted quantities are remembered throughout the Shopping Trip and reset for the next one; it does not track current household inventory.
_Avoid_: Inventory, item group

**Planned Supply**:
The measured capacity of a Product already represented by packages on the Shopping List, regardless of whether they were added manually or through Always in Stock. When a Recipe is selected, its demand consumes the Planned Supply available at that time; a shortfall adds whole packages of the Product's Default Package Option.
_Avoid_: Household inventory, consumed purchase

**Recipe Planning Baseline**:
The Planned Supply present when the first Recipe is selected during a Shopping Trip. Recipe calculations use this fixed baseline so later household additions remain extra rather than replacing Recipe-Generated Supply.
_Avoid_: Live inventory

**Recipe-Generated Supply**:
Packages added to cover a Recipe shortfall. Recipe changes may remove only this supply; manual and Always in Stock contributions remain untouched, and later additions do not reduce it automatically.
_Avoid_: Continuously optimized supply

**Manual Adjustment**:
A household member's relative increase or decrease to a calculated Shopping Item quantity. It remains relative as other calculated contributions change; a decrease that causes a Recipe shortage requires confirmation.
_Avoid_: Absolute override

**Accepted Shortage**:
A household member's Shopping Trip-specific confirmation that reducing or removing supply may leave current Recipe Demand unmet instead of adding a replacement automatically. A relevant change to selected Recipes or their counts invalidates it.
_Avoid_: Inventory deduction

**Purchased Supply**:
The capacity of completed Shopping Items that continues to satisfy Recipe demand for the rest of the Shopping Trip, including after completed rows are cleared from view.
_Avoid_: Current inventory

**Store Layout**:
The household's free-form instructions describing the order and grouping of sections in its usual store.
_Avoid_: Store profile

**Store Section**:
A named area invented during Organization to group nearby Shopping Items according to the Store Layout.
_Avoid_: AI category

**Unorganized**:
The prominent section above organized Store Sections containing active Shopping Items added after the latest Organization.
_Avoid_: Other

**Organization**:
An on-demand arrangement of Product Groups into ordered Store Sections according to the Store Layout, without changing item names, amounts, or units. It assigns locations to active and Completed Items alike.
_Avoid_: Rewrite, normalization

**Manual Organization Change**:
A change a household member makes to the section or position of an organized Shopping Item. A later Organization may replace these changes, but only after warning the user.
_Avoid_: Learned preference, permanent rule

**Completed Item**:
A Shopping Item that a household member has marked as obtained. Completed Items remain in a newest-first section at the bottom while retaining their organized location, so undoing completion restores them to the correct Store Section. Clearing them removes their rows with a short-lived Undo while their Purchased Supply remains for the Shopping Trip.
_Avoid_: Deleted item, purchase history
