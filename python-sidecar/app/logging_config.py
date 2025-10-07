"""
Centralized logging configuration for Python sidecar with:
- File rotation (daily + size-based)
- Separate error and info logs
- Structured logging with service/module tags
- Console output for development
"""

import logging
import logging.handlers
import os
import json
from pathlib import Path
from typing import Optional
from datetime import datetime


class StructuredFormatter(logging.Formatter):
    """Custom formatter that adds service and module tags to all logs"""

    def __init__(self, service_name: str = "python-sidecar"):
        super().__init__()
        self.service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        # Create structured log entry
        log_data = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "service": self.service_name,
            "module": record.name,
            "message": record.getMessage()
        }

        # Add correlation ID if present
        if hasattr(record, 'correlation_id'):
            log_data["correlation_id"] = record.correlation_id

        # Add request ID if present
        if hasattr(record, 'request_id'):
            log_data["request_id"] = record.request_id

        # Add extra fields from record
        if hasattr(record, 'extra_fields') and isinstance(record.extra_fields, dict):
            for key, value in record.extra_fields.items():
                if key not in log_data:
                    log_data[key] = value

        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_data)


class HumanReadableFormatter(logging.Formatter):
    """Formatter for console output that's easy to read during development"""

    def __init__(self, service_name: str = "python-sidecar"):
        super().__init__()
        self.service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        # Color codes for different log levels
        colors = {
            'DEBUG': '\033[36m',    # Cyan
            'INFO': '\033[32m',     # Green
            'WARNING': '\033[33m',  # Yellow
            'ERROR': '\033[31m',    # Red
            'CRITICAL': '\033[35m'  # Magenta
        }
        reset = '\033[0m'

        level_color = colors.get(record.levelname, '')

        # Format: [TIMESTAMP] [LEVEL] [MODULE] MESSAGE
        timestamp = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

        # Add correlation ID if present
        correlation_info = ""
        if hasattr(record, 'correlation_id'):
            correlation_info = f" [corr:{record.correlation_id[:8]}]"

        formatted = f"[{timestamp}] {level_color}[{record.levelname}]{reset} [{record.name}]{correlation_info} {record.getMessage()}"

        # Add exception if present
        if record.exc_info:
            formatted += "\n" + self.formatException(record.exc_info)

        return formatted


class ChatLogFormatter(logging.Formatter):
    """Formatter for chat logs - human-readable, structured format"""

    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.utcnow().strftime('%H:%M:%S')

        # Get log type tag (CHAT, MATCH, SEARCH, etc.) from extra fields
        log_type = getattr(record, 'log_type', record.levelname)

        # Format main message
        formatted = f"[{log_type}] {timestamp} | {record.getMessage()}"

        # Add details if present (from extra fields)
        details = getattr(record, 'details', None)
        if details and isinstance(details, dict):
            for key, value in details.items():
                formatted += f"\n  {key}: {value}"

        # Add exception if present
        if record.exc_info:
            formatted += "\n" + self.formatException(record.exc_info)

        return formatted


class HealthCheckFilter(logging.Filter):
    """Filter to suppress health check endpoint spam"""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        # Suppress uvicorn access logs for health check endpoints
        if '/health' in message or '/v1/pinecone/stats' in message:
            return False
        return True


