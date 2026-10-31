// /api/rain
// 서울시 강우량 정보(10분 단위)를 받아 서울 전체 기준
//  - 최근 10분 평균 강우량
//  - 마지막으로 비가 내린 뒤 지난 시간(분)
// 을 계산해 돌려줍니다. 웹앱은 이 주소가 응답하면 "실시간 모드"로 켜집니다.

module.exports = async (req, res) => {
  const key = process.env.SEOUL_API_KEY;
  if (!key) return res.status(500).json({ ok: false, error: 'SEOUL_API_KEY 환경변수가 설정되지 않았습니다.' });

  const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/ListRainfallService/1/1000/`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    const svc = j.ListRainfallService;
    if (!svc || !Array.isArray(svc.row)) {
      return res.status(502).json({ ok: false, error: '서울시 강우량 API 응답 오류', detail: (svc && svc.RESULT) || j.RESULT || j });
    }

    // 시각별로 묶기
    const byTime = new Map();
    for (const row of svc.row) {
      const t = row.DATA_CLCT_TM;
      if (!t) continue;
      const v = parseFloat(row.RN_10M) || 0;
      if (!byTime.has(t)) byTime.set(t, []);
      byTime.get(t).push(v);
    }
    const times = [...byTime.keys()].sort().reverse(); // 최신 → 과거
    if (!times.length) return res.status(502).json({ ok: false, error: '강우량 데이터가 비어 있습니다.' });

    const toDate = s => new Date(s.replace(' ', 'T') + ':00+09:00');
    const latest = times[0];
    const latestVals = byTime.get(latest);
    const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;

    // 측정소의 10% 이상에서 비가 관측된 가장 최근 시각 = "마지막 비"
    let lastRain = null;
    for (const t of times) {
      const vals = byTime.get(t);
      if (vals.filter(v => v > 0).length / vals.length >= 0.1) { lastRain = t; break; }
    }
    const windowMin = Math.round((toDate(latest) - toDate(times[times.length - 1])) / 60000);
    const minutesSince = lastRain
      ? Math.round((toDate(latest) - toDate(lastRain)) / 60000)
      : 240; // 조회 범위 안에 비가 없으면 '충분히 마름'으로 간주

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      ok: true,
      time: latest,
      gauges: latestVals.length,
      rain_10m_mm: Math.round(avg(latestVals) * 100) / 100,
      raining_share: Math.round(latestVals.filter(v => v > 0).length / latestVals.length * 100) / 100,
      minutes_since_rain: minutesSince,
      window_minutes: windowMin
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: '서울시 API 호출 실패', detail: String(e) });
  }
};
