from enum import Enum
from typing import Any, Dict, List

class ToolType(str, Enum):
    SUMMARIZE = "summarize"
    COMPARE_DOCUMENTS = "compare_documents"
    EXTRACT_DATA = "extract_data"
    GENERATE_INSIGHTS = "generate_insights"
    QUERY_DOCUMENT = "query_document"


TOOLS: List[Dict[str, Any]] = [
    {
        "name": ToolType.SUMMARIZE,
        "description": "Summarize one or more loaded documents. Returns a concise summary.",
        "input_schema": {
            "type": "object",
            "properties": {
                "doc_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of document IDs to summarize. Empty means all docs.",
                },
                "style": {
                    "type": "string",
                    "enum": ["brief", "detailed", "bullet_points"],
                    "description": "Summary style.",
                },
            },
            "required": [],
        },
    },
    {
        "name": ToolType.COMPARE_DOCUMENTS,
        "description": "Compare two or more documents and highlight similarities and differences.",
        "input_schema": {
            "type": "object",
            "properties": {
                "doc_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Document IDs to compare.",
                },
                "focus": {
                    "type": "string",
                    "description": "Specific aspect to compare (e.g. methodology, conclusions).",
                },
            },
            "required": ["doc_ids"],
        },
    },
    {
        "name": ToolType.EXTRACT_DATA,
        "description": "Extract specific types of data from documents (dates, names, numbers, etc.).",
        "input_schema": {
            "type": "object",
            "properties": {
                "doc_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Document IDs to extract from.",
                },
                "data_type": {
                    "type": "string",
                    "description": "What to extract: dates, names, numbers, key terms, etc.",
                },
            },
            "required": ["data_type"],
        },
    },
    {
        "name": ToolType.GENERATE_INSIGHTS,
        "description": "Generate high-level insights, patterns, and recommendations from documents.",
        "input_schema": {
            "type": "object",
            "properties": {
                "doc_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Document IDs to analyse.",
                },
                "focus_area": {
                    "type": "string",
                    "description": "Optional focus area for insights.",
                },
            },
            "required": [],
        },
    },
    {
        "name": ToolType.QUERY_DOCUMENT,
        "description": "Answer a specific question using the content of loaded documents.",
        "input_schema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question to answer from document content.",
                },
                "doc_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Limit search to these document IDs. Empty means all.",
                },
            },
            "required": ["question"],
        },
    },
]