from pathlib import Path

PROMPTS_DIR = Path(__file__).parent


def load_prompt(name: str) -> str:
    """Load a prompt's Markdown source from prompts/<name>.md,
    e.g. load_prompt("extraction/personal_info")."""
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8").strip()
