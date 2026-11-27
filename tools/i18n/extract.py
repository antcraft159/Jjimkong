"""찜콩 번역 원문 뽑기: tools/i18n/source.json 을 만든다.

화면(index.html) 문구는 브라우저가 translatePage 와 똑같이 읽은 열쇠로 뽑고,
JS 문구는 t('…') 안의 글을, 서버(구글 시트 Code.gs) · 체험 서버 문구는 아래 SERVER 목록을 쓴다.
사용법(guide.html)은 <main> 통째로 넘긴다.
실행: py -I tools/i18n/extract.py   (Playwright · Edge 필요)
"""
import json
import pathlib
import re

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'tools' / 'i18n' / 'source.json'

PAGE_JS = r"""() => {
  const norm = text => String(text).replace(/\s+/g, ' ').trim();
  const hangul = /[가-힣]/;
  const found = [];
  const add = (key, context) => { if (key && hangul.test(key)) found.push({ key, context }); };
  const where = element => {
    const parts = [];
    for (let node = element; node && node !== document.body && parts.length < 3; node = node.parentElement) {
      parts.unshift(node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\s+/).join('.') : ''));
    }
    return parts.join(' > ');
  };
  document.querySelectorAll('[data-i18n]').forEach(element => add(norm(element.innerHTML), 'HTML(태그 유지) ' + where(element)));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement && node.parentElement.closest('script, style, [data-i18n], [data-i18n-skip]')) continue;
    add(norm(node.nodeValue), '화면 글자 ' + where(node.parentElement));
  }
  document.querySelectorAll('[placeholder], [title], [aria-label]').forEach(element => {
    for (const name of ['placeholder', 'title', 'aria-label']) add(norm(element.getAttribute(name) || ''), name + ' 속성 ' + where(element));
  });
  add(norm(document.title), '브라우저 탭 제목');
  return found;
}"""

SERVER = [
    ('같은 이름이 너무 많아요. 이름을 조금 다르게 적어 주세요.', '같은 이름 뒤에 B~Z 를 다 붙여도 겹칠 때'),
    ('관리자만 할 수 있습니다. 관리자 QR 로 다시 연결해 주세요.', 'not-admin'),
    ('모르는 요청입니다. 앱을 최신 판으로 올려 주세요.', 'bad-action'),
    ('그 사이 다른 분이 먼저 잡았어요. 다른 자리를 골라 주세요.', 'taken'),
    ('이미 자리를 잡으셨어요. 자리를 바꾸려면 내 자리를 먼저 누르세요.', 'limit'),
    ('한 사람이 {n}자리까지 잡을 수 있어요.', 'limit, n = 숫자'),
    ('내 자리만 바꿀 수 있어요. 좌석표를 새로 불러올게요.', 'not-mine'),
    ('이미 잡으신 자리예요. 좌석표를 새로 불러올게요.', 'already-mine'),
    ('내 자리만 취소할 수 있어요.', 'not-mine'),
    ('같은 이름에 같은 비밀번호를 쓰는 분이 있어요. 다른 번호를 골라 주세요.', 'pin-used'),
    ('이름이나 비밀번호가 맞지 않아요. 비밀번호를 정할 때 쓴 이름 그대로 적어 주세요.', 'pin-wrong'),
    ('틀린 횟수가 많아요. 10분 뒤에 다시 해 주세요.', 'pin-locked'),
    ('비밀번호는 숫자 4자리로 적어 주세요.', 'bad-pin'),
    ('배치도를 읽지 못했습니다.', 'bad-request'),
    ('좌석은 {n}개까지 만들 수 있습니다.', 'too-many, n = 숫자'),
    ('배치도에 잘못된 자리가 있습니다: {id}', 'bad-request, id = 좌석 ID(번역 안 함)'),
    ('같은 좌석ID 가 두 번 있습니다: {id}', 'bad-request, id = 좌석 ID'),
    ('없는 층의 자리가 있습니다: {id}', 'bad-request, id = 좌석 ID'),
    ('그 사이 예약한 분이 바뀌었어요. 좌석표를 새로 불러올게요.', 'changed'),
    ('층은 {n}개까지 만들 수 있습니다.', 'too-many, n = 숫자'),
    ('층 모양을 읽지 못했습니다.', 'bad-request'),
    ('물건은 {n}개까지 그릴 수 있습니다.', 'too-many, n = 숫자'),
    ('배치도의 물건을 읽지 못했습니다.', 'bad-request'),
    ('외벽을 읽지 못했습니다.', 'bad-request'),
    ('비워 둔 자리라 예약할 수 없어요.', 'blocked'),
    ('배치도가 바뀌었어요. 좌석표를 새로 불러올게요.', 'no-seat'),
    ('사람이 많아 잠시 밀렸어요. 조금 뒤 다시 눌러 주세요.', 'busy'),
    ('아직 예약을 받지 않아요.', 'not-published'),
    ('지금은 예약 시간이 아니에요.', 'closed'),
    ('기기 정보가 없습니다. 앱을 다시 켜 주세요.', 'bad-request'),
    ('이름을 먼저 적어 주세요.', 'no-name'),
    ('요청을 읽지 못했습니다.', 'bad-request'),
    ('서버에서 문제가 생겼습니다. 잠시 뒤 다시 해 주세요.', 'server'),
]

