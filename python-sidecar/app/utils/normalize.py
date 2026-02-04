"""
Shared normalization utilities for model key matching.

Must produce identical output to Node's normalizeModelKey() in
src/utils/normalize-model-key.js.
"""

import re


def normalize_model_key(raw: str) -> str:
    """
    Normalize a model key for canonical matching.

    Rules: uppercase, strip all whitespace (including tabs/newlines),
    hyphens, and underscores.

    Examples:
        "VC 20"         -> "VC20"
        "FUSION-LINK"   -> "FUSIONLINK"
        "ZEN 150 48VDC" -> "ZEN15048VDC"
        "B70770"        -> "B70770"
    """
    if not raw:
        return ""
    return re.sub(r'[\s\-_]', '', raw.upper())
