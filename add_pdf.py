"""
追加PDF抽出スクリプト
新しい過去問PDFをクイズデータに追加する

使い方:
  python add_pdf.py <PDFファイルパス> [オプション]

例:
  python add_pdf.py 土木2級1次過去問2.pdf
  python add_pdf.py 新しい過去問.pdf --id "R2後期" --title "令和2年度第一次検定（後期）"

追加されたJSONファイルはquiz/dataフォルダに保存され、
index.jsonに自動的に追記されます。
ブラウザでindex.htmlを開き直すと新しい問題が表示されます。

また、quiz画面の「PDFを追加」からJSONファイルを直接読み込むこともできます。
"""

import re
import json
import sys
import argparse
from pathlib import Path
import pdfplumber

# 既存スクリプトのロジックを流用
sys.path.insert(0, str(Path(__file__).parent))
from extract_quiz import (
    clean_text, find_textbook_pages, parse_answer_key,
    extract_questions_from_pages, OUTPUT_DIR
)

def main():
    parser = argparse.ArgumentParser(description='追加PDF過去問データ抽出')
    parser.add_argument('pdf', help='PDFファイルパス')
    parser.add_argument('--id', help='試験ID (例: R2後期)', default=None)
    parser.add_argument('--title', help='試験名称', default=None)
    parser.add_argument('--year', help='年度 (例: 令和2)', default=None)
    parser.add_argument('--period', help='期 (前期/後期)', default=None)
    parser.add_argument('--start', type=int, help='問題開始ページ', default=1)
    parser.add_argument('--end', type=int, help='問題終了ページ', default=None)
    parser.add_argument('--answer-page', type=int, help='解答ページ', default=None)
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        print(f'エラー: {pdf_path} が見つかりません')
        sys.exit(1)

    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        print(f'PDF: {pdf_path.name} ({total_pages}ページ)')

        # IDと名称を自動生成
        exam_id = args.id or pdf_path.stem
        title = args.title or pdf_path.stem
        year = args.year or '不明'
        period = args.period or '不明'
        start_page = args.start
        end_page = args.end or (total_pages - 5 if total_pages > 5 else total_pages)
        answer_page = args.answer_page

        print(f'ID: {exam_id}')
        print(f'タイトル: {title}')
        print(f'問題ページ: {start_page} 〜 {end_page}')
        print(f'解答ページ: {answer_page}')

        # 解答の抽出
        answers = {}
        if answer_page:
            answers = parse_answer_key(pdf, answer_page)
            print(f'解答数: {len(answers)}')

        # 問題の抽出
        questions = extract_questions_from_pages(pdf, start_page, end_page, exam_id)
        print(f'問題数: {len(questions)}')

        # 解答をマッピング
        for q in questions:
            q['answer'] = answers.get(q['number'])

        data = {
            'meta': {
                'id': exam_id,
                'title': title,
                'year': year,
                'period': period,
                'source_pdf': pdf_path.name,
                'answer_page': answer_page,
                'total_questions': len(questions)
            },
            'questions': questions
        }

        # JSONを保存
        output_file = OUTPUT_DIR / f'{exam_id}.json'
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f'\n保存: {output_file}')

        # index.jsonを更新
        index_file = OUTPUT_DIR / 'index.json'
        if index_file.exists():
            with open(index_file, encoding='utf-8') as f:
                index = json.load(f)
        else:
            index = {'exams': []}

        # 既存エントリを更新または追加
        existing = next((i for i, e in enumerate(index['exams']) if e['id'] == exam_id), None)
        if existing is not None:
            index['exams'][existing] = data['meta']
        else:
            index['exams'].append(data['meta'])

        with open(index_file, 'w', encoding='utf-8') as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
        print(f'index.json 更新完了')
        print('\n完了! quiz/index.htmlを開き直してください。')


if __name__ == '__main__':
    main()