NAMES = [
    ('강대상', '배치도 물건 이름: 설교자가 서는 받침대(pulpit/lectern)'),
    ('출입문', '배치도 물건 이름: 출입문(door)'),
    ('창문', '배치도 물건 이름: 창문(window)'),
    ('에어컨', '배치도 물건 이름: 에어컨'),
    ('TV · 화면', '배치도 물건 이름: TV/프로젝터 화면'),
    ('스피커', '배치도 물건 이름: 스피커'),
    ('기둥', '배치도 물건 이름: 기둥(pillar)'),
    ('1인 의자', '의자 종류: 혼자 앉는 의자'),
    ('책상 의자', '의자 종류: 책상이 붙은 의자'),
    ('장의자', '의자 종류: 여러 명이 앉는 긴 의자(pew)'),
    ('보조 의자', '의자 종류: 임시로 놓는 보조 의자'),
]

T_CALL = re.compile(r"""\bt\((['"])((?:\\.|(?!\1).)*)\1""")


def js_keys():
    found = []
    for name in ['app.js', 'stats.js', 'api.js', 'links.js', 'geometry.js', 'demo.js']:
        text = (ROOT / 'js' / name).read_text(encoding='utf-8')
        for number, line in enumerate(text.splitlines(), 1):
            for match in T_CALL.finditer(line):
                raw = match.group(2)
                key = re.sub(r"\\(.)", lambda m: {'n': '\n', 't': '\t'}.get(m.group(1), m.group(1)), raw)
                if re.search('[가-힣]', key):
                    found.append({'key': key, 'context': f'{name}:{number}: {line.strip()[:220]}'})
    return found


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge')
        page = browser.new_page()
        page.goto((ROOT / 'index.html').as_uri())
        page.evaluate("localStorage.setItem('jjimkong.lang', 'ko')")
        page.reload()
        page.wait_for_timeout(500)
        html_keys = page.evaluate(PAGE_JS)
        guide = browser.new_page()
        guide.goto((ROOT / 'guide.html').as_uri())
        guide_html = guide.evaluate("document.querySelector('main.guide').innerHTML")
        guide_title = guide.evaluate('document.title')
        browser.close()

    entries = {}
    for item in html_keys + js_keys() + [{'key': k, 'context': '서버(구글 시트) 오류 문구: ' + c} for k, c in SERVER] + [{'key': k, 'context': c} for k, c in NAMES] + [{'key': guide_title, 'context': '사용법 페이지 브라우저 탭 제목'}]:
        if item['key'] in entries:
            if item['context'] not in entries[item['key']] and len(entries[item['key']]) < 3:
                entries[item['key']].append(item['context'])
        else:
            entries[item['key']] = [item['context']]

    data = {'keys': [{'key': k, 'context': ' / '.join(v)} for k, v in entries.items()], 'guide': guide_html.strip()}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    print(len(data['keys']), 'keys,', len(data['guide']), 'chars of guide')


if __name__ == '__main__':
    main()
