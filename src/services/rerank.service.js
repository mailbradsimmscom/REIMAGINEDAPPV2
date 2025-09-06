import { oaiJson } from '../clients/openai.client.js';
import { logger } from "../utils/logger.js";

const requestLogger = logger.createRequestLogger();

export async function rerankChunks(question, chunks) {
  if (chunks.length <= 1) return chunks.map((c, i) => ({ ...c, _rankScore: 1 - i * 0.01 }));

  try {
    requestLogger.info('Starting chunk reranking', { 
      question: question.substring(0, 100),
      chunksCount: chunks.length 
    });

    // Build compact candidates payload: index + snippet
    const items = chunks.map((h, i) => {
      const text = (h?.chunk?.content ?? h?.metadata?.content ?? h?.content ?? "").slice(0, 800);
      return `#${i+1}: ${text}`;
    }).join("\n\n");

    const system = "You are a precise selector. Pick the SINGLE best chunk that most directly answers the question. If multiple are good, pick the most specific spec line. Return JSON with {\"best\": <index starting at 1>, \"reasons\": \"...\"}.";
    const user = `Question:\n${question}\n\nCandidates:\n${items}\n\nReturn only JSON.`;

    let best = 1;
    try {
      const out = await oaiJson({
        system,
        user,
        maxOutputTokens: 100,
        seed: 11
      });
      if (Number.isInteger(out?.best) && out.best >= 1 && out.best <= chunks.length) {
        best = out.best;
        requestLogger.info('LLM reranking completed', { 
          selectedIndex: best,
          reasons: out.reasons?.substring(0, 100)
        });
      }
    } catch (error) {
      requestLogger.warn('LLM reranking failed, using first chunk', { 
        error: error.message 
      });
    }

    // Place chosen first, keep others stable
    const chosen = chunks[best - 1];
    const rest = chunks.filter((_, idx) => idx !== (best - 1));
    const reranked = [chosen, ...rest].map((c, i) => ({ ...c, _rankScore: 1 - i * 0.01 }));

    requestLogger.info('Chunk reranking completed', { 
      originalCount: chunks.length,
      rerankedCount: reranked.length,
      selectedIndex: best
    });

    return reranked;

  } catch (error) {
    requestLogger.error('Chunk reranking failed', { 
      error: error.message,
      chunksCount: chunks.length 
    });
    
    // Fallback: return chunks with simple scoring
    return chunks.map((c, i) => ({ ...c, _rankScore: 1 - i * 0.01 }));
  }
}
