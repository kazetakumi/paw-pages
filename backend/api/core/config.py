from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/api/.env -- see backend/api/.env.example.
_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    supabase_url: str
    supabase_anon_key: str
    # Only DELETE /me uses it, to delete the auth user. Unset means account
    # deletion answers 503 before anything is removed.
    supabase_service_role_key: str | None = None

    # The chat loop's model calls -- see backend/agent/llm.py.
    openai_api_key: str

    # Credits charged = OpenAI cost in credits (1 = $0.0001) times this.
    # 1.0 passes cost straight through; raise it once credits are sold.
    credit_markup: float = 1.0

    # Postgres connection string (transaction pooler) -- every authenticated
    # request opens a transaction on this and runs under RLS, never service_role.
    database_url: str

    # Symmetric key (Fernet) used to seal the Supabase access/refresh token
    # pair inside the session cookie -- see core/crypto.py.
    cookie_secret: str
    cookie_name: str = "pawpages_session"
    cookie_domain: str | None = None

    frontend_url: str = "http://localhost:5173"
    environment: str = "development"
    log_level: str = "INFO"

    @property
    def cookie_secure(self) -> bool:
        # Browsers refuse to store a `Secure` cookie over plain http://,
        # which is how local dev (start.py) serves both sides by default.
        return self.environment.lower() != "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
