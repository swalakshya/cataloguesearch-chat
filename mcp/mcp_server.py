#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import requests

SERVER_NAME = os.getenv("MCP_SERVER_NAME", "cataloguesearch")
SERVER_VERSION = "0.1.0"
PROTOCOL_VERSION = "2024-11-05"

log = logging.getLogger(__name__)


def _env_bool(name: str) -> Optional[bool]:
    value = os.getenv(name)
    if value is None:
        return None
    return value.strip().lower() in {"1", "true", "yes", "y"}


def _default_verify_tls(base_url: str) -> bool:
    verify_env = _env_bool("EXTERNAL_API_VERIFY_TLS")
    if verify_env is not None:
        return verify_env
    return urlparse(base_url).scheme == "https"


def _json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)


def _write_message(message: Dict[str, Any]) -> None:
    sys.stdout.write(_json_dumps(message) + "\n")
    sys.stdout.flush()
    print(f"[mcp] -> {message.get('id')}: {message.get('result') or message.get('error')}", file=sys.stderr, flush=True)


def _error_response(msg_id: Any, code: int, message: str, data: Any = None) -> Dict[str, Any]:
    err: Dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": msg_id, "error": err}


def _success_response(msg_id: Any, result: Dict[str, Any]) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


CATALOGUESEARCH_CONTEXT = """\
CatalogueSearch is an OpenSearch-backed hybrid search system for multilingual (Hindi/Gujarati) PDF corpora of Jain scriptures and discourses.

Indexed content categories:
1) Granth (Mool Agam): Original scriptures written by Jain saints and scholars.
2) Pravachan: Discourses by Shri Kanji Swami.
3) Books: Additional Jain books and publications.

Data reference (approx):
- Pravachan: languages: Hindi (hi), Gujarati (gu)
  Unique metadata fields include: date, pravachan_number, series, series_start_date, series_end_date
  Anuyog classifications include: Dravyanuyog, Charananuyog
- Granth: languages: Hindi (hi)
  Unique metadata fields include: gatha, shlok, kalash, Author, Tikakaar, Bhasha Vachanika, verse_type, sub_section
  Anuyog classifications include: Dravyanuyog, Charananuyog
- Books: languages: Hindi (hi)

content_type filter accepts a list, e.g. ["Granth", "Books"] or ["Pravachan"]. Default is ["Granth", "Books"].

Chunk ID structure:
- {uuid}_p{page}_para{paragraph_id}
- paragraph_id is a sequential integer within each document, enabling sequential navigation via +1 / -1.

Metadata index:
- cataloguesearch_prod_metadata — pre-aggregated filter options (Granths, Anuyogs, date ranges, contributors)
  per language and content type; updated automatically as new content is indexed.

This MCP server is a thin, stateless bridge that exposes the CatalogueSearch Agent API as MCP tools.
"""

GUIDELINES_FILENAME = os.getenv(
    "MCP_GUIDELINES", "guidelines/cataloguesearch_answering_guidelines.md"
)

def _load_guidelines() -> str:
    path = os.path.join(os.path.dirname(__file__), GUIDELINES_FILENAME)
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except FileNotFoundError:
        return "Guidelines file not found. Ensure the MCP repository includes cataloguesearch_answering_guidelines.md."
