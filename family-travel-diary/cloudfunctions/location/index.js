// 腾讯位置服务代理：Key 放在云函数环境变量 TENCENT_MAP_KEY，不写入小程序前端。
const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const trim = v => String(v == null ? '' : v).trim();
async function one(collection, where) { const r = await db.collection(collection).where(where).limit(1).get(); return r.data[0] || null; }
function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (_) { reject(new Error('地图服务返回了无法解析的数据')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('地图服务请求超时')));
  });
}
exports.main = async event => {
  try {
    const { OPENID } = cloud.getWXContext();
    const user = await one('users', { openid: OPENID });
    if (!user || !user.familyId) return { ok: false, message: '请先加入家庭后再使用地点搜索' };
    const member = await one('family_members', { familyId: user.familyId, userId: user._id, isActive: true });
    if (!member) return { ok: false, message: '当前账号不是有效家庭成员' };
    const key = process.env.TENCENT_MAP_KEY;
    if (!key) return { ok: false, message: '尚未配置腾讯位置服务 Key；请先使用“地图选点”' };
    const action = trim(event.action);
    if (action === 'suggest') {
      const keyword = trim(event.keyword);
      if (!keyword) return { ok: true, data: { items: [] } };
      const url = new URL('https://apis.map.qq.com/ws/place/v1/suggestion/');
      url.searchParams.set('keyword', keyword.slice(0, 80));
      url.searchParams.set('key', key);
      if (trim(event.region)) url.searchParams.set('region', trim(event.region).slice(0, 60));
      url.searchParams.set('page_size', '10');
      const result = await requestJson(url.toString());
      if (result.status !== 0) return { ok: false, message: result.message || '地点搜索失败，请检查 Key 与服务配额' };
      const items = (result.data || []).map((item, i) => ({
        id: String(i), title: item.title || '', address: item.address || '', province: item.province || '', city: item.city || '', district: item.district || '',
        country: item.ad_info && item.ad_info.nation || '中国', lat: item.location && item.location.lat, lng: item.location && item.location.lng
      }));
      return { ok: true, data: { items } };
    }
    if (action === 'reverse') {
      const lat = Number(event.lat), lng = Number(event.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, message: '定位坐标无效' };
      const url = new URL('https://apis.map.qq.com/ws/geocoder/v1/');
      url.searchParams.set('location', `${lat},${lng}`);
      url.searchParams.set('key', key);
      url.searchParams.set('get_poi', '0');
      const result = await requestJson(url.toString());
      if (result.status !== 0) return { ok: false, message: result.message || '地址解析失败' };
      const component = (result.result && result.result.address_component) || {};
      return { ok: true, data: {
        address: result.result && result.result.address || '',
        country: component.nation || '中国', province: component.province || '', city: component.city || '', district: component.district || ''
      }};
    }
    return { ok: false, message: '不支持的地图操作' };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : '地图服务暂时不可用' };
  }
};