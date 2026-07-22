import asyncio
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List


@dataclass
class Document:
    id: str
    filename: str
    content: str
    metadata: Dict[str, Any]
    chunks: List[str]
    source_path: str


class DocumentProcessor:
    def __init__(self, chunk_size: int = 2000, overlap: int = 200, max_workers: int = 4):
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.executor = ThreadPoolExecutor(max_workers=max_workers)

    async def process_file(self, file_path: str) -> Document:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        suffix = path.suffix.lower()
        if suffix == ".pdf":
            content, metadata = self._extract_pdf(file_path)
        elif suffix == ".txt":
            content, metadata = self._extract_text(file_path)
        else:
            raise ValueError(f"Unsupported file type: {suffix}. Use PDF or TXT.")

        chunks = self._chunk_text(content)

        return Document(
            id=str(uuid.uuid4())[:8],
            filename=path.name,
            content=content,
            metadata=metadata,
            chunks=chunks,
            source_path=file_path,
        )

    async def process_multiple(self, file_paths: List[str]) -> List[Document]:
        tasks = [self.process_file(p) for p in file_paths]
        return await asyncio.gather(*tasks)

    def _extract_pdf(self, file_path: str):
        try:
            from pypdf import PdfReader
        except ImportError:
            raise ImportError("pypdf not installed. Run: pip install pypdf")

        reader = PdfReader(file_path)
        pages_text = [page.extract_text() or "" for page in reader.pages]
        content = "\n\n".join(pages_text)
        metadata = {
            "page_count": len(reader.pages),
            "file_type": "pdf",
            "char_count": len(content),
        }
        return content, metadata

    def _extract_text(self, file_path: str):
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        metadata = {
            "file_type": "txt",
            "char_count": len(content),
            "line_count": content.count("\n"),
        }
        return content, metadata

    def _chunk_text(self, text: str) -> List[str]:
        sections = re.split(r"\n\n+", text)
        chunks: List[str] = []
        current = ""

        for section in sections:
            if len(current) + len(section) > self.chunk_size and current:
                chunks.append(current.strip())
                current = current[-self.overlap:] + "\n\n" + section
            else:
                current = current + "\n\n" + section if current else section

        if current.strip():
            chunks.append(current.strip())

        return [c for c in chunks if len(c) > 100]