TOOLS = [
    {
        "name": "agent_search",
        "description": """\
Search the CatalogueSearch corpus (Granth and Books by default).

This is the main entry point. Performs keyword or semantic search with filters.
For semantic queries, the backend fetches top candidates via KNN, optionally re-scores them with a cross-encoder
(reranker model: BAAI/bge-reranker-base), and returns the top N results.

Inputs:
- query (required): Search text (Hindi or Gujarati).
- language (required): "hi" | "gu".
- content_type (default ["Granth", "Books"]): list of "Granth" | "Books" | "Pravachan".
- anuyog (optional): e.g. "Dravyanuyog", "Charananuyog".
- granth (optional): e.g. "Samaysaar", "Niyamsaar".
- contributor (optional): Matches against ANY contributor role (Author OR Tikakaar OR Bhasha Vachanika).
  Agents do not need to know which role the person has.
- page/page_size: Pagination (page_size max 50).
- rerank (default true): Apply cross-encoder reranking on semantic queries (slower but higher relevance).

Notes:
- The contributor field fans out internally as an OR filter across:
  Author.keyword, Tikakaar.keyword, and Bhasha Vachanika.keyword (minimum_should_match=1).

Returns:
Ordered list of chunks, each with:
chunk_id, text_content, category, granth, anuyog, language, date, pravachan_number, gatha, page_number, file_url, score.
""",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search text (Hindi or Gujarati)."},
                "language": {"type": "string", "enum": ["hi", "gu"], "description": "Script language."},
                "content_type": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["Pravachan", "Granth", "Books"]},
                    "default": ["Granth", "Books"],
                    "description": "Filter by content categories (pass one or more values).",
                },
                "anuyog": {"type": "string", "description": 'Optional Anuyog filter (e.g. "Dravyanuyog").'},
                "granth": {"type": "string", "description": 'Optional Granth filter (e.g. "Samaysaar").'},
                "contributor": {
                    "type": "string",
                    "description": "Optional contributor name. Matches across Author/Tikakaar/Bhasha Vachanika.",
                },
                "year_from": {"type": "integer", "description": "Pravachan only — filter by discourse year (inclusive)."},
                "year_to": {"type": "integer", "description": "Pravachan only — filter by discourse year (inclusive)."},
                "page_size": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
                "page": {"type": "integer", "minimum": 1, "default": 1, "description": "Pagination page number."},
                "rerank": {
                    "type": "boolean",
                    "default": True,
                    "description": "Apply cross-encoder reranking on semantic queries.",
                },
            },
            "required": ["query", "language"],
        },
    },
    {
        "name": "agent_navigate",
        "description": """\
Walk sequentially through a document by paragraph, starting from a given chunk_id.

The chunk_id structure is: {uuid}_p{page}_para{paragraph_id}
Where paragraph_id is a sequential integer within each document, enabling sequential navigation via +1 / -1.

Inputs:
- chunk_id (required): Starting chunk.
- direction (default "both"): "next" | "prev" | "both".
  direction="both" with steps=1 returns [prev, current, next].
- steps (default 1, max 20): How many paragraphs to walk.

Returns:
Ordered list of chunks with the same structure as search results.
""",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chunk_id": {"type": "string", "description": "Starting chunk id."},
                "direction": {
                    "type": "string",
                    "enum": ["next", "prev", "both"],
                    "default": "both",
                    "description": "Navigation direction.",
                },
                "steps": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "default": 1,
                    "description": "Number of paragraphs to walk.",
                },
            },
            "required": ["chunk_id"],
        },
    },
    {
        "name": "agent_find_similar",
        "description": """\
Given a chunk, find semantically related passages across all scriptures and discourses using vector KNN search.

Returns:
Top 10 semantically similar chunks (from any Granth or Pravachan), each with full metadata.
""",
        "inputSchema": {
            "type": "object",
            "properties": {"chunk_id": {"type": "string", "description": "Source chunk to find similarities for."}},
            "required": ["chunk_id"],
        },
    },
    {
        "name": "agent_get_filter_options",
        "description": """\
Return available filter values before calling search.

Reads live from the metadata index (cataloguesearch_prod_metadata) and automatically reflects new Granths, Anuyogs,
contributors, and date ranges as content is indexed (no code changes needed).

Inputs:
- language: "hi" | "gu"
- content_type: "Pravachan" | "Granth"

Returns:
- granths: list of scripture names
- anuyogs: list of Anuyog classifications
- contributors: unified deduplicated list of all names across Author, Tikakaar, and Bhasha Vachanika
- date_ranges: { GranthName: [{start, end}] } (Pravachan only)
""",
        "inputSchema": {
            "type": "object",
            "properties": {
                "language": {"type": "string", "enum": ["hi", "gu"], "description": "Language context."},
                "content_type": {
                    "type": "string",
                    "enum": ["Pravachan", "Granth", "Books"],
                    "description": "Category context for filter options.",
                },
            },
            "required": ["language", "content_type"],
        },
    },
    {
        "name": "agent_get_pravachan",
        "description": """\
Fetch all chunks of a specific numbered discourse (Pravachan) in order.

Useful when an agent wants to read an entire Pravachan rather than just search results.

Inputs:
- granth: e.g. "Samaysaar"
- pravachan_number: e.g. "93"
- language: "hi" | "gu"

Returns:
All ordered chunks of that Pravachan.
""",
        "inputSchema": {
            "type": "object",
            "properties": {
                "granth": {"type": "string", "description": 'Pravachan series/Granth name (e.g. "Samaysaar").'},
                "pravachan_number": {"type": "string", "description": 'Pravachan number within the series (e.g. "93").'},
                "language": {"type": "string", "enum": ["hi", "gu"], "description": "Language."},
            },
            "required": ["granth", "pravachan_number", "language"],
        },
    },
]


