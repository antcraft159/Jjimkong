"""번역 결과(tools/i18n/out/<code>.json)를 검사하고 js/lang/<code>.js 로 만든다.
실행: py -I tools/i18n/build.py
"""
import collections
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = json.loads((ROOT / 'tools' / 'i18n' / 'source.json').read_text(encoding='utf-8'))
OUT = ROOT / 'tools' / 'i18n' / 'out'
LANG_DIR = ROOT / 'js' / 'lang'
CODES = ['en', 'es', 'ru', 'mn', 'fr', 'de', 'ja', 'zh-CN', 'zh-TW', 'tl', 'ceb', 'it', 'th', 'ne', 'id', 'pt', 'ky', 'km', 'vi']

PLACE = re.compile(r'\{\w+\}')
TAG = re.compile(r'</?([a-zA-Z][a-zA-Z0-9]*)\b')


def problems_for(data):
    found = []
    dictionary = data.get('dict', {})
    for entry in SOURCE['keys']:
        key = entry['key']
        value = dictionary.get(key)
        if not isinstance(value, str) or not value.strip():
            found.append(f'빠짐: {key[:60]}')
            continue
        if collections.Counter(PLACE.findall(key)) != collections.Counter(PLACE.findall(value)):
            found.append(f'자리표시 다름: {key[:60]} → {value[:60]}')
        if collections.Counter(TAG.findall(key)) != collections.Counter(TAG.findall(value)):
            found.append(f'태그 다름: {key[:60]} → {value[:60]}')
    guide = data.get('guide', '')
    if TAG.findall(guide) != TAG.findall(SOURCE['guide']):
        found.append('사용법 태그 순서가 원문과 다름')
    if re.search('[가-힣]{6,}', re.sub(r'<!--.*?-->|\[[^\]]*\]|\([^)]*\)', '', guide, flags=re.S)):
        found.append('사용법에 번역 안 된 한국어 문장이 남은 듯함')
    return found


def main():
    LANG_DIR.mkdir(exist_ok=True)
    bad = 0
    for code in CODES:
        path = OUT / f'{code}.json'
        if not path.exists():
            print(f'{code}: 아직 없음')
            continue
        data = json.loads(path.read_text(encoding='utf-8'))
        found = problems_for(data)
        if found:
            bad += 1
            print(f'{code}: 문제 {len(found)}개')
            for line in found[:15]:
                print('   ', line)
            continue
        keys = {entry['key'] for entry in SOURCE['keys']}
        dictionary = {k: v for k, v in data['dict'].items() if k in keys}
        body = ('window.JJIM_DICT = ' + json.dumps(dictionary, ensure_ascii=False, indent=0) + ';\n'
                'window.JJIM_GUIDE = ' + json.dumps(data['guide'], ensure_ascii=False) + ';\n')
        (LANG_DIR / f'{code}.js').write_text(body.replace('</script', '<\\/script'), encoding='utf-8', newline='\n')
        print(f'{code}: 좋음 → js/lang/{code}.js')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
