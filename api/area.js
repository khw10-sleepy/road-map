// /api/area?cd=POI009
// 서울시 실시간 도시데이터(citydata)에서 장소 1곳의 도로 구간·날씨·공사/사고 정보를 받아
// 웹앱이 쓰기 좋은 형태로 바꿔서 돌려줍니다.
// 서울시 인증키는 Vercel 환경변수 SEOUL_API_KEY 에만 넣고, 브라우저에는 절대 보내지 않습니다.

const HOTSPOTS = require('./_hotspots.json');

const num = (v, d = 0) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : d;
};
const asArray = v => (Array.isArray(v) ? v : v ? [v] : []);

module.exports = async (req, res) => {
  const key = process.env.SEOUL_API_KEY;
  if (!key) return res.status(500).json({ error: 'SEOUL_API_KEY 환경변수가 설정되지 않았습니다.' });

  const cd = String(req.query.cd || '');
  const spot = HOTSPOTS.find(h => h.cd === cd);
  if (!spot) return res.status(400).json({ error: `알 수 없는 장소 코드: ${cd}` });

  const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/citydata/1/5/${encodeURIComponent(spot.nm)}`;

  try {
    const r = await fetch(url);
    const j = await r.json();
    const c = j.CITYDATA;
    if (!c) return res.status(502).json({ error: '서울시 API 응답에 CITYDATA가 없습니다.', detail: j.RESULT || j });

    // 도로 구간
    const rt = c.ROAD_TRAFFIC_STTS || {};
    const rawLinks = asArray(rt.ROAD_TRAFFIC_STTS ?? rt);
    const links = rawLinks
      .filter(l => l && l.LINK_ID && l.XYLIST)
      .map(l => ({
        link_id: String(l.LINK_ID),
        road_name: l.ROAD_NM || '',
        start: l.START_ND_NM || '',
        end: l.END_ND_NM || '',
        dist_m: num(l.DIST, 100),
        speed_kmh: num(l.SPD, 0),
        congestion: l.IDX || '서행',
        coords: String(l.XYLIST).split('|').map(p => {
          const [x, y] = p.split('_').map(Number);
          return [Math.round(y * 1e6) / 1e6, Math.round(x * 1e6) / 1e6];
        }).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))
      }))
      .filter(l => l.coords.length >= 2);

    // 날씨
    const w = asArray(c.WEATHER_STTS)[0] || {};
    const weather = {
      time: w.WEATHER_TIME || '',
      temp_c: num(w.TEMP, 15),
      humidity_pct: num(w.HUMIDITY, 50),
      wind_ms: num(w.WIND_SPD, 1),
      precip_type: w.PRECPT_TYPE || '없음',
      precip_mm: num(w.PRECIPITATION, 0)
    };

    // 공사·사고
    const incidents = asArray(c.ACDNT_CNTRL_STTS)
      .filter(a => a && a.ACDNT_X && a.ACDNT_Y)
      .map(a => ({
        type: a.ACDNT_TYPE || '돌발',
        detail: a.ACDNT_DTYPE || '',
        info: a.ACDNT_INFO || '',
        lat: num(a.ACDNT_Y),
        lng: num(a.ACDNT_X),
        until: a.EXP_CLR_DT || ''
      }));

    // 같은 장소 요청은 5분 동안 Vercel이 저장해 둔 결과를 재사용 → 서울시 API 호출 횟수 절약
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      cd: spot.cd,
      name: spot.nm,
      updated_at: (rt.AVG_ROAD_DATA && rt.AVG_ROAD_DATA.ROAD_TRAFFIC_TIME) || weather.time,
      weather,
      incidents,
      links
    });
  } catch (e) {
    return res.status(502).json({ error: '서울시 API 호출 실패', detail: String(e) });
  }
};
