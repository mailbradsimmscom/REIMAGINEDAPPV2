# Supply Sheet - Fill-In Guide

**File:** `Supply Sheet - NEW STRUCTURE.csv`
**Use:** Import into Google Sheets and fill in your data

---

## 📋 COLUMN DEFINITIONS

### 1. **Main Category** (Required)
The high-level grouping from your original section headers.

**Examples:**
- Plumbing
- Engine Service/Spares
- Tools
- Electrical
- Watermaker
- Safety
- Deck Equipment
- Cleaning
- Lines and Rigging
- General

**From your original data:** Section header rows like "Plumbing", "Integrel", "Other"

---

### 2. **Item Type** (Required)
Choose ONE: `Supply`, `Tool`, or `Item`

**Supply** = Consumable that needs reordering
- Filters, oil, hose, fittings, tape, batteries, cleaning supplies
- Has stock that depletes
- Examples: Oil filter, Sika sealant, hose clamps

**Tool** = Reusable equipment (don't reorder)
- Bolt cutters, multi meter, pumps, wrenches, measuring tools
- Track condition, not stock quantity
- Examples: Bolt cutters, multi meter, grommets punch

**Item** = Asset to track (don't reorder)
- Covers, lines, safety gear, equipment
- Track existence, condition, expiry
- Examples: Hatch covers, life jackets, soft shackles

---

### 3. **Item Name** (Required)
Clean, descriptive name without quantity.

**Good:**
- "Oil Filter (50hr Service Kit)"
- "Hatch cover (grey cloth)"
- "RO tubing (0.25 inch)"

**Bad:**
- "2m Anchor rope" ← Qty should be in Quantity column
- "50hr Service Kit: Oil Filter" ← Awkward format

---

### 4. **Quantity** (Required)
How many units you have. Must be a NUMBER.

**Good:** `1`, `2`, `15`, `1.5`
**Bad:** `3/4 bag`, `Multiple`, `many`, blank

**If you don't know:** Put `1` as default

---

### 5. **Unit** (Required)
Standardized unit of measurement.

**Standard Units:**
- `piece` (default for most items)
- `meter` (not "metre")
- `foot` (not "feet" or "ft")
- `liter` (not "l")
- `roll`
- `bag`
- `bottle`
- `can`
- `pack`
- `tube`
- `box`
- `set`
- `pair`

**If blank in original:** Use `piece`

---

### 6. **Brand** (Optional)
Manufacturer/brand name if known.

**Examples:** WIX, Racor, Gorilla, Sika, Victron, Harken, Vetus, Schenker

**Leave blank if unknown**

---

### 7. **Part Number** (Optional)
Model or part number if known.

**Examples:** 51515, FCC-5, BE1454, 8PK1330HD

**Leave blank if unknown**

---

### 8. **Subcategory** (Optional)
More specific grouping (from your old "Part/Area" column).

**Examples:**
- Engine
- Hosetail fittings
- Bilges
- Watermaker
- Hose Clamps
- Hand Tools
- Covers
- Rigging

**From your original data:** "Part/Area" column

---

### 9. **Supplier** (Optional)
Where you buy this item.

**Examples:** Seascape Marine, West Marine, Commercial Marine, Plumblink, Agrico, Vetus

**From your original data:** "Supplier" column (keep as-is)

---

### 10. **Location** (Required)
Where it's physically stored on the boat.

**Examples:**
- Port storage 0
- Strbd bath above toilet
- Stern bench
- Portside watermaker cupboard
- Nav Station Stbd Top

**From your original data:** "Where stored?" column

---

### 11. **Reorder Threshold** (Optional - Supplies only)
Minimum quantity before reordering. Leave blank for Tools/Items.

**Recommended:**
- Critical items (filters, oil): `1` or `2`
- Common supplies: `2` to `5`
- Bulk items: `10` or more
- Tools/Items: Leave blank

---

### 12. **Condition** (Optional - Tools/Items only)
Current state. Leave blank for Supplies.

**Values:** `Excellent`, `Good`, `Fair`, `Needs Repair`, `Needs Inspection`

**For Tools/Items only** - not needed for consumable supplies

---

### 13. **Notes** (Optional)
Any additional information.

**Examples:**
- "For routine maintenance"
- "Inspect annually"
- "Heavy duty"
- "Compatible with Newport 400"

---

### 14. **Critical Item** (Optional)
Does this affect safety or critical boat operation?

**Values:** `Yes`, `No`, or blank

**Critical = Yes examples:**
- Life jackets
- Fire extinguisher
- Engine filters
- Bilge pump parts
- Navigation lights

---

### 15. **In Stock** (Required)
Do you currently have this item?

**Values:**
- `Yes` ← If your old "Inventory Feb5/25" = "x"
- `No` ← If you don't have it
- Blank ← If unknown

---

## 🔄 CONVERSION FROM OLD CSV

### Old → New Mapping:

| Old Column | New Column | Notes |
|------------|------------|-------|
| (Section header rows) | Main Category | Copy header to all rows below it until next header |
| Qty | Quantity | Clean up "3/4 bag", "Multiple", blanks |
| Unit | Unit | Standardize: metre→meter, l→liter, ft→foot |
| Description | Item Name | Clean up, remove quantities from name |
| Supplier | Supplier | Keep as-is |
| Part/Area | Subcategory | Rename |
| Where stored? | Location | Keep as-is |
| Need to Order | DELETE | Not needed (use Reorder Threshold instead) |
| Inventory Feb5/25 | In Stock | "x" = Yes, else No |
| (new) | Item Type | You determine: Supply/Tool/Item |
| (new) | Brand | Extract from Description or add manually |
| (new) | Part Number | Extract from Description or add manually |
| (new) | Reorder Threshold | Set for Supplies only |
| (new) | Condition | Set for Tools/Items only |
| (new) | Notes | Add any relevant info |
| (new) | Critical Item | You decide |

---

## ✅ VALIDATION CHECKLIST

Before importing to database, verify:

- [ ] All rows have **Main Category**
- [ ] All rows have **Item Type** (Supply/Tool/Item)
- [ ] All rows have **Item Name**
- [ ] All **Quantity** values are numbers (no "Multiple", "many", etc.)
- [ ] All **Unit** values are standardized
- [ ] All rows have **Location**
- [ ] **Supplies** have **Reorder Threshold** (Tools/Items don't)
- [ ] **Tools/Items** have **Condition** (Supplies don't)
- [ ] All rows have **In Stock** (Yes/No)
- [ ] No section header rows left (they're all converted to Main Category)
- [ ] Delete instruction rows before importing

---

## 📝 QUICK TIPS

### For Each Row:

1. **What section is this under?** → Main Category
2. **Is it consumable?** → Supply | **Reusable tool?** → Tool | **Just tracking it?** → Item
3. **Clean the name** → Remove quantities, standardize format
4. **Fix the quantity** → Must be a number
5. **Standardize unit** → meter not metre, foot not ft
6. **Where is it?** → Location (required!)
7. **If Supply:** Set reorder threshold
8. **If Tool/Item:** Set condition
9. **Is it critical?** → Yes/No
10. **Do we have it?** → Yes/No

---

## 🎯 EXAMPLE TRANSFORMATIONS

### Example 1: Oil Filter (Supply)
**Before:**
```
Qty: 2
Unit: (blank)
Description: 50hr Service Kit: Oil Filter
Supplier: Seascape Marine
Part/Area: Engine
Where stored?: Strbd bath above toilet
Inventory Feb5/25: x
```

**After:**
```
Main Category: Engine Service/Spares
Item Type: Supply
Item Name: Oil Filter (50hr Service Kit)
Quantity: 2
Unit: piece
Brand: (add if known)
Part Number: (add if known)
Subcategory: Engine
Supplier: Seascape Marine
Location: Strbd bath above toilet
Reorder Threshold: 1
Condition: (blank - not needed for supplies)
Notes: For routine maintenance
Critical Item: Yes
In Stock: Yes
```

---

### Example 2: Hatch Covers (Item)
**Before:**
```
Qty: 10
Description: Hatch covers (grey cloth)
Where stored?: Under Brad's outside seat
Inventory Feb5/25: x
```

**After:**
```
Main Category: Deck Equipment
Item Type: Item
Item Name: Hatch cover (grey cloth)
Quantity: 10
Unit: piece
Brand: (blank)
Part Number: (blank)
Subcategory: Covers
Supplier: (blank)
Location: Under Brad's outside seat
Reorder Threshold: (blank - items don't reorder)
Condition: Good
Notes: Spare covers for hatches
Critical Item: No
In Stock: Yes
```

---

### Example 3: Bolt Cutters (Tool)
**Before:**
```
Qty: (blank)
Description: Bolt cutters
Where stored?: Stern bench
Inventory Feb5/25: x
```

**After:**
```
Main Category: Tools
Item Type: Tool
Item Name: Bolt cutters
Quantity: 1
Unit: piece
Brand: (blank)
Part Number: (blank)
Subcategory: Hand Tools
Supplier: (blank)
Location: Stern bench
Reorder Threshold: (blank - tools don't reorder)
Condition: Good
Notes: Heavy duty
Critical Item: Yes
In Stock: Yes
```

---

## 🚨 COMMON MISTAKES TO AVOID

❌ **Don't:** Put quantities in Item Name ("2m rope")
✅ **Do:** Item Name = "Rope", Quantity = 2, Unit = meter

❌ **Don't:** Use "3/4 bag" in Quantity
✅ **Do:** Quantity = 0.75 or 1, Notes = "3/4 full"

❌ **Don't:** Leave Quantity blank
✅ **Do:** Put 1 if you have one, 0 if you don't have any

❌ **Don't:** Mix units (metre, meter, m)
✅ **Do:** Always use "meter"

❌ **Don't:** Set Reorder Threshold for Tools/Items
✅ **Do:** Only Supplies need reorder thresholds

❌ **Don't:** Set Condition for Supplies
✅ **Do:** Only Tools/Items need condition tracking

---

**Questions?** Just ask before you start filling it in!

**When done:** Save as CSV and we'll import it into the database.
