import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = REPO_ROOT / "python" / "src"


def _run_entry_point() -> str:
    """Run `python -m sari_rasa_data` as a real subprocess and return stdout."""
    env = dict(os.environ)
    env["PYTHONPATH"] = str(SRC_DIR)
    result = subprocess.run(
        [sys.executable, "-m", "sari_rasa_data"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def test_entry_point_runs_and_reports_expected_structure():
    report = json.loads(_run_entry_point())

    assert report["order"]["customer_name"] == "Budi"
    assert report["order"]["item_count"] == 2
    assert report["order"]["total"] == 45000
    assert report["total_quantity"] == 5
    assert report["count_by_category"] == {"Makanan": 1, "Minuman": 1}


def test_entry_point_output_is_deterministic():
    assert _run_entry_point() == _run_entry_point()
