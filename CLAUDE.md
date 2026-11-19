# 던랩 (DUNPA) — Claude Code 작업 안내

던전앤파이터 팬 정보 사이트 "던랩"(던파 + Lab, 2026-11-18에 "던파노트"에서 개명). 콘셉트는 던파풍 마도 연구소. 배너 광고(구글 애드센스)로 수익을 내는 것이 목표이고, 제작·운영비는 0원으로 유지한다.
여러 게임 정보 사이트를 하나씩 만들어 갈 계획의 첫 번째 사이트다.

## 사용자와 일하는 방식
- 한국어로 대화한다. 사용자는 개발자가 아니므로 전문 용어는 풀어서 설명하고, 사용자가 직접 해야 하는 일은 단계별로 안내한다.
- 사용자는 지금 게임을 하지 않는다. 게임 내용은 직접 확인하지 못하므로 API 데이터로 자동으로 채워지는 기능을 우선한다.
- 유료 서비스는 쓰지 않는다. 무료 범위(GitHub Pages, GitHub Actions, Cloudflare Workers 무료 플랜) 안에서 해결한다.
- 여러 PC에서 작업한다. 작업물은 항상 이 저장소에 커밋·푸시해서 남긴다.

## 주소와 설정
- 사이트: https://tnrns144-lgtm.github.io/DUNPA/ (GitHub Pages, main 브랜치 루트에서 배포)
- 저장소: https://github.com/tnrns144-lgtm/DUNPA (공개)
- 실시간 조회 Worker: https://dunpa-api.tnrns144.workers.dev (Cloudflare Workers, 이름 `dunpa-api`)
  - 변수: `NEOPLE_API_KEY`(Secret), `ALLOWED_ORIGIN`=`https://tnrns144-lgtm.github.io`
  - `worker/worker.js`를 고치면 Cloudflare 대시보드에서 코드를 다시 붙여넣고 Deploy해야 반영된다 (자동 배포 아님).
- GitHub Secrets: `NEOPLE_API_KEY` (데이터 수집용)
- 문의 이메일: hagomstudio.support@gmail.com
- 구글 서치 콘솔: URL 접두어 속성으로 등록, sitemap.xml 제출 완료 (2026-11-17). 저장소 루트의 `google*.html`은 서치 콘솔 인증 파일이라 지우면 안 된다.
- API 키는 절대 코드나 커밋에 넣지 않는다.

## 구조
- 빌드 과정 없는 정적 사이트 (HTML/CSS/바닐라 JS). 프레임워크를 도입하지 않는다.
- `index.html` 메인 / `character.html` 캐릭터 검색·상세(장비·아바타·크리쳐·능력치 탭) / `items.html` 아이템 사전 / `avatar.html` 아바타 마켓(판매 중·최근 거래, 게임 속 부위 칸 배치) / `privacy.html` 개인정보처리방침 / `sitemap.xml`
- `assets/css/theme.css`: 색·글꼴·테두리 등 디자인 값 전부 (현재: 어두운 청록 바탕 + 마력 빛 하늘색 강조 + 설계도 격자, 숫자는 JetBrains Mono). style.css에는 색을 직접 적지 말고 theme.css 변수만 쓴다. 분위기 변경은 이 파일만 고친다. 다음 게임 사이트도 이 파일만 바꿔 배치를 재활용한다.
- `assets/css/style.css`: 배치. `assets/js/common.js`: 공통 기능(데이터 로드, 숫자 표시, 등급색, 최근 검색, 광고). `home.js` / `character.js` / `items.js`: 페이지별 기능.
- `assets/js/config.js`: `workerUrl`(입력 완료), `adsenseClient`·`adSlots`(애드센스 승인 후 입력. 비어 있으면 광고 자리에 안내 상자 표시). 광고 자리는 화면 양쪽 여백의 세로 배너 `railLeft`·`railRight`(common.js가 모든 페이지에 자동 삽입, 폭 1680px 이상에서만 보임. 히어로 그림 아래에서 시작해 스크롤 시 위에 붙어 따라오고 푸터 앞에서 멈춤. 광고 연결 전에는 숨김)와 본문 맨 아래 `bottom`(광고 연결 전에는 자리만 두고 숨김)뿐. 본문 중간·사이드바 배너는 사용자가 거슬린다고 해서 뺐다.
- `assets/img/hero-bg.svg`: 검색창 뒤 배경. 직접 그린 오리지널 그림(밤의 마도 연구실: 마법진·홀로그램 계기판·플라스크). 게임 공식 이미지는 허락 없이 쓰지 않는다. 게임 이미지는 API가 주는 `img-api.neople.co.kr` 주소만 쓴다.
- 옛 디자인 시안(던파노트 시절 금색 팬사이트 스타일, 배치 참고용): https://claude.ai/artifact/KmYqVLKmnZWF5W4Ert1gPj

