from pydantic import BaseModel
from typing import List, Optional


class QueryRequest(BaseModel):
    query: str
    include_reasoning: bool = False


class DocumentUploadResponse(BaseModel):
    document_id: str
    filename: str
    chunks: int
    message: str
    images: List[str] = []


class ResetResponse(BaseModel):
    message: str
    documents_retained: int


class HealthResponse(BaseModel):
    status: str
    mode: str
    llm_provider: str
    storage_type: str