const { call } = require('../../utils/api');
function dateText(value) { const d = value instanceof Date ? value : new Date(value); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; }
Page({
  data: { id: '', diary: null, markers: [], visitDateText: '', liked: false, likesCount: 0, comments: [], commentText: '', canDelete: false, deleting: false },
  onLoad(options) { this.setData({ id: options.id || '' }); this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData() {
    try {
      const data = await call('diary.detail', { diaryId: this.data.id });
      const diary = data.diary;
      diary.tags = diary.tags || []; diary.imageUrls = diary.imageUrls || [];
      diary.visitDateText = dateText(diary.visitDate || diary.createdAt);
      diary.hasAmount = diary.amount !== null && diary.amount !== undefined;
      diary.travelersText = (diary.travelers || []).join('、');
      const comments = (data.comments || []).map(c => ({ ...c, createdAtText: dateText(c.createdAt) }));
      this.setData({ diary, visitDateText: diary.visitDateText, liked: data.liked, likesCount: data.likesCount, comments, canDelete: !!data.canDelete, markers: diary.lat && diary.lng ? [{ id: 1, latitude: Number(diary.lat), longitude: Number(diary.lng), iconPath: '/assets/pin-active.png', width: 32, height: 40, callout: { content: diary.locationName || diary.city || '旅行地点', display: 'BYCLICK', padding: 8, borderRadius: 8 } }] : [] });
    } catch (e) { wx.showToast({ title: e.message || '无法打开这篇日记', icon: 'none' }); }
  },
  async toggleLike() {
    try { const data = await call('diary.likeToggle', { diaryId: this.data.id }); this.setData({ liked: data.liked, likesCount: data.likesCount }); }
    catch (e) { wx.showToast({ title: e.message || '操作失败', icon: 'none' }); }
  },
  deleteDiary() {
    if (!this.data.canDelete || this.data.deleting) return;
    wx.showModal({
      title: '删除这篇日记？',
      content: '删除后，日记、留言、点赞及关联照片将被清理，且无法恢复。家庭足迹记录会保留。',
      confirmText: '确认删除',
      confirmColor: '#B74735',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ deleting: true });
        wx.showLoading({ title: '正在删除' });
        try {
          await call('diary.delete', { diaryId: this.data.id });
          wx.hideLoading();
          wx.showToast({ title: '日记已删除', icon: 'success' });
          const pages = getCurrentPages();
          if (pages.length > 1) wx.navigateBack({ delta: 1 });
          else wx.redirectTo({ url: '/pages/timeline/index' });
        } catch (e) {
          wx.hideLoading();
          this.setData({ deleting: false });
          wx.showToast({ title: e.message || '删除失败，请重试', icon: 'none' });
        }
      }
    });
  },
  onCommentInput(e) { this.setData({ commentText: e.detail.value }); },
  async submitComment() {
    const content = this.data.commentText.trim();
    if (!content) return wx.showToast({ title: '先写一句留言吧', icon: 'none' });
    try { await call('diary.comment', { diaryId: this.data.id, content }); this.setData({ commentText: '' }); await this.loadData(); }
    catch (e) { wx.showToast({ title: e.message || '留言失败', icon: 'none' }); }
  }
});