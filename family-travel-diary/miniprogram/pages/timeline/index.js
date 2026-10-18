const { call } = require('../../utils/api');
const app = getApp();
function asDate(value) { const d = value instanceof Date ? value : new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function pretty(item) {
  const d = asDate(item.visitDate || item.createdAt);
  return { ...item, tags: item.tags || [], imageUrls: item.imageUrls || [], visitDateText: d ? `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}` : '日期待补充', yearText: d ? `${d.getFullYear()}` : '' };
}
Page({
  data: { loading: true, familyName: '', all: [], filtered: [], members: [], memberNames: ['全部'], memberIndex: 0, years: ['全部'], yearIndex: 0, keyword: '' },
  onShow() { this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData() {
    this.setData({ loading: true });
    try {
      const [list, familyData, memberData] = await Promise.all([call('diary.list'), call('family.info'), call('family.members')]);
      const all = (list.diaries || []).map(pretty);
      const names = ['全部', ...(memberData.members || []).map(m => m.nickname || '家庭成员')];
      const years = ['全部', ...Array.from(new Set(all.map(d => d.yearText).filter(Boolean))).sort((a,b) => Number(b)-Number(a))];
      this.setData({ all, familyName: familyData.family.name, members: memberData.members || [], memberNames: names, years, memberIndex: 0, yearIndex: 0 });
      app.globalData.family = familyData.family; this.applyFilters();
    } catch (e) {
      if ((e.message || '').includes('家庭') || (e.message || '').includes('加入')) wx.redirectTo({ url: '/pages/login/index' });
      else wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },
  onKeyword(e) { this.setData({ keyword: e.detail.value }); this.applyFilters(); },
  onMemberChange(e) { this.setData({ memberIndex: Number(e.detail.value) }); this.applyFilters(); },
  onYearChange(e) { this.setData({ yearIndex: Number(e.detail.value) }); this.applyFilters(); },
  applyFilters() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const selectedMember = this.data.memberIndex ? this.data.members[this.data.memberIndex - 1] : null;
    const selectedYear = this.data.yearIndex ? this.data.years[this.data.yearIndex] : '';
    const filtered = this.data.all.filter(item => {
      const corpus = [item.city, item.province, item.country, item.content, item.locationName, ...(item.tags || [])].join(' ').toLowerCase();
      return (!keyword || corpus.includes(keyword)) && (!selectedMember || item.authorId === selectedMember.userId) && (!selectedYear || item.yearText === selectedYear);
    });
    this.setData({ filtered });
  },
  goPublish() { wx.navigateTo({ url: '/pages/publish/index' }); },
  openDiary(e) { wx.navigateTo({ url: `/pages/detail/index?id=${e.currentTarget.dataset.id}` }); }
});