class ExternalApiClient:
    def __init__(self, base_url: str, verify_tls: bool, timeout: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.verify_tls = verify_tls
        self.timeout = timeout
        # Use a Session for connection pooling / keep-alive (faster, fewer TCP handshakes).
        self.session = requests.Session()

    def post(self, path: str, payload: Dict[str, Any]) -> requests.Response:
        url = f"{self.base_url}{path}"
        # requests timeout can be a float or a (connect, read) tuple.
        # A small connect timeout + larger read timeout gives quicker failures when the API is down,
        # while still allowing long-running searches (rerank/knn) to complete.
        timeout: Any = (min(5, self.timeout), self.timeout)
        return self.session.post(url, json=payload, timeout=timeout, verify=self.verify_tls)


class MCPServer:
    def __init__(self, client: ExternalApiClient) -> None:
        self.client = client

    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        msg_id = message.get("id")
        method = message.get("method")
        params = message.get("params") or {}

        if not method:
            return _error_response(msg_id, -32600, "Invalid Request: missing method")

        if method == "initialize":
            result = {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            }
            return _success_response(msg_id, result)

        if method == "initialized":
            return None

        if method == "ping":
            return _success_response(msg_id, {})

        if method == "tools/list":
            return _success_response(msg_id, {"tools": TOOLS})

        if method == "prompts/list":
            return _success_response(
                msg_id,
                {
                    "prompts": [
                        {
                            "name": "about_cataloguesearch",
                            "description": "Explains what CatalogueSearch is and what data this MCP server provides access to.",
                            "arguments": [],
                        },
                        {
                            "name": "cataloguesearch_answering_guidelines",
                            "description": f"Must read workflow and guidelines for using the tool efficiently and writing grounded answers with citations (loaded from {GUIDELINES_FILENAME}).",
                            "arguments": [],
                        },
                    ]
                },
            )

        if method == "prompts/get":
            prompt_name = params.get("name")

            if prompt_name == "about_cataloguesearch":
                return _success_response(
                    msg_id,
                    {
                        "description": "About CatalogueSearch and this MCP server",
                        "messages": [
                            {
                                "role": "user",
                                "content": {"type": "text", "text": CATALOGUESEARCH_CONTEXT},
                            }
                        ],
                    },
                )

            if prompt_name == "cataloguesearch_answering_guidelines":
                guidelines = _load_guidelines()
                return _success_response(
                    msg_id,
                    {
                        "description": "CatalogueSearch answering and usage guidelines - MUST READ FIRST",
                        "messages": [
                            {
                                "role": "user",
                                "content": {"type": "text", "text": guidelines},
                            }
                        ],
                    },
                )

            return _error_response(msg_id, -32602, f"Unknown prompt: {prompt_name}")

        if method == "tools/call":
            return self._handle_tool_call(msg_id, params)

        if method == "resources/list":
            return _success_response(msg_id, {"resources": []})


        return _error_response(msg_id, -32601, f"Method not found: {method}")

    def _handle_tool_call(self, msg_id: Any, params: Dict[str, Any]) -> Dict[str, Any]:
        tool_name = params.get("name")
        arguments = params.get("arguments") or {}

        if tool_name not in {
            "agent_search",
            "agent_navigate",
            "agent_find_similar",
            "agent_get_filter_options",
            "agent_get_pravachan",
        }:
            return _error_response(msg_id, -32602, f"Unknown tool: {tool_name}")

        try:
            result = self._call_external_api(tool_name, arguments)
        except requests.RequestException as exc:
            # Make the error actionable for agents/users by including base_url, tool, and timeout.
            log.exception("HTTP error calling external API")
            diagnostic = {
                "error": str(exc),
                "tool": tool_name,
                "base_url": self.client.base_url,
                "timeout_seconds": self.client.timeout,
                "hints": [
                    "Ensure cataloguesearch-api is running and reachable at EXTERNAL_API_BASE_URL.",
                    "If using docker-compose, confirm the API container is healthy and port 8000 is reachable from your host.",
                    "If calling agent_search with rerank=true, the query may take longer; increase EXTERNAL_API_TIMEOUT or set rerank=false.",
                ],
            }
            return _success_response(
                msg_id,
                {
                    "content": [
                        {
                            "type": "text",
                            "text": _json_dumps(diagnostic),
                        }
                    ],
                    "isError": True,
                },
            )

        return _success_response(
            msg_id,
            {
                "content": [
                    {
                        "type": "text",
                        "text": _json_dumps(result),
                    }
                ]
            },
        )

    def _call_external_api(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        if tool_name == "agent_search":
            arguments = {**arguments, "content_type": ["Books", "Granth"]}
            response = self.client.post("/api/agent/search", arguments)
        elif tool_name == "agent_navigate":
            response = self.client.post("/api/agent/navigate", arguments)
        elif tool_name == "agent_find_similar":
            response = self.client.post("/api/agent/find_similar", arguments)
        elif tool_name == "agent_get_filter_options":
            response = self.client.post("/api/agent/get_filter_options", arguments)
        else:
            response = self.client.post("/api/agent/get_pravachan", arguments)

        if response.status_code >= 400:
            return {
                "error": f"HTTP {response.status_code}",
                "body": response.text,
            }
        if not response.text:
            return None
        return response.json()


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, stream=sys.stderr, format="[mcp] %(levelname)s: %(message)s")


def main() -> int:
    parser = argparse.ArgumentParser(description="CatalogueSearch External API MCP server (stdio).")
    parser.add_argument(
        "--base-url",
        default=os.getenv("EXTERNAL_API_BASE_URL", "http://localhost:8000"),
        help="Base URL for cataloguesearch-api (default: EXTERNAL_API_BASE_URL or http://localhost:8000)",
    )
    parser.add_argument(
        "--verify-tls",
        choices=["true", "false"],
        default=None,
        help="Verify TLS certificates (overrides EXTERNAL_API_VERIFY_TLS)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=int(os.getenv("EXTERNAL_API_TIMEOUT", "120")),
        help="HTTP read timeout in seconds for external API calls (default: EXTERNAL_API_TIMEOUT or 120). "
        "Use a higher value for long-running semantic search/rerank queries.",
    )
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    args = parser.parse_args()

    _configure_logging(args.verbose)

    base_url = args.base_url.rstrip("/")
    if args.verify_tls is None:
        verify_tls = _default_verify_tls(base_url)
    else:
        verify_tls = args.verify_tls == "true"

    print(
        f"[mcp] starting server base_url={base_url} verify_tls={verify_tls} timeout={args.timeout}",
        file=sys.stderr,
        flush=True,
    )
    client = ExternalApiClient(base_url, verify_tls=verify_tls, timeout=args.timeout)
    server = MCPServer(client)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        print(f"[mcp] <- {line}", file=sys.stderr, flush=True)
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            _write_message(_error_response(None, -32700, "Parse error", str(exc)))
            continue

        if not isinstance(message, dict):
            _write_message(_error_response(None, -32600, "Invalid Request: expected object"))
            continue

        try:
            response = server.handle_message(message)
        except Exception as exc:
            log.exception("Unhandled error while handling message")
            response = _error_response(message.get("id"), -32000, f"Server error: {exc}")

        if response is not None and message.get("id") is not None:
            _write_message(response)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
