const { call } = require('../../utils/api');
const cities = require('../../utils/cities');
function normCity(city) { const s = String(city || '').trim(); if (!s) return ''; if (['香港特别行政区','澳门特别行政区','台北市'].includes(s)) return s; return s.endsWith('市') ? s : `${s}市`; }
Page({
  data: { places: [], markers: [], cityItems: [], filteredCities: [], keyword: '', cityCount: 0, provinceCount: 0, countryCount: 0 },
  onShow() { this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData() {
    try {
      const result = await call('stats.mapData');
      const places = result.places || [];
      const visited = new Map(places.map(p => [normCity(p.city), p]));
      const cityItems = cities.filter((c, i, all) => all.findIndex(x => normCity(x.city) === normCity(c.city)) === i).map((c, index) => {
        const place = visited.get(normCity(c.city));
        return { ...c, index, visited: !!place, place: place || null };
      });
      // 预设城市的灰点和已访问城市的橙点使用两种本地图片区分。
      const markers = cityItems.map((c, i) => ({ id: i + 1, latitude: Number((c.place && c.place.lat) || c.lat), longitude: Number((c.place && c.place.lng) || c.lng), iconPath: c.visited ? '/assets/pin-active.png' : '/assets/pin-muted.png', width: c.visited ? 30 : 24, height: c.visited ? 38 : 30, callout: { content: c.city + (c.visited ? ' · 已到访' : ' · 尚未记录'), display: 'BYCLICK', padding: 8, borderRadius: 8, fontSize: 12 } }));
      // 将城市表之外、但日记里带了坐标的城市也放到地图上。
      places.forEach(p => {
        if (p.lat && p.lng && !cityItems.some(c => normCity(c.city) === normCity(p.city))) markers.push({ id: markers.length + 1, latitude: Number(p.lat), longitude: Number(p.lng), iconPath: '/assets/pin-active.png', width: 30, height: 38, callout: { content: p.city + ' · 已到访', display: 'BYCLICK', padding: 8, borderRadius: 8 } });
      });
      const stats = await call('stats.summary');
      this.setData({ places, cityItems, markers, cityCount: stats.cityCount, provinceCount: stats.provinceCount, countryCount: stats.countryCount });
      this.applySearch();
    } catch (e) { wx.showToast({ title: e.message || '地图加载失败', icon: 'none' }); }
  },
  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    // 输入时同步筛选，搜索按钮和键盘“搜索”则提供明确的提交入口。
    this.applySearch();
  },
  submitSearch() {
    this.applySearch();
    wx.hideKeyboard();
  },
  applySearch() {
    const keyword = String(this.data.keyword || '').trim().toLowerCase();
    const filteredCities = this.data.cityItems.filter(c =>
      String(c.city || '').toLowerCase().includes(keyword) || String(c.province || '').toLowerCase().includes(keyword)
    ).slice(0, 18);
    this.setData({ filteredCities });
  },
  onMarkerTap(e) {
    const markerId = Number(e.detail.markerId);
    const city = this.data.cityItems[markerId - 1];
    if (city) return this.handleCity(city);
    const place = this.data.places.find(p => p.city && this.data.markers[markerId - 1] && String(p.city) === String(this.data.markers[markerId - 1].callout.content).split(' · ')[0]);
    if (place) wx.navigateTo({ url: `/pages/city/index?city=${encodeURIComponent(place.city)}` });
  },
  onCityTap(e) { const item = this.data.filteredCities[Number(e.currentTarget.dataset.index)]; if (item) this.handleCity(item); },
  handleCity(item) {
    if (item.visited) return wx.navigateTo({ url: `/pages/city/index?city=${encodeURIComponent(item.city)}` });
    wx.showModal({ title: `标记去过「${item.city}」？`, content: '这会把该城市加入家庭旅行足迹，之后也可以关联具体日记。', confirmText: '确认打卡', success: async res => {
      if (!res.confirm) return;
      try { await call('stats.checkin', { place: { city: item.city, province: item.province, country: item.country, lat: item.lat, lng: item.lng }, source: 'manual' }); wx.showToast({ title: '城市已点亮', icon: 'success' }); this.loadData(); }
      catch (e) { wx.showToast({ title: e.message || '打卡失败', icon: 'none' }); }
    }});
  }
});