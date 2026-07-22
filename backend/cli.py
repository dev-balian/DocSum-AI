#!/usr/bin/env python3
"""
Simple CLI to test the agentic document summarizer.
Usage: python cli.py --doc path/to/document.pdf --query "Summarize this document"
"""

import asyncio
import argparse
from pathlib import Path
from src.document_processor import DocumentProcessor
from src.agent import DocumentAgent

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--doc', required=True, help='Path to document (PDF or TXT)')
    parser.add_argument('--query', required=True, help='Your question or command')
    
    args = parser.parse_args()
    
    # Initialize
    processor = DocumentProcessor()
    agent = DocumentAgent()
    
    print(f"📄 Loading document: {args.doc}")
    doc = await processor.process_file(args.doc)
    print(f"✅ Document loaded: {doc.filename} ({len(doc.chunks)} chunks)")
    
    agent.add_document(doc.id, {
        'filename': doc.filename,
        'metadata': doc.metadata,
        'chunk_count': len(doc.chunks)
    })
    
    print(f"\n🤖 Agent processing query: '{args.query}'\n")
    response = await agent.process_query(args.query)
    
    print(f"Response:\n{response}")

if __name__ == "__main__":
    asyncio.run(main())