def setup_logging(
    service_name: str = "python-sidecar",
    log_dir: str = "../../logs",
    level: str = "INFO",
    enable_console: bool = True,
    enable_files: bool = True
) -> logging.Logger:
    """
    Set up logging with file rotation and structured output

    Args:
        service_name: Name of the service for tagging
        log_dir: Directory for log files (relative to this file)
        level: Logging level (DEBUG, INFO, WARNING, ERROR)
        enable_console: Whether to log to console
        enable_files: Whether to log to files

    Returns:
        Configured root logger
    """

    # Create logs directory if it doesn't exist
    log_path = Path(__file__).parent / log_dir
    log_path.mkdir(parents=True, exist_ok=True)

    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper()))

    # Clear existing handlers
    root_logger.handlers.clear()

    # Console handler (human-readable for development)
    if enable_console:
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.DEBUG)
        console_handler.setFormatter(HumanReadableFormatter(service_name))
        console_handler.addFilter(HealthCheckFilter())  # Suppress health check spam
        root_logger.addHandler(console_handler)

    # File handlers (organized by type)
    if enable_files:
        # Create subdirectories
        chat_dir = log_path / "chat"
        api_dir = log_path / "api"
        errors_dir = log_path / "errors"
        debug_dir = log_path / "debug"

        chat_dir.mkdir(exist_ok=True)
        api_dir.mkdir(exist_ok=True)
        errors_dir.mkdir(exist_ok=True)
        debug_dir.mkdir(exist_ok=True)

        # Chat log (human-readable, chat operations only)
        chat_handler = logging.handlers.TimedRotatingFileHandler(
            filename=chat_dir / "python-chat.log",
            when='midnight',
            interval=1,
            backupCount=7
        )
        chat_handler.setLevel(logging.INFO)
        chat_handler.setFormatter(ChatLogFormatter())
        # Only log messages from chat modules
        chat_handler.addFilter(lambda record: 'chat' in record.name.lower())
        root_logger.addHandler(chat_handler)

        # API log (all API calls, filtered to remove health checks)
        api_handler = logging.handlers.TimedRotatingFileHandler(
            filename=api_dir / "python-api.log",
            when='midnight',
            interval=1,
            backupCount=7
        )
        api_handler.setLevel(logging.INFO)
        api_handler.setFormatter(HumanReadableFormatter(service_name))
        api_handler.addFilter(HealthCheckFilter())
        root_logger.addHandler(api_handler)

        # Error log (ERROR and above only with full stack traces)
        error_handler = logging.handlers.TimedRotatingFileHandler(
            filename=errors_dir / "python-errors.log",
            when='midnight',
            interval=1,
            backupCount=30  # Keep 30 days for errors
        )
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(HumanReadableFormatter(service_name))
        root_logger.addHandler(error_handler)

        # Debug log (everything, for troubleshooting)
        debug_handler = logging.handlers.TimedRotatingFileHandler(
            filename=debug_dir / "python-debug.log",
            when='midnight',
            interval=1,
            backupCount=3  # Keep 3 days
        )
        debug_handler.setLevel(logging.DEBUG)
        debug_handler.setFormatter(HumanReadableFormatter(service_name))
        root_logger.addHandler(debug_handler)

    # Log initialization
    root_logger.info(f"{service_name} logging initialized", extra={
        'extra_fields': {
            'log_level': level,
            'console_enabled': enable_console,
            'files_enabled': enable_files,
            'log_directory': str(log_path)
        }
    })

    return root_logger


def get_logger_with_context(
    name: str,
    correlation_id: Optional[str] = None,
    request_id: Optional[str] = None,
    **extra_fields
) -> logging.LoggerAdapter:
    """
    Get a logger with pre-configured context (correlation ID, request ID, etc.)

    Args:
        name: Logger name (usually __name__)
        correlation_id: Correlation ID for request tracing
        request_id: Request ID
        **extra_fields: Additional fields to include in all logs

    Returns:
        LoggerAdapter with context
    """
    logger = logging.getLogger(name)

    # Build extra context
    extra = {}
    if correlation_id:
        extra['correlation_id'] = correlation_id
    if request_id:
        extra['request_id'] = request_id
    if extra_fields:
        extra['extra_fields'] = extra_fields

    return logging.LoggerAdapter(logger, extra)


# Environment-based configuration
def get_log_level_from_env() -> str:
    """Get log level from environment variable"""
    return os.getenv('LOG_LEVEL', 'INFO').upper()


def is_development() -> bool:
    """Check if running in development mode"""
    return os.getenv('ENVIRONMENT', 'development').lower() in ['development', 'dev', 'local']