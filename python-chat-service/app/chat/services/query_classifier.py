"""
Query classification service for routing to appropriate DIP tables
"""
import re
from typing import Dict, List, Tuple
from ..models import QueryClassification


class QueryClassifier:
    """Classifies user queries to route to appropriate DIP tables"""

    def __init__(self):
        self.patterns = {
            "spec": [
                r"what\s+(is|are)\s+the\s+(spec|specification|rating|dimension|capacity|power|pressure|flow|temperature|size)",
                r"how\s+(much|many|big|fast|hot|cold|heavy|wide|tall|long)",
                r"(spec|specification|rating|dimension|capacity|power|pressure|flow|temperature|size|weight|voltage|amperage|btu|cfm|psi|gpm)",
                r"what.*?(rated|maximum|minimum|max|min|nominal)",
                r"(operating\s+range|specifications|technical\s+data|performance\s+data)",
            ],

            "procedure": [
                r"how\s+(do|to|can|should)\s+(i|you|we)",
                r"(step|procedure|instruction|guide|manual|process)",
                r"(install|setup|configure|calibrate|adjust|operate|run|start|stop|turn\s+on|turn\s+off)",
                r"(replace|repair|fix|maintain|service|clean)",
                r"what.*?(steps|procedure|process|method)",
                r"(maintenance|installation|operation|startup|shutdown)",
            ],

            "troubleshooting": [
                r"(problem|issue|error|fault|trouble|fail|broken|not\s+working|malfunction)",
                r"(why|what.*wrong|what.*happened|diagnose|troubleshoot|fix|solve)",
                r"(alarm|warning|code|message|alert)",
                r"(won't|can't|doesn't|isn't|aren't)\s+(work|start|run|function|operate)",
                r"(diagnostic|error\s+code|fault\s+code|troubleshooting)",
            ],

            "routing": [
                r"what\s+(is|are|does)",
                r"(tell\s+me\s+about|explain|describe|define)",
                r"(manual|documentation|guide|help|info|information)",
                r"(overview|summary|general\s+information)",
            ]
        }

        # Table mapping
        self.table_mapping = {
            "spec": ["spec_suggestions"],
            "procedure": ["playbook_hints"],
            "troubleshooting": ["golden_tests"],
            "routing": ["intent_router"],
            "general": ["intent_router", "spec_suggestions", "playbook_hints"]
        }

    def classify(self, query: str, equipment_context: Dict = None, conversation_summary: str = "") -> QueryClassification:
        """
        Classify a user query into categories and determine target tables

        Args:
            query: User's query string
            equipment_context: Optional equipment context from conversation memory
            conversation_summary: Optional conversation summary for context

        Returns:
            QueryClassification with primary category, confidence, and target tables
        """
        query_lower = query.lower()
        scores = {}

        # Score each category
        for category, patterns in self.patterns.items():
            score = self._calculate_category_score(query_lower, patterns)

            # Boost score based on context
            if equipment_context:
                score = self._apply_equipment_context_boost(score, category, equipment_context)

            if conversation_summary:
                score = self._apply_conversation_context_boost(score, category, conversation_summary)

            scores[category] = score

        # Determine primary category
        primary = max(scores, key=scores.get)
        confidence = scores[primary]

        # If no strong classification, default to general
        if confidence < 0.3:
            primary = "general"
            confidence = 0.5

        # Get target tables
        target_tables = self.table_mapping.get(primary, ["intent_router"])

        # Generate reasoning
        reasoning = self._generate_reasoning(query, primary, confidence, scores)

        return QueryClassification(
            primary=primary,
            confidence=confidence,
            scores=scores,
            target_tables=target_tables,
            reasoning=reasoning
        )

    def _calculate_category_score(self, query: str, patterns: List[str]) -> float:
        """Calculate score for a category based on pattern matches"""
        total_matches = 0
        pattern_count = len(patterns)

        for pattern in patterns:
            matches = len(re.findall(pattern, query, re.IGNORECASE))
            total_matches += matches

        # Normalize score (0.0 to 1.0)
        if pattern_count == 0:
            return 0.0

        # Weight by pattern match density
        score = min(total_matches / pattern_count, 1.0)

        # Boost for multiple matches in same query
        if total_matches > 1:
            score = min(score * 1.2, 1.0)

        return score

    def _apply_equipment_context_boost(self, base_score: float, category: str, equipment_context: Dict) -> float:
        """Apply boost based on equipment context from conversation memory"""
        boost_factor = 1.0

        # If we have specific equipment mentioned, boost relevant categories
        if equipment_context.get("manufacturer") or equipment_context.get("model"):
            if category == "spec":
                boost_factor = 1.1  # Specs are more relevant with specific equipment
            elif category == "procedure":
                boost_factor = 1.05  # Procedures are somewhat more relevant

        return min(base_score * boost_factor, 1.0)

    def _apply_conversation_context_boost(self, base_score: float, category: str, summary: str) -> float:
        """Apply boost based on conversation context"""
        boost_factor = 1.0
        summary_lower = summary.lower()

        # Boost based on conversation theme
        if "specification" in summary_lower or "rating" in summary_lower:
            if category == "spec":
                boost_factor = 1.1
        elif "procedure" in summary_lower or "install" in summary_lower:
            if category == "procedure":
                boost_factor = 1.1
        elif "problem" in summary_lower or "troubleshoot" in summary_lower:
            if category == "troubleshooting":
                boost_factor = 1.1

        return min(base_score * boost_factor, 1.0)

    def _generate_reasoning(self, query: str, primary: str, confidence: float, scores: Dict[str, float]) -> str:
        """Generate human-readable reasoning for the classification"""
        top_categories = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:2]

        reasoning = f"Classified as '{primary}' with {confidence:.1%} confidence. "

        if confidence > 0.7:
            reasoning += f"Strong indicators for {primary} category detected."
        elif confidence > 0.4:
            reasoning += f"Moderate indicators for {primary} category."
        else:
            reasoning += f"Weak classification - defaulting to general routing."

        if len(top_categories) > 1 and top_categories[1][1] > 0.3:
            second_category, second_score = top_categories[1]
            reasoning += f" Also detected {second_category} elements ({second_score:.1%})."

        return reasoning