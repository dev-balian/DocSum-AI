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
    image_paths: List[str] = None

    def __post_init__(self):
        if self.image_paths is None:
            self.image_paths = []


class DocumentProcessor:
    def __init__(
        self,
        chunk_size: int = 2000,
        overlap: int = 200,
        max_workers: int = 4,
        image_storage_path: str = "./documents/images",
    ):
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.image_storage_path = Path(image_storage_path)
        self.image_storage_path.mkdir(parents=True, exist_ok=True)

    async def process_file(self, file_path: str) -> Document:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        doc_id = str(uuid.uuid4())[:8]
        suffix = path.suffix.lower()
        image_paths: List[str] = []

        if suffix == ".pdf":
            content, metadata = self._extract_pdf(file_path)
            image_paths = self._extract_pdf_images(file_path, doc_id, max_images=6)
        elif suffix == ".txt":
            content, metadata = self._extract_text(file_path)
        else:
            raise ValueError(f"Unsupported file type: {suffix}. Use PDF or TXT.")

        chunks = self._chunk_text(content)

        return Document(
            id=doc_id,
            filename=path.name,
            content=content,
            metadata=metadata,
            chunks=chunks,
            source_path=file_path,
            image_paths=image_paths,
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

    def _extract_pdf_images(self, file_path: str, doc_id: str, max_images: int = 6) -> List[str]:
        """Extract up to max_images embedded images from a PDF and save them to disk.
        Returns a list of relative paths, safe to expose to the frontend."""
        try:
            from pypdf import PdfReader
        except ImportError:
            return []

        saved_paths: List[str] = []

        try:
            reader = PdfReader(file_path)
            count = 0

            for page in reader.pages:
                if count >= max_images:
                    break
                try:
                    images = page.images
                except Exception:
                    continue

                for img in images:
                    if count >= max_images:
                        break
                    try:
                        ext = Path(img.name).suffix or ".png"
                        out_name = f"{doc_id}_{count}{ext}"
                        out_path = self.image_storage_path / out_name
                        with open(out_path, "wb") as f:
                            f.write(img.data)
                        saved_paths.append(out_name)
                        count += 1
                    except Exception:
                        continue
        except Exception:
            return saved_paths

        return saved_paths

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