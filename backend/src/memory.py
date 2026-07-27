from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class Message:
    role: str
    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    tool_calls: Optional[List[Any]] = None


class ConversationMemory:
    def __init__(self, max_messages: int = 50):
        self.max_messages = max_messages
        self.messages: List[Message] = []
        self.document_context: Dict[str, Any] = {}

    def add_message(self, role: str, content: str, tool_calls: Optional[List[Any]] = None):
        self.messages.append(Message(role=role, content=content, tool_calls=tool_calls))
        if len(self.messages) > self.max_messages:
            self.messages = self.messages[-self.max_messages:]

    def add_document(self, doc_id: str, data: Dict[str, Any]):
        self.document_context[doc_id] = data

    def remove_document(self, doc_id: str):
        self.document_context.pop(doc_id, None)

    def rename_document(self, doc_id: str, new_filename: str) -> bool:
        if doc_id not in self.document_context:
            return False
        self.document_context[doc_id]["filename"] = new_filename
        return True

    def get_recent_messages(self, n: int = 20) -> List[Message]:
        return self.messages[-n:]

    def clear(self):
        self.messages = []

    def clear_all(self):
        self.messages = []
        self.document_context = {}