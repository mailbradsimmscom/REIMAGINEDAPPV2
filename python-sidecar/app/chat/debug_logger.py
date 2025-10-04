"""
Chat Debug Logger (Python)
TEMPORARY - Remove after migration is complete

Usage:
    from .debug_logger import chat_debug
    chat_debug.step('STEP_NAME', {'data': 'value'})
"""

import os
import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Check if debug logging is enabled
DEBUG_ENABLED = os.getenv('CHAT_DEBUG_LOGGING', 'false').lower() == 'true'


class ChatDebugLogger:
    """Centralized debug logging for chat migration"""

    @staticmethod
    def _log(level: str, message: str, data: Dict[str, Any] = None):
        """Internal logging method"""
        if not DEBUG_ENABLED:
            return

        log_data = {
            'debug': True,
            'timestamp': datetime.now().isoformat(),
            **(data or {})
        }

        log_message = f"🔍 [CHAT_DEBUG] {message}"

        if level == 'INFO':
            logger.info(log_message, extra=log_data)
        elif level == 'ERROR':
            logger.error(log_message, extra=log_data)
        elif level == 'WARNING':
            logger.warning(log_message, extra=log_data)

    def step(self, step_name: str, data: Dict[str, Any] = None):
        """Log a processing step"""
        self._log('INFO', f"STEP: {step_name}", {
            'step': step_name,
            **(data or {})
        })

    def state(self, phase: str, state: Dict[str, Any] = None):
        """Log state transitions"""
        state_str = json.dumps(state, default=str)[:500] if state else '{}'
        self._log('INFO', f"STATE: {phase}", {
            'phase': phase,
            'state': state_str
        })

    def transform(self, name: str, before: Any, after: Any):
        """Log data transformations"""
        before_str = str(before)[:200]
        after_str = str(after)[:200]
        self._log('INFO', f"TRANSFORM: {name}", {
            'transform': name,
            'before': before_str,
            'after': after_str
        })

    def timing(self, operation: str, duration_ms: float, metadata: Dict[str, Any] = None):
        """Log timing information"""
        self._log('INFO', f"TIMING: {operation}", {
            'operation': operation,
            'duration_ms': round(duration_ms, 2),
            **(metadata or {})
        })

    def llm_call(self, model: str, input_tokens: int = 0, output_tokens: int = 0,
                 duration_ms: float = 0, metadata: Dict[str, Any] = None):
        """Log LLM API calls"""
        self._log('INFO', f"LLM_CALL: {model}", {
            'model': model,
            'input_tokens': input_tokens,
            'output_tokens': output_tokens,
            'total_tokens': input_tokens + output_tokens,
            'duration_ms': round(duration_ms, 2),
            **(metadata or {})
        })

    def error(self, location: str, error: Exception, context: Dict[str, Any] = None):
        """Log errors with context"""
        self._log('ERROR', f"ERROR: {location}", {
            'location': location,
            'error_type': type(error).__name__,
            'error_message': str(error),
            **(context or {})
        })

    def workflow_node(self, node_name: str, state_summary: Dict[str, Any] = None):
        """Log workflow node execution (for transition from LangGraph)"""
        self._log('INFO', f"WORKFLOW_NODE: {node_name}", {
            'node': node_name,
            'state_summary': state_summary or {}
        })


# Singleton instance
chat_debug = ChatDebugLogger()
