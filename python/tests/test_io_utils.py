import json

import pytest

from sari_rasa_data.io_utils import read_json_file, write_json_file


def test_write_then_read_round_trip(tmp_path):
    data = {"name": "Nasi Goreng", "quantity": 2}
    path = tmp_path / "order.json"

    write_json_file(path, data)
    result = read_json_file(path)

    assert result == data


def test_read_json_file_raises_for_missing_file(tmp_path):
    missing_path = tmp_path / "does_not_exist.json"

    with pytest.raises(FileNotFoundError):
        read_json_file(missing_path)


def test_read_json_file_raises_for_malformed_json(tmp_path):
    bad_path = tmp_path / "bad.json"
    bad_path.write_text("{not valid json", encoding="utf-8")

    with pytest.raises(json.JSONDecodeError):
        read_json_file(bad_path)


def test_write_json_file_preserves_utf8_content(tmp_path):
    data = {"name": "Sate Ayam", "note": "pedas, tanpa kacang"}
    path = tmp_path / "utf8.json"

    write_json_file(path, data)
    raw_text = path.read_text(encoding="utf-8")

    assert "pedas, tanpa kacang" in raw_text
    assert read_json_file(path) == data


def test_write_json_file_is_deterministic(tmp_path):
    data = {"b": 1, "a": 2}
    path = tmp_path / "deterministic.json"

    write_json_file(path, data)
    first_write = path.read_text(encoding="utf-8")
    write_json_file(path, data)
    second_write = path.read_text(encoding="utf-8")

    assert first_write == second_write
    assert first_write.index('"a"') < first_write.index('"b"')


def test_write_json_file_accepts_string_path(tmp_path):
    data = {"ok": True}
    path = str(tmp_path / "string_path.json")

    result_path = write_json_file(path, data)

    assert read_json_file(result_path) == data
