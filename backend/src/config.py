from pydantic_settings import BaseSettings
from typing import Literal


class Settings(BaseSettings):
    # Deployment mode
    MODE: Literal["private", "public"] = "private"

    # LLM
    ANTHROPIC_API_KEY: str = ""
    LLM_PROVIDER: Literal["claude", "ollama"] = "ollama"
    MODEL_NAME: str = "claude-3-5-sonnet-20241022"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "mistral"

    # Storage
    STORAGE_TYPE: Literal["local", "cloud"] = "local"
    LOCAL_STORAGE_PATH: str = "./documents"

    # Agent
    MAX_REASONING_STEPS: int = 10
    TEMPERATURE: float = 0.7
    MAX_TOKENS: int = 4096

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = True

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()