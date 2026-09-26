"""Quick CLI to try the extraction pipeline against a PDF.

    uv run main.py path/to/resume.pdf
"""

import sys

from ocr_engine.extract import extract_text

# Windows' default console codepage (cp1252) can't display common resume
# characters like bullet glyphs (●); force UTF-8 output so extraction
# results print correctly regardless of the host terminal's codepage.
sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: uv run main.py <path-to-resume.pdf>")
        sys.exit(1)

    result = extract_text(sys.argv[1])

    print(f"{result.page_count} page(s)")
    if result.needs_vision_fallback:
        print("-> looks scanned/image-based; would need vision-LLM fallback")

    for page in result.pages:
        flag = " [likely scanned]" if page.likely_scanned else ""
        print(f"\n--- page {page.page_number} ({page.char_count} chars){flag} ---")
        print(page.text[:500])


if __name__ == "__main__":
    main()
