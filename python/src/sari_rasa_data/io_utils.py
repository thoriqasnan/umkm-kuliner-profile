"""Phase 4A-2 foundation exercises: pathlib and JSON basics.

This module is for learning and validation only. It reads and writes plain
JSON files on the local filesystem. It does not touch SQLite, Node.js, or
any external service.
"""

import json
from pathlib import Path


def read_json_file(path: Path | str) -> dict | list:
    """Read a UTF-8 JSON file and return the parsed Python value.

    Raises FileNotFoundError if the path does not exist, and
    json.JSONDecodeError if the file is not valid JSON.
    """
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"no such file: {file_path}")

    text = file_path.read_text(encoding="utf-8")
    return json.loads(text)


def write_json_file(path: Path | str, data: dict | list) -> Path:
    """Write a JSON-compatible value to a UTF-8 file and return its Path.

    Output is deterministic: keys are sorted and indentation is fixed,
    so writing the same data twice produces the same bytes.
    """
    file_path = Path(path)
    text = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
    file_path.write_text(text, encoding="utf-8")
    return file_path
