"""
LangGraph compatibility layer - handles API differences across versions
"""
import logging
from typing import Any, Dict, Type

logger = logging.getLogger(__name__)

def get_langgraph_imports():
    """Discover correct LangGraph imports based on installed version"""
    try:
        # Try new API first (0.0.60+)
        from langgraph.graph import StateGraph, START, END
        from langgraph.graph.message import add_messages
        logger.info("Using LangGraph new API (0.0.60+)")
        return {
            'StateGraph': StateGraph,
            'START': START,
            'END': END,
            'add_messages': add_messages,
            'api_version': 'new'
        }
    except ImportError:
        try:
            # Try old API (0.0.40-0.0.59)
            from langgraph import StateGraph
            from langgraph.prebuilt import ToolExecutor
            logger.info("Using LangGraph old API (0.0.40-0.0.59)")
            return {
                'StateGraph': StateGraph,
                'START': '__start__',
                'END': '__end__',
                'add_messages': None,
                'api_version': 'old'
            }
        except ImportError as e:
            logger.error(f"Failed to import LangGraph: {e}")
            raise ImportError(f"LangGraph not properly installed: {e}")

def create_workflow(state_class: Type, api_version: str = None):
    """Create workflow with version-appropriate API"""
    imports = get_langgraph_imports()

    if imports['api_version'] == 'new':
        workflow = imports['StateGraph'](state_class)
        return workflow, imports['START'], imports['END']
    else:
        # Handle old API
        workflow = imports['StateGraph'](state_class)
        return workflow, '__start__', '__end__'