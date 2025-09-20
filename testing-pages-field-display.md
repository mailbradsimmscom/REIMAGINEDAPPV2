# Testing Pages Field Display Analysis

This document shows which database fields are currently displayed vs. hidden on each of the four testing detail pages.

## 1. Specifications Page (`/admin/testing/specifications`)



### ✅ Currently Displayed Fields
- **manufacturer_norm** - Normalized manufacturer name from systems table
- **model_norm** - Normalized model name from systems table
- **parameter** - Original parameter name from manual
- **units** - Original units from document
- **range** - Min/max if applicable
- **value** - Numeric value or text as stated
- **normalized_parameter** - Standardized parameter name (lowercase, underscores)
- **search_terms** - All possible ways users might ask about this (array)
- **parameter_aliases** - Alternative names/terms for same concept (array)
- **normalized_units** - Standard SI or common units
- **converted_value** - Value in normalized units if conversion needed
- **category** - Power/Electrical/Dimensions/Performance/Environmental/Installation

### ❌ Hidden Fields (Not Displayed)
- **id** - UUID primary key
- **doc_id** - Document ID
- **asset_uid** - Foreign key linking to systems table
- **description** - Description mapped from models JSON array
- **confidence** - Confidence score (0-1)
- **status** - pending/approved
- **created_at** - Creation timestamp
- **updated_at** - Last update timestamp
- **approved_at** - Approval timestamp

---

## 2. Playbook Hints Page (`/admin/testing/playbook`)


### ✅ Currently Displayed Fields
- **title** - Procedure title
- **preconditions** - Prerequisites before starting (array)
- **steps** - Array of step descriptions (displayed as numbered list)
- **expected_outcome** - Expected result of the procedure
- **error_codes** - Possible error codes (array)
- **manufacturer_norm** - Normalized manufacturer name from systems table
- **model_norm** - Normalized model name from systems table
- **description** - Description mapped from models JSON array

### ❌ Hidden Fields (Not Displayed)
- **id** - UUID primary key
- **doc_id** - Document ID
- **asset_uid** - Foreign key linking to systems table
- **category** - Category classification
- **system_norm** - Normalized system name from systems table
- **subsystem_norm** - Normalized subsystem name from systems table
- **page** - Page number reference
- **confidence** - Confidence score (0-1)
- **status** - pending/approved
- **created_at** - Creation timestamp
- **updated_at** - Last update timestamp
- **bbox** - Bounding box coordinates for document location

---

## 3. Intent Router Page (`/admin/testing/intent-router`)


### ✅ Currently Displayed Fields
- **question** - Natural language question (primary version)
- **question_variations** - Alternative ways to ask the same thing (array)
- **answer** - Direct, complete answer with specific details
- **question_type** - What/How/When/Where/Why classification
- **references** - Page numbers, sections, or related procedures (array)
- **manufacturer_norm** - Normalized manufacturer name from systems table
- **model_norm** - Normalized model name from systems table
- **models** - Which models this applies to (array)
- **description** - Description mapped from models JSON array

### ❌ Hidden Fields (Not Displayed)
- **id** - UUID primary key
- **doc_id** - Document ID

- **asset_uid** - Foreign key linking to systems table
- **confidence** - Confidence score (0-1)
- **status** - pending/approved
- **created_at** - Creation timestamp
- **updated_at** - Last update timestamp
- **created_by** - Admin user who created this entry

---

## 4. Golden Tests Page (`/admin/testing/golden-tests`)


### ✅ Currently Displayed Fields
- **query** - The question/condition being tested
- **expected** - Expected result/answer
- **test_method** - How to verify this test
- **failure_indication** - What it means if this fails
- **related_procedures** - Connected procedures or specs (array)
- **description** - Description mapped from models JSON array
- **manufacturer_norm** - Normalized manufacturer name from systems table
- **model_norm** - Normalized model name from systems table


### ❌ Hidden Fields (Not Displayed)
- **id** - UUID primary key
- **doc_id** - Document ID

- **asset_uid** - Foreign key linking to systems table
- **page** - Page number reference
- **confidence** - Confidence score (0-1)
- **status** - pending/approved
- **created_at** - Creation timestamp
- **updated_at** - Last update timestamp
- **approved_by** - Admin user who approved (shows "Not approved" if null)
- **approved_at** - Approval timestamp (shows "Not approved" if null)

---

## Summary of Most Commonly Hidden Fields

The following fields are hidden across **all four pages**:
- `id` - UUID primary key
- `doc_id` - Document ID
- `manufacturer_norm` - Normalized manufacturer name
- `model_norm` - Normalized model name
- `asset_uid` - Asset UUID reference
- `confidence` - Confidence score
- `status` - pending/approved status
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp

## Notes

- **Confidence scores** are shown as badges in the item headers but not as separate fields
- **Manufacturer/Model** information is shown in the meta line but not as separate fields
- **Timestamps** are shown in the meta line (creation date) but not as separate fields
- **Status** is implied by the fact that we're only showing pending items
- **Page numbers** are shown in the meta line but not as separate fields

## Recommendations for Adding Fields

If you want to add any of these hidden fields, consider:
1. **System fields** (`manufacturer_norm`, `model_norm`, `asset_uid`) - Could be useful for filtering/sorting
2. **Confidence scores** - Already shown as badges, could add as a sortable field
3. **Timestamps** - Could be useful for audit trails
4. **Page references** - Could be useful for document navigation
5. **Status** - Could be useful if showing both pending and approved items