## 데이터 수집 (GitHub Actions)
- `.github/workflows/collect.yml`이 매시 17분에 `scripts/collect.mjs`를 실행하고, 바뀐 `data/`를 커밋한다.
- 로컬 실행: `NEOPLE_API_KEY=키 node scripts/collect.mjs` (`NEOPLE_API_BASE`로 API 주소를 바꿔 모의 서버 테스트 가능)
- 결과 파일: `data/auction.json`, `data/fame.json`, `data/avatar.json`, `data/servers.json`, `data/meta.json`, `data/history/auction-daily.json`(전일 대비 계산용, 30일 보관), `data/trends.json`(랭커 트렌드), `data/history/trends-daily.json`(관측 일지용 날짜별 장착 수, 30일 보관)
- 경매장 시세: `config/tracked-items.json`의 `items`(정확한 이름, 항상 표시) + `keywords`(이름에 들어간 단어로 `wordType=full` 검색 후 거래 많은 순으로 `top`개 자동 선택). 정확한 이름만 쓰던 첫 방식은 이름이 틀려서 실패했기 때문에 키워드 방식으로 바꿨다.
- 명성 랭킹: `/df/servers/all/characters-fame?limit=200` + 서버별 50. API가 최고 명성 기준 2,000 범위만 돌려줘서 실제 개수는 더 적다.
- 아바타 마켓: `/df/avatar-market/sale`을 등급(상급·레어·혼합) × 정렬(goodsNo:desc, price:asc)로 6번 받아 합치고(한 번에 최대 50개), `/sold`는 최근 50개. 결과는 `data/avatar.json`의 `sale`·`sold`. 응답 필드가 문서에 없어서 `pickGoods`가 여러 이름을 대비하고, Actions 로그에 "아바타 판매 응답 필드"를 찍는다(실제 필드 확인용).
- 랭커 트렌드: fame.json의 전체 상위 캐릭터마다 `equip/equipment`(칭호 slotId TITLE)·`equip/avatar`(오라 AURORA, 무기 WEAPON, 클론 우선)·`equip/creature`를 조회해 많이 쓰는 순 TOP 10 집계. 약 600회 호출이라 **하루 1번만** 실행(trends.json이 20시간 이내면 건너뜀). Actions 수동 실행 때 `force_trends`를 체크하면 바로 다시 모은다. 직업 분포는 화면에서 fame.json으로 바로 계산한다.
- 로컬 테스트: 이 PC에 Node.js v26 설치됨(`C:/Program Files/nodejs`). 실제 data를 덮어쓰지 않도록 임시 폴더에 복사해서 모의 서버(`NEOPLE_API_BASE`)로 돌린다.

## 네오플 오픈 API 메모
- 기본 주소 `https://api.neople.co.kr`, 키는 `apikey` 쿼리 변수.
- 서버 ID: cain 카인, diregie 디레지에, siroco 시로코, prey 프레이, casillas 카시야스, hilder 힐더, anton 안톤, bakal 바칼, 전체 검색은 `all`
- 캐릭터 이미지: `https://img-api.neople.co.kr/df/servers/{serverId}/characters/{characterId}?zoom=1~3`
- 아이템 이미지: `https://img-api.neople.co.kr/df/items/{itemId}`
- 문서: https://developers.neople.co.kr/contents/apiDocs/df
- 푸터에 "Powered by Neople Open API" 출처와 비공식 팬사이트 안내를 유지한다.

