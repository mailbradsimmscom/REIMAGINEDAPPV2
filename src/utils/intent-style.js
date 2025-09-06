// Intent detection utility for determining response style
// Maps user questions to appropriate style presets

/**
 * Determines the appropriate style preset based on the user's question
 * @param {string} question - The user's question
 * @returns {'specBrief'|'steps'|'bullets3'|'brief'|'technical'} - The style preset to use
 */
export function decideStyle(question) {
  if (!question || typeof question !== 'string') {
    return 'brief';
  }

  const lowerQuestion = question.toLowerCase().trim();

  // Spec brief: Questions asking for specific technical specifications
  const specKeywords = /\b(psi|bar|v|volt|a|amp|hz|°c|°f|kw|w|rpm|kpa|l\/h|l\/min|gph|gpm|nm|pressure|voltage|amperage|wattage|capacity|size|dimensions|weight|temperature|speed|flow|rate|specifications?|specs?)\b/;
  if (specKeywords.test(lowerQuestion)) {
    return 'specBrief';
  }

  // Steps: How-to questions and procedural requests
  const stepsKeywords = /^(how (do|to)\b|steps?|procedure|reset|flush|prime|bleed|replace|install|setup|mount|start|stop|operate|use|run|configure)/;
  if (stepsKeywords.test(lowerQuestion)) {
    return 'steps';
  }

  // Bullets3: Troubleshooting and problem-solving questions
  const troubleshootingKeywords = /\b(not working|error|alarm|leak|noisy|fails?|won't|broken|problem|issue|troubleshoot|fix|repair|diagnose|what's wrong|why isn't|why doesn't)\b/;
  if (troubleshootingKeywords.test(lowerQuestion)) {
    return 'bullets3';
  }

  // Technical: Direct requests for technical information
  const technicalKeywords = /\b(technical|specifications?|specs?|details?|parameters?|settings?|configuration|manual|documentation)\b/;
  if (technicalKeywords.test(lowerQuestion)) {
    return 'technical';
  }

  // Default to brief for general questions
  return 'brief';
}

/**
 * Gets a random opening phrase for the given style
 * @param {string} style - The style preset
 * @returns {string} - A random opening phrase
 */
export function getStyleOpening(style) {
  const openings = {
    specBrief: ["Based on the specifications:", "The technical data shows:"],
    steps: ["Here's the procedure:", "Follow these steps:"],
    bullets3: ["Let's troubleshoot this:", "Here's the diagnosis:"],
    brief: ["Here's what I found:", "Based on the information:"],
    technical: ["Technical specifications:", "Equipment details:"]
  };

  const styleOpenings = openings[style] || openings.brief;
  return styleOpenings[Math.floor(Math.random() * styleOpenings.length)];
}

export default {
  decideStyle,
  getStyleOpening
};
