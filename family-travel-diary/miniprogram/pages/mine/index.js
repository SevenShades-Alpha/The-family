const { call } = require('../../utils/api');
const app = getApp();
function dateText(value) { const d = value instanceof Date ? value : new Date(value); return Number.isNaN(d.getTime()) ? '—' : `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; }
Page({
  data: { family: {}, stats: {}, members: [], isCreator: false },
  onShow() { this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData() {
    try {
      const [familyData, summary, memberData, meData] = await Promise.all([call('family.info'), call('stats.summary'), call('family.members'), call('auth.me')]);
      const members = (memberData.members || []).map(m => ({ ...m, joinedAtText: dateText(m.joinedAt) }));
      this.setData({ family: familyData.family, stats: summary, members, isCreator: !!(familyData.family && familyData.family.creatorId && meData.user && familyData.family.creatorId === meData.user._id) });
      app.globalData.family = familyData.family;
    } catch (e) { wx.showToast({ title: e.message || '加载失败', icon: 'none' }); }
  },
  renameFamily() {
    if (!this.data.isCreator) return wx.showToast({ title: '只有创建者可以修改家庭名称', icon: 'none' });
    wx.showModal({ title: '修改家庭名称', editable: true, placeholderText: '请输入家庭名称（最多24字）', content: this.data.family.name || '', success: async (res) => {
      if (!res.confirm) return;
      const name = String(res.content || '').trim();
      if (!name) return wx.showToast({ title: '家庭名称不能为空', icon: 'none' });
      try { await call('family.update', { name }); wx.showToast({ title: '家庭名称已更新', icon: 'success' }); this.loadData(); }
      catch (e) { wx.showToast({ title: e.message || '修改失败', icon: 'none' }); }
    }});
  },
  async changeFamilyAvatar() {
    if (!this.data.isCreator) return wx.showToast({ title: '只有创建者可以修改家庭头像', icon: 'none' });
    try {
      const chosen = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] });
      const file = chosen.tempFiles && chosen.tempFiles[0];
      if (!file || !file.tempFilePath) return;
      wx.showLoading({ title: '上传头像中…' });
      const ext = (file.tempFilePath.match(/\.(png|jpg|jpeg|webp)$/i) || [,'jpg'])[1];
      const uploaded = await wx.cloud.uploadFile({ cloudPath: `family-avatars/${this.data.family._id}-${Date.now()}.${ext}`, filePath: file.tempFilePath });
      await call('family.update', { avatarUrl: uploaded.fileID });
      wx.hideLoading(); wx.showToast({ title: '家庭头像已更新', icon: 'success' }); this.loadData();
    } catch (e) { wx.hideLoading(); wx.showToast({ title: (e && e.errMsg && e.errMsg.includes('cancel') ? '已取消选择' : (e.message || e.errMsg || '头像更新失败')), icon: 'none' }); }
  },
  removeMember(e) {
    if (!this.data.isCreator) return;
    const userId = e.currentTarget.dataset.userid;
    const member = this.data.members.find(m => m.userId === userId);
    if (!member) return;
    wx.showModal({ title: '移除家庭成员', content: `确定将“${member.nickname || '家庭成员'}”移出家庭吗？对方之后可以重新使用邀请码加入。`, success: async (res) => {
      if (!res.confirm) return;
      try { await call('family.removeMember', { userId }); wx.showToast({ title: '已移除成员', icon: 'success' }); this.loadData(); }
      catch (e) { wx.showToast({ title: e.message || '移除失败', icon: 'none' }); }
    }});
  },
  copyInvite() { if (!this.data.family.inviteCode) return; wx.setClipboardData({ data: this.data.family.inviteCode, success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' }) }); },
  openMyProfile() { wx.navigateTo({ url: '/pages/profile/index' }); },
  openMemberProfile(e) {
    const userId = e.currentTarget.dataset.userid;
    const me = this.data.members.find(m => m.userId === userId);
    if (!me) return;
    // 当前版本仅允许进入并编辑自己的资料，其他成员卡片只展示信息。
    call('auth.me').then(result => {
      if (result.user && result.user._id === userId) wx.navigateTo({ url: '/pages/profile/index' });
      else wx.showToast({ title: '这里只能修改自己的个人资料', icon: 'none' });
    }).catch(err => wx.showToast({ title: err.message || '无法确认当前用户', icon: 'none' }));
  },
  refresh() { this.loadData(); }
});