## 시뮬레이터 조사 결과 (2026-11-19)
- 강화 시뮬레이터: 공식 확률 공개됨. 강화 https://df.nexon.com/probability?no=139 , 증폭 no=140, 실패 규칙 https://df.nexon.com/guide?no=710 (강화)·727 (증폭). 재련 확률과 일반 강화 비용은 미공개. 확률 페이지에 날짜가 없어 주기적으로 재확인.
- 명성 계산: `/df/items/{itemId}`에 아이템별 `fame`이 있어 기본 명성 합은 정확. `equip/equipment`에는 아이템별 fame이 없고 강화·증폭·재련·마법부여·조율 값만 있음. 강화 등으로 붙는 명성은 공식 공식이 없어 랭커 실측(총명성 − 기본 명성 합)으로 역산 추정해야 함.
- 아바타 룩: API 이미지는 캐릭터 현재 모습 1장과 아이템 아이콘뿐이라 "입혀보기"는 불가(게임 파일 추출은 이미지 원칙 위반). 대안: 부위 아이콘 코디 보드, 같은 아바타를 입은 랭커 캐릭터 이미지 모음.

## 현재 상태 (2026-11-19)
- 완료: 사이트 개통, 데이터 자동 수집, 캐릭터 검색·상세, 아이템 사전, 개인정보처리방침, 서치 콘솔 등록·색인 요청, 아바타 마켓 섹션을 "랭커 트렌드"(직업 분포·칭호/크리쳐/오라/무기 아바타 TOP 10)로 개편하고 아바타 거래는 한 줄 목록 5건으로 축소, 사이트 이름을 던랩으로 바꾸고 연구소 분위기로 디자인 개편, 특색 기능 2개 추가: ① 캐릭터 연구 보고서(character.js `renderReport`: 명성 순위·직업 점유·칭호/크리쳐/오라/무기 아바타를 랭커와 비교해 "랭커 싱크로율" 계산) ② 관측 일지(메인 랭커 트렌드의 전날 대비 ▲▼/NEW와 급상승 TOP 5, trends.json의 `risers`·`prevDate`), 아바타 마켓 전용 페이지(avatar.html), 직업 분포를 전체 대비 %로 변경, 연구실(lab.html): ① 강화·증폭·안전 강화 시뮬레이터(`enhance-engine.js`가 계산 전담, Node로 검산 가능. 평균은 연립방정식으로 정확 계산, 분포는 반복 실험. 비용은 증폭·안전 강화 공식 값 자동, 일반 강화는 사용자 입력. 재료·보호권 시세는 config `reference` → auction.json `reference`) ② 명성 계산기(`fame-calc.js`: Worker 'item'으로 장착품별 공식 기본 명성 합산, 부위 바꿔보기. 현재 명성 − 기본 합 = "그 외 명성"인데 1위 캐릭터 기준 70% 이상이라 강화 외 요소도 섞여 있을 수 있음), 랭커 룩 갤러리(메인 랭커 트렌드 항목 클릭 → trends.json `wearers`의 착용 랭커 캐릭터 이미지)
- 남은 일
  1. 서치 콘솔 색인 상태 확인 (등록 후 며칠~2주)
  2. 며칠 운영 후 애드센스 신청. `계정.github.io/저장소` 형태 주소는 루트에 `ads.txt`를 둘 수 없어서 승인이 막히면 도메인 구매(연 1~2만 원)를 검토한다.
  3. (확인 완료) 랭커 트렌드 slotId는 예상대로 동작. 공용 "OO 클론 아바타"는 원래 아바타로 집계하도록 고침.
  4. "많이 검색된 캐릭터"는 서버 쪽 기록이 필요해서 현재는 "내 최근 검색"(브라우저 저장)으로 대체해 두었다.
  5. 다음 게임 사이트 준비 (국내 RPG 관심도와 공식 API 유무를 기준으로 고른다. 메이플스토리·로스트아크도 공식 API가 있다).
