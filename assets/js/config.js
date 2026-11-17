/*
 * 던파노트 사이트 설정
 * ------------------------------------------------------------
 * 사이트를 올린 뒤 여기 값만 채우면 기능이 켜져요.
 */
window.DNF_CONFIG = {
  // 캐릭터 검색·아이템 사전에 쓰는 Cloudflare Worker 주소 (README의 4단계)
  // 예: 'https://dnfnote-api.계정이름.workers.dev'
  workerUrl: 'https://dunpa-api.tnrns144.workers.dev',

  // 구글 애드센스 (README의 6단계). 승인 전에는 비워두면 광고 자리에 안내 상자가 보여요.
  adsenseClient: '',            // 예: 'ca-pub-1234567890123456'
  adSlots: {
    top: '',                    // 상단 가로 배너 광고 단위 ID
    side: '',                   // 사이드바 광고 단위 ID
    bottom: ''                  // 본문 하단 광고 단위 ID
  }
};
