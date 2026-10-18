const { call } = require('../../utils/api');
function dateText(value) { const d = value instanceof Date ? value : new Date(value); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; }
Page({
  data: { city: '', place: null, diaries: [], firstVisitText: '', lastVisitText: '' },
  onLoad(options) { this.setData({ city: decodeURIComponent(options.city || '') }); this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData() {
    try {
      const data = await call('stats.cityDetail', { city: this.data.city });
      const place = data.place || { city: this.data.city, country: '中国', province: '', visitCount: 1, diaryCount: 0 };
      const diaries = (data.diaries || []).map(d => ({ ...d, imageUrls: d.imageUrls || [], visitDateText: dateText(d.visitDate || d.createdAt) }));
      this.setData({ place, diaries, firstVisitText: dateText(place.firstVisit), lastVisitText: dateText(place.lastVisit) });
    } catch (e) { wx.showToast({ title: e.message || '城市详情加载失败', icon: 'none' }); }
  },
  openDiary(e) { wx.navigateTo({ url: `/pages/detail/index?id=${e.currentTarget.dataset.id}` }); }
});