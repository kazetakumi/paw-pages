"""PDF text extraction using PyMuPDF.

Local-first extraction path: most resumes are digitally generated PDFs with
a real text layer, so we pull text directly instead of paying for a
vision-LLM call on every upload. Pages with little/no extractable text are
flagged as likely scanned, so the caller can route those to a vision-model
fallback instead (handled elsewhere -- this module has no model calls).
"""

from dataclasses import dataclass
from pathlib import Path

import pymupdf

# Below this many characters, a page is treated as scanned/image-only
# rather than real text. Arbitrary but reasonable: a resume page with an
# actual text layer clears this easily; a bare scanned image won't.
MIN_TEXT_CHARS_PER_PAGE = 40

# If more than this fraction of pages look scanned, treat the whole
# document as needing the vision fallback rather than per-page patching.
SCANNED_PAGE_FRACTION_THRESHOLD = 0.5


@dataclass
class PageText:
    page_number: int  # 1-indexed
    text: str
    char_count: int

    @property
    def likely_scanned(self) -> bool:
        return self.char_count < MIN_TEXT_CHARS_PER_PAGE


@dataclass
class ExtractionResult:
    pages: list[PageText]
    page_count: int

    @property
    def full_text(self) -> str:
        return "\n\n".join(p.text for p in self.pages)

    @property
    def needs_vision_fallback(self) -> bool:
        if not self.pages:
            return True
        scanned = sum(1 for p in self.pages if p.likely_scanned)
        return scanned / len(self.pages) > SCANNED_PAGE_FRACTION_THRESHOLD


def _extract_from_doc(doc: pymupdf.Document) -> ExtractionResult:
    pages: list[PageText] = []
    for i, page in enumerate(doc, start=1):
        text = page.get_text().strip()
        pages.append(PageText(page_number=i, text=text, char_count=len(text)))
    return ExtractionResult(pages=pages, page_count=doc.page_count)


def extract_text(path: str | Path) -> ExtractionResult:
    """Extract per-page text from a PDF file on disk.

    Raises FileNotFoundError for a missing file, and pymupdf.FileDataError
    for a corrupt/unreadable one -- callers should catch both and route to
    manual review rather than fail the whole import silently. Even
    high-accuracy OCR pipelines see a real failure rate in production, so
    a "flagged for review" state matters as much as the happy path.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)

    with pymupdf.open(path) as doc:
        return _extract_from_doc(doc)


def extract_text_from_bytes(data: bytes) -> ExtractionResult:
    """Extract per-page text from PDF bytes already in memory.

    For callers that receive an upload (e.g. an HTTP endpoint) and don't
    want to write it to disk first. Raises pymupdf.FileDataError for
    corrupt/unreadable data -- same handling guidance as extract_text().
    """
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        return _extract_from_doc(doc)


def render_page_image(path: str | Path, page_number: int, dpi: int = 200) -> bytes:
    """Rasterize one page to PNG bytes, for the vision-LLM fallback path.

    page_number is 1-indexed, matching PageText.page_number.
    """
    path = Path(path)
    with pymupdf.open(path) as doc:
        page = doc[page_number - 1]
        pix = page.get_pixmap(dpi=dpi)
        return pix.tobytes("png")


def render_page_image_from_bytes(data: bytes, page_number: int, dpi: int = 200) -> bytes:
    """render_page_image() for PDF bytes already in memory."""
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        return doc[page_number - 1].get_pixmap(dpi=dpi).tobytes("png")
