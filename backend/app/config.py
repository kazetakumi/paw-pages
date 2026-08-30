from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env", extra="ignore"
    )

    supabase_url: str
    supabase_anon_key: str
    # Ticket 09 (account deletion) is the only thing that may ever use this.
    supabase_service_role_key: str = ""
    database_url: str
    session_secret: str
    cookie_secure: bool = True


settings = Settings()
