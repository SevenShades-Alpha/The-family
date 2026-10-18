const { call } = require('../../utils/api');
const app = getApp();
Page({
  data: { user: null, family: null, familyName: '我们一家人', inviteCode: '', creating: false, joining: false },
  onLoad() { this.loadMe(); },
  async loadMe() {
    try {
      const data = await call('auth.me');
      this.setData({ user: data.user, family: data.family || null });
      app.globalData.user = data.user;
      app.globalData.family = data.family || null;
      if (data.family) wx.switchTab({ url: '/pages/timeline/index' });
    } catch (e) { wx.showToast({ title: e.message || '连接失败', icon: 'none' }); }
  },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  async getProfile() {
    // getUserProfile 必须由用户主动点击触发；用户拒绝后仍可使用默认昵称。
    try {
      const result = await wx.getUserProfile({ desc: '用于在家庭旅行日记中展示您的头像和昵称' });
      const data = await call('auth.login', { profile: result.userInfo || {} });
      this.setData({ user: data.user, family: data.family || null });
      app.globalData.user = data.user; app.globalData.family = data.family || null;
      if (data.family) wx.switchTab({ url: '/pages/timeline/index' });
    } catch (e) { wx.showToast({ title: '已保留默认资料，也可以继续创建家庭', icon: 'none' }); }
  },
  async createFamily() {
    if (!this.data.familyName.trim()) return wx.showToast({ title: '请填写家庭名称', icon: 'none' });
    this.setData({ creating: true });
    try {
      const data = await call('auth.createFamily', { name: this.data.familyName.trim() });
      app.globalData.user = data.user; app.globalData.family = data.family;
      wx.showModal({ title: '家庭创建成功', content: `邀请码：${data.family.inviteCode}\n把邀请码告诉家人，就可以一起记录旅行。`, showCancel: false, success: () => wx.switchTab({ url: '/pages/timeline/index' }) });
    } catch (e) { wx.showToast({ title: e.message || '创建失败', icon: 'none' }); }
    this.setData({ creating: false });
  },
  async joinFamily() {
    if (!this.data.inviteCode.trim()) return wx.showToast({ title: '请输入邀请码', icon: 'none' });
    this.setData({ joining: true });
    try {
      const data = await call('auth.joinFamily', { inviteCode: this.data.inviteCode.trim().toUpperCase() });
      app.globalData.user = data.user; app.globalData.family = data.family;
      wx.showToast({ title: '加入成功', icon: 'success' });
      setTimeout(() => wx.switchTab({ url: '/pages/timeline/index' }), 500);
    } catch (e) { wx.showToast({ title: e.message || '加入失败', icon: 'none' }); }
    this.setData({ joining: false });
  }
});