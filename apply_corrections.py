"""
ブラウザの解答一括修正リストからエクスポートした corrections.json を
data/*.json に反映して GitHub にプッシュするためのスクリプト

使い方:
  python apply_corrections.py              # corrections.json を自動検索
  python apply_corrections.py my_fix.json  # ファイル名を指定
"""
import sys
import json
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

DATA_DIR = Path(__file__).parent / "data"

def load_corrections(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def apply(corrections):
    total_changed = 0
    files_changed = []

    for json_file in sorted(DATA_DIR.glob("*.json")):
        if json_file.name == "index.json":
            continue

        with open(json_file, encoding="utf-8") as f:
            data = json.load(f)

        meta = data.get("meta", {})
        year = meta.get("year", "")
        period = meta.get("period", "")
        changed = False

        for q in data["questions"]:
            key = f"{year}_{period}_No{q['number']}"
            if key in corrections:
                old_ans = q.get("answer")
                new_ans = corrections[key]
                if old_ans != new_ans:
                    print(f"  {key}: {old_ans} → {new_ans}")
                    q["answer"] = new_ans
                    changed = True
                    total_changed += 1

        if changed:
            with open(json_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            files_changed.append(json_file.name)
            print(f"  ✅ {json_file.name} を更新")

    print(f"\n合計 {total_changed}問 修正しました（{len(files_changed)}ファイル）")
    if total_changed > 0:
        print("\n次のコマンドで GitHub に反映できます:")
        print('  git add data/')
        print('  git commit -m "解答修正"')
        print("  git push")

def main():
    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
    else:
        candidates = [
            Path(__file__).parent / "corrections.json",
            Path.home() / "Downloads" / "corrections.json",
        ]
        path = next((p for p in candidates if p.exists()), None)
        if path is None:
            print("corrections.json が見つかりません。")
            print("解答一括修正画面で「修正データをダウンロード」してから実行してください。")
            print("または: python apply_corrections.py <ファイルパス>")
            return

    print(f"読み込み: {path}")
    corrections = load_corrections(path)
    print(f"修正対象: {len(corrections)}問\n")

    if not corrections:
        print("修正データが空です。")
        return

    apply(corrections)

if __name__ == "__main__":
    main()
