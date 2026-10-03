import json
import os
import subprocess
import sys
from pathlib import Path

import pdfplumber


def configure_output():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")


def find_pdftoppm():
    candidates = [os.environ.get("PDFTOPPM"), str(Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe"), "pdftoppm"]
    for candidate in candidates:
        if candidate and (candidate == "pdftoppm" or Path(candidate).exists()):
            return candidate
    raise RuntimeError("pdftoppm을 찾을 수 없습니다.")


def clean_grid(grid):
    return [[(cell or "").replace("\x00", "").strip() for cell in row] for row in (grid or [])]


def normalize_grid(grid):
    grid = [row for row in clean_grid(grid) if any(row)]
    if not grid:
        return []
    columns = max(len(row) for row in grid)
    grid = [row + [""] * (columns - len(row)) for row in grid]
    keep = [index for index in range(columns) if any(row[index] for row in grid)]
    return [[row[index] for index in keep] for row in grid]


def render_manifest(pdf_path, cache_dir):
    configure_output()
    pdf_path, cache_dir = Path(pdf_path), Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    if not list(cache_dir.glob("page-*.png")):
        subprocess.run([find_pdftoppm(), "-png", "-r", "110", str(pdf_path), str(cache_dir / "page")], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for number, page in enumerate(pdf.pages, start=1):
            image_path = cache_dir / f"page-{number:02d}.png"
            if not image_path.exists():
                image_path = cache_dir / f"page-{number}.png"
            pages.append({"number": number, "width": page.width, "height": page.height, "imagePath": str(image_path.resolve())})
    print(json.dumps({"fileName": pdf_path.name, "pages": pages}, ensure_ascii=False))


def score_grid(grid):
    if not grid:
        return -1
    columns = max((len(row) for row in grid), default=0)
    filled = sum(bool(cell) for row in grid for cell in row)
    return len(grid) * columns * 2 + filled


def parse_region(pdf_path, page_number, bbox, mode):
    configure_output()
    with pdfplumber.open(pdf_path) as pdf:
        if page_number < 1 or page_number > len(pdf.pages):
            raise ValueError("페이지 번호가 올바르지 않습니다.")
        page = pdf.pages[page_number - 1]
        x0, top, x1, bottom = map(float, bbox)
        x0, x1 = sorted((max(0, x0), min(float(page.width), x1)))
        top, bottom = sorted((max(0, top), min(float(page.height), bottom)))
        if x1 - x0 < 8 or bottom - top < 8:
            raise ValueError("선택 영역이 너무 작습니다.")
        crop = page.crop((x0, top, x1, bottom))
        settings_list = []
        if mode in ("auto", "lines"):
            settings_list.append(("선 기반", {"vertical_strategy": "lines", "horizontal_strategy": "lines", "intersection_tolerance": 6, "snap_tolerance": 5, "join_tolerance": 5}))
        if mode in ("auto", "text"):
            settings_list.append(("텍스트 기반", {"vertical_strategy": "text", "horizontal_strategy": "text", "min_words_vertical": 2, "min_words_horizontal": 1, "intersection_tolerance": 7, "snap_tolerance": 5}))
        candidates = []
        for strategy, settings in settings_list:
            for table in crop.find_tables(settings):
                grid = normalize_grid(table.extract())
                if grid and any(any(cell for cell in row) for row in grid):
                    line_bonus = 10000 if strategy == "선 기반" and len(grid) > 1 and max(map(len, grid)) > 1 else 0
                    candidates.append((line_bonus + score_grid(grid), strategy, grid))
        if not candidates:
            raise ValueError("선택 영역에서 표 구조를 찾지 못했습니다. 영역을 넓히거나 다른 파싱 방식을 선택해 보세요.")
        _, strategy, grid = max(candidates, key=lambda item: item[0])
        columns = max(len(row) for row in grid)
        grid = [row + [""] * (columns - len(row)) for row in grid]
        print(json.dumps({"data": grid, "merges": [], "strategy": strategy, "bbox": [x0, top, x1, bottom]}, ensure_ascii=False))


if __name__ == "__main__":
    if sys.argv[1] == "manifest":
        render_manifest(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "parse":
        parse_region(sys.argv[2], int(sys.argv[3]), json.loads(sys.argv[4]), sys.argv[5])
    else:
        raise ValueError("알 수 없는 실행 모드입니다.")
