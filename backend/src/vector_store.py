"""
Local vector store using FAISS + sentence-transformers.
Runs 100% offline — no external API calls, no cost.
"""

import pickle
from pathlib import Path
from typing import Dict, List, Tuple

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


class VectorStore:
    """
    Stores document chunk embeddings in a local FAISS index.
    Supports semantic search filtered by document ID.
    """

    def __init__(self, storage_path: str = "./vector_store", model_name: str = "all-MiniLM-L6-v2"):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(exist_ok=True)

        # Small, fast, runs on CPU — good default for local use
        self.model = SentenceTransformer(model_name)
        self.embedding_dim = self.model.get_sentence_embedding_dimension()

        # FAISS index (flat L2 — exact search, fine up to ~100k chunks)
        self.index = faiss.IndexFlatL2(self.embedding_dim)

        # Parallel metadata store: position in FAISS index -> chunk info
        self.chunk_metadata: List[Dict] = []

        self._load_if_exists()

    # ------------------------------------------------------------------
    # Indexing
    # ------------------------------------------------------------------

    def add_document_chunks(self, doc_id: str, filename: str, chunks: List[str]):
        """Embed and index all chunks for a document."""
        if not chunks:
            return

        embeddings = self.model.encode(chunks, convert_to_numpy=True, show_progress_bar=False)
        self.index.add(embeddings.astype("float32"))

        for i, chunk_text in enumerate(chunks):
            self.chunk_metadata.append({
                "doc_id": doc_id,
                "filename": filename,
                "chunk_index": i,
                "text": chunk_text,
            })

        self._save()

    def remove_document(self, doc_id: str):
        """Remove all chunks belonging to a document and rebuild the index."""
        keep = [(i, m) for i, m in enumerate(self.chunk_metadata) if m["doc_id"] != doc_id]

        if len(keep) == len(self.chunk_metadata):
            return  # nothing to remove

        # Rebuild index from scratch with remaining chunks
        self.index = faiss.IndexFlatL2(self.embedding_dim)
        self.chunk_metadata = []

        if keep:
            texts = [m["text"] for _, m in keep]
            embeddings = self.model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
            self.index.add(embeddings.astype("float32"))
            self.chunk_metadata = [m for _, m in keep]

        self._save()

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------

    def search(self, query: str, doc_ids: List[str] = None, k: int = 5) -> List[Dict]:
        """
        Return the k most relevant chunks for a query.
        If doc_ids is provided, only search within those documents.
        """
        if self.index.ntotal == 0:
            return []

        query_embedding = self.model.encode([query], convert_to_numpy=True).astype("float32")

        # Over-fetch so we have enough candidates left after doc_id filtering
        search_k = min(k * 5, self.index.ntotal) if doc_ids else min(k, self.index.ntotal)
        distances, indices = self.index.search(query_embedding, search_k)

        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx == -1 or idx >= len(self.chunk_metadata):
                continue
            meta = self.chunk_metadata[idx]
            if doc_ids and meta["doc_id"] not in doc_ids:
                continue
            results.append({**meta, "score": float(dist)})
            if len(results) >= k:
                break

        return results

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _save(self):
        faiss.write_index(self.index, str(self.storage_path / "index.faiss"))
        with open(self.storage_path / "metadata.pkl", "wb") as f:
            pickle.dump(self.chunk_metadata, f)

    def _load_if_exists(self):
        index_path = self.storage_path / "index.faiss"
        meta_path = self.storage_path / "metadata.pkl"

        if index_path.exists() and meta_path.exists():
            self.index = faiss.read_index(str(index_path))
            with open(meta_path, "rb") as f:
                self.chunk_metadata = pickle.load(f)

    def stats(self) -> Dict:
        return {
            "total_chunks": self.index.ntotal,
            "documents": len(set(m["doc_id"] for m in self.chunk_metadata)),
        }

    def clear_all(self):
        """Wipe the entire index and remove persisted files from disk."""
        self.index = faiss.IndexFlatL2(self.embedding_dim)
        self.chunk_metadata = []

        index_path = self.storage_path / "index.faiss"
        meta_path = self.storage_path / "metadata.pkl"
        if index_path.exists():
            index_path.unlink()
        if meta_path.exists():
            meta_path.unlink()

    # ------------------------------------------------------------------
    # Convenience methods (used by agent.py)
    # ------------------------------------------------------------------

    def add_document(self, doc_id: str, filename: str, chunks: List[str]):
        """Alias for add_document_chunks — matches agent.py call signature."""
        self.add_document_chunks(doc_id, filename, chunks)

    def is_empty(self) -> bool:
        return self.index.ntotal == 0

    def search_and_format(self, query: str, k: int = 5, doc_ids: List[str] = None) -> str:
        """Search and return results as a single formatted string, ready to drop into a prompt."""
        results = self.search(query, doc_ids=doc_ids, k=k)

        if not results:
            return "No relevant content found."

        formatted = []
        for r in results:
            formatted.append(
                f"[From: {r['filename']} | chunk {r['chunk_index']}]\n{r['text']}"
            )

        return "\n\n---\n\n".join(formatted)

    def search_per_document(self, query: str, doc_ids: List[str], k_per_doc: int = 4) -> str:
        """
        Search each document independently and return results grouped under
        clear per-document headers. Guarantees every document gets representation,
        instead of one document dominating a shared top-k search.
        """
        if not doc_ids:
            return "No documents loaded."

        sections = []
        for doc_id in doc_ids:
            results = self.search(query, doc_ids=[doc_id], k=k_per_doc)
            filename = results[0]["filename"] if results else doc_id

            if not results:
                sections.append(f"### Document: {filename}\nNo relevant content found.")
                continue

            chunk_texts = "\n\n".join(r["text"] for r in results)
            sections.append(f"### Document: {filename}\n{chunk_texts}")

        return "\n\n".join(sections)