# 던파랩

던전앤파이터 팬 정보 사이트예요. 캐릭터 검색, 경매장 시세, 명성 랭킹, 아바타 마켓 최근 거래, 아이템 사전을 제공하고, 배너 광고로 운영해요.
운영비는 0원이에요. GitHub Pages, GitHub Actions, Cloudflare Workers 모두 무료 범위에서 돌아가요.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `index.html` | 메인 페이지 |
| `character.html` | 캐릭터 검색 결과와 상세(장비·아바타·크리쳐·능력치) |
| `items.html` | 아이템 사전 |
| `privacy.html` | 개인정보처리방침 (애드센스 신청에 필요) |
| `assets/css/theme.css` | **디자인 값 (색·글꼴·테두리)**. 분위기를 바꿀 땐 이 파일만 고쳐요 |
| `assets/css/style.css` | 화면 배치 |
| `assets/img/hero-bg.svg` | 검색창 뒤 배경 그림 (직접 그린 오리지널) |
| `assets/js/config.js` | **사이트 설정** (Worker 주소, 애드센스 ID) |
| `config/tracked-items.json` | 메인 화면 경매장 시세에 보여줄 아이템 목록 |
| `data/` | GitHub Actions가 1시간마다 채우는 데이터 (직접 고치지 않아요) |
| `scripts/collect.mjs` | 데이터 수집 스크립트 |
| `.github/workflows/collect.yml` | 1시간마다 수집 스크립트를 실행하는 설정 |
| `worker/worker.js` | 캐릭터 검색·아이템 사전용 중계 서버 (Cloudflare Workers) |

## 처음 설정하기

### 1단계. GitHub에 올리기
1. 압축을 풀어요.
2. GitHub 저장소 페이지에서 **Add file → Upload files**를 눌러요.
3. 압축을 푼 폴더 **안의 내용 전체**를 끌어다 놓고 **Commit changes**를 눌러요.
4. 올린 뒤 저장소에 `.github/workflows/collect.yml` 파일이 있는지 꼭 확인해요.
   점(.)으로 시작하는 폴더는 컴퓨터 설정에 따라 숨겨져서 안 올라갈 수 있어요. 없다면:
   **Add file → Create new file**에서 파일 이름 칸에 `.github/workflows/collect.yml`을 입력하고, 압축 파일 안의 같은 파일 내용을 붙여넣어 저장해요.
   `.nojekyll` 파일도 같은 방법으로 빈 파일로 만들어 주세요.

### 2단계. 사이트 띄우기 (GitHub Pages)
1. 저장소 **Settings → Pages**로 가요.
2. **Source**를 `Deploy from a branch`, 브랜치를 `main` / `/(root)`로 고르고 **Save**를 눌러요.
3. 1~2분 뒤 같은 화면 위쪽에 사이트 주소(`https://계정이름.github.io/저장소이름/`)가 나와요.

이 단계까지 하면 화면은 보이지만, 데이터 칸에는 "수집 전" 안내가 나와요.

### 3단계. 네오플 API 키 등록 (경매장 시세·명성 랭킹·아바타 마켓)
1. [네오플 개발자센터](https://developers.neople.co.kr)에 로그인해서 애플리케이션을 등록하고 API 키를 받아요.
2. 저장소 **Settings → Secrets and variables → Actions → New repository secret**을 눌러요.
3. Name에 `NEOPLE_API_KEY`, Secret에 받은 키를 넣고 저장해요. 키는 여기에만 넣고 코드에는 절대 넣지 않아요.
4. 저장소 **Actions** 탭에서 워크플로 사용을 허용하고, **데이터 수집 → Run workflow**를 눌러 첫 수집을 해요.
5. 그 뒤로는 1시간마다 자동으로 수집돼요.

첫 수집 뒤 `data/auction.json`의 `missing` 목록에 이름이 있으면, 그 아이템은 거래가 안 잡힌 거예요. `config/tracked-items.json`에서 이름을 게임 속 이름과 똑같이 고치거나 다른 아이템으로 바꿔요.

### 4단계. 캐릭터 검색·아이템 사전 켜기 (Cloudflare Workers)
API 키가 브라우저에 노출되지 않도록 중간 서버를 하나 둬요. 무료예요.
1. [Cloudflare](https://dash.cloudflare.com/sign-up)에 가입해요.
2. **Workers & Pages → Create → Create Worker**로 기본 Worker를 만들고 **Deploy**해요.
3. **Edit code**를 눌러 기존 코드를 지우고 `worker/worker.js` 내용을 붙여넣은 뒤 **Deploy**해요.
4. Worker의 **Settings → Variables and Secrets**에서 두 가지를 추가해요.
   - `NEOPLE_API_KEY` (종류: Secret): 네오플 API 키
   - `ALLOWED_ORIGIN` (종류: Text): `https://계정이름.github.io`
5. Worker 주소(`https://...workers.dev`)를 복사해요.
6. GitHub에서 `assets/js/config.js`를 열고 연필 아이콘으로 수정해서 `workerUrl`에 주소를 넣고 저장해요.

### 5단계. 개인정보처리방침 채우기
`privacy.html`의 `[시행 날짜]`, `[문의 이메일 주소]`를 실제 내용으로 바꿔요.

### 6단계. 애드센스 붙이기
1. 데이터가 채워지고 며칠 운영한 뒤 [애드센스](https://adsense.google.com)에 사이트 주소로 신청해요.
2. 승인되면 광고 단위 3개(상단, 사이드바, 본문 하단)를 만들어요.
3. `assets/js/config.js`의 `adsenseClient`(`ca-pub-...`)와 `adSlots`에 ID를 넣으면 광고 자리 안내 상자가 실제 광고로 바뀌어요.
4. `ads.txt` 파일은 사이트 주소의 맨 앞(도메인 루트)에 있어야 해요. `계정이름.github.io/저장소이름` 형태의 주소에서는 둘 수 없어서, 이 단계에서 승인이 막히면 도메인을 사서 연결하는 걸 고려해요.

## 자주 하는 수정

- **색·분위기 바꾸기**: `assets/css/theme.css`의 값만 바꿔요.
- **배경 그림 바꾸기**: 새 이미지를 `assets/img/`에 올리고 `assets/css/style.css`의 `.hero` 배경 경로를 바꿔요. 게임 공식 이미지는 사용 허락 없이 쓰지 않아요.
- **시세 아이템 바꾸기**: `config/tracked-items.json`을 고쳐요. 다음 수집부터 반영돼요.

## 다른 PC에서 작업하기
모든 파일이 이 저장소에 있으니, 어느 PC에서든 GitHub 웹 화면에서 바로 고치거나 저장소를 내려받아 작업하면 돼요.
작업 현황과 결정 사항은 Claude 프로젝트 "페이지 제작"의 `던파랩-작업현황` 문서에 정리되어 있어요.

## 출처 표기
게임 데이터는 네오플 오픈 API를 사용해요 (Powered by Neople Open API).
던전앤파이터의 상표와 게임 콘텐츠의 권리는 (주)네오플에 있어요. 이 사이트는 공식 사이트가 아닌 팬 정보 사이트예요.
