"""
LlamaParse document parser integration.

Handles multi-format document parsing using LlamaParse with:
- Vision-based PDF, DOCX, image, Excel parsing
- Markdown output with preserved structure
- Section hierarchy extraction
- Table and list formatting preservation
"""

import os
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path
from llama_parse import LlamaParse

logger = logging.getLogger(__name__)

class DocumentParser:
    """Enterprise-grade document parser using LlamaParse."""

    def __init__(self):
        """Initialize LlamaParse with API key from environment."""
        api_key = os.getenv('LLAMAPARSE_API_KEY')
        if not api_key:
            raise ValueError("LLAMAPARSE_API_KEY not found in environment")

        # Configure LlamaParse for optimal output
        self.parser = LlamaParse(
            api_key=api_key,
            result_type="markdown",  # Get structured markdown output
            extract_layout=True,  # Enable layout[] with bboxes in JSON output
            verbose=True,
            language="en",
            # Optimize for technical documentation
            parsing_instruction=(
                "Extract all content preserving document structure. "
                "Maintain headings, lists, tables, and section hierarchy. "
                "For tables, preserve formatting. For lists, maintain nesting. "
                "For technical specs, keep exact formatting."
            )
        )

    async def parse_document(
        self,
        file_path: str,
        filename: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Parse document and extract structured content.

        Args:
            file_path: Path to document file
            filename: Optional original filename (for metadata)

        Returns:
            Dict containing:
                - success: bool
                - markdown: str (structured markdown content)
                - metadata: Dict (extracted metadata)
                - sections: List[Dict] (hierarchical sections)
                - error: str (if failed)
        """
        try:
            path = Path(file_path)
            if not path.exists():
                return {
                    "success": False,
                    "error": f"File not found: {file_path}"
                }

            # Use provided filename or extract from path
            doc_name = filename or path.name

            logger.info(f"Parsing document: {doc_name}")

            # Parse with LlamaParse
            documents = await self.parser.aload_data(file_path)

            if not documents or len(documents) == 0:
                return {
                    "success": False,
                    "error": "No content extracted from document"
                }

            # LlamaParse returns list of Document objects
            # Combine all content (usually single document)
            full_markdown = "\n\n".join([doc.text for doc in documents])

            # Extract sections from markdown
            sections = self._extract_sections(full_markdown)

            # Build metadata
            metadata = {
                "filename": doc_name,
                "file_path": file_path,
                "total_sections": len(sections),
                "parser_version": "llamaparse_v1",
                "content_length": len(full_markdown)
            }

            # Add any metadata from LlamaParse documents
            if hasattr(documents[0], 'metadata'):
                metadata.update(documents[0].metadata)

            logger.info(
                f"Successfully parsed {doc_name}: "
                f"{len(sections)} sections, "
                f"{len(full_markdown)} chars"
            )

            return {
                "success": True,
                "markdown": full_markdown,
                "metadata": metadata,
                "sections": sections
            }

        except Exception as e:
            logger.error(f"Failed to parse document {file_path}: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def parse_document_with_layout(
        self,
        file_path: str,
        filename: Optional[str] = None,
        target_pages: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Parse document and return markdown + raw JSON with layout data.

        Uses aget_json() to get full LlamaParse response including:
        - pages[].items[] - text content with bboxes
        - pages[].layout[] - visual elements (pictures, tables) with bboxes

        Args:
            file_path: Path to document file
            filename: Optional original filename (for metadata)
            target_pages: Optional comma-separated 0-indexed pages (e.g., "0,1,2")

        Returns:
            Dict containing:
                - success: bool
                - markdown: str (combined markdown from all pages)
                - raw_json: Dict (full LlamaParse JSON response for storage)
                - pages_count: int
                - error: str (if failed)
        """
        try:
            path = Path(file_path)
            if not path.exists():
                return {
                    "success": False,
                    "error": f"File not found: {file_path}"
                }

            doc_name = filename or path.name
            logger.info(f"Parsing document with layout: {doc_name}")

            # Create parser with target_pages if specified
            if target_pages:
                parser = LlamaParse(
                    api_key=self.parser.api_key,
                    result_type="markdown",
                    extract_layout=True,
                    verbose=True,
                    language="en",
                    target_pages=target_pages,
                    parsing_instruction=self.parser.parsing_instruction
                )
                json_result = await parser.aget_json(file_path)
            else:
                json_result = await self.parser.aget_json(file_path)

            if not json_result or len(json_result) == 0:
                return {
                    "success": False,
                    "error": "No content extracted from document"
                }

            # LlamaParse returns list, take first element
            raw_json = json_result[0]
            pages = raw_json.get('pages', [])

            # Extract markdown from pages
            markdown_parts = []
            for page in pages:
                # Get markdown from items
                for item in page.get('items', []):
                    if item.get('type') == 'heading':
                        level = item.get('lvl', 1)
                        markdown_parts.append(f"{'#' * level} {item.get('value', '')}")
                    elif item.get('type') == 'table':
                        markdown_parts.append(item.get('md', ''))
                    elif item.get('value'):
                        markdown_parts.append(item.get('value', ''))

            full_markdown = "\n\n".join(markdown_parts)

            logger.info(
                f"Successfully parsed {doc_name} with layout: "
                f"{len(pages)} pages, {len(full_markdown)} chars"
            )

            return {
                "success": True,
                "markdown": full_markdown,
                "raw_json": raw_json,
                "pages_count": len(pages)
            }

        except Exception as e:
            logger.error(f"Failed to parse document with layout {file_path}: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    def _extract_sections(self, markdown: str) -> List[Dict[str, Any]]:
        """
        Extract hierarchical sections from markdown.

        Identifies sections by markdown headers (# ## ### etc.)
        and builds hierarchical structure.

        Args:
            markdown: Full markdown content

        Returns:
            List of section dicts with:
                - level: int (1-6 for h1-h6)
                - title: str
                - content: str (section content without subsections)
                - start_char: int (position in document)
                - end_char: int
        """
        sections = []
        lines = markdown.split('\n')

        current_section = None
        current_content = []
        char_position = 0

        for line in lines:
            line_length = len(line) + 1  # +1 for newline

            # Check if line is a heading
            if line.startswith('#'):
                # Save previous section if exists
                if current_section is not None:
                    current_section['content'] = '\n'.join(current_content).strip()
                    current_section['end_char'] = char_position
                    sections.append(current_section)

                # Start new section
                level = len(line) - len(line.lstrip('#'))
                title = line.lstrip('#').strip()

                current_section = {
                    'level': level,
                    'title': title,
                    'start_char': char_position,
                    'content': '',
                    'end_char': 0
                }
                current_content = []
            else:
                # Add to current section content
                if current_section is not None:
                    current_content.append(line)

            char_position += line_length

        # Save final section
        if current_section is not None:
            current_section['content'] = '\n'.join(current_content).strip()
            current_section['end_char'] = char_position
            sections.append(current_section)

        return sections

    def get_supported_formats(self) -> List[str]:
        """Get list of supported file formats."""
        return [
            '.pdf',
            '.docx',
            '.doc',
            '.pptx',
            '.ppt',
            '.xlsx',
            '.xls',
            '.png',
            '.jpg',
            '.jpeg'
        ]

    def is_supported(self, filename: str) -> bool:
        """Check if file format is supported."""
        ext = Path(filename).suffix.lower()
        return ext in self.get_supported_formats()


# Global parser instance
_parser_instance: Optional[DocumentParser] = None

def get_parser() -> DocumentParser:
    """Get or create global parser instance."""
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = DocumentParser()
    return _parser_instance
