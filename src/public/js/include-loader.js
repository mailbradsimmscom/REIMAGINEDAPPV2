/**
 * Tiny HTML include loader
 * Fetches HTML partials and injects them into elements with data-include attributes
 */
export async function hydrateIncludes(root = document) {
  const nodes = [...root.querySelectorAll("[data-include]")];
  await Promise.all(nodes.map(async (el) => {
    const url = el.getAttribute("data-include");
    if (!url) return;
    
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Failed include ${url}: ${res.status}`);
      
      el.innerHTML = await res.text();
      
      // Recursively hydrate nested includes
      await hydrateIncludes(el);
    } catch (err) {
      el.innerHTML = `<div class="include-error">Include error: ${url}</div>`;
      console.error('Include error:', err);
    }
  }));
}
