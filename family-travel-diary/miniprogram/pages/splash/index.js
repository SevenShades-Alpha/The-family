const { call } = require('../../utils/api');

Page({
  data: { leaving: false },
  onLoad() {
    // 先完整播放开屏，再按当前微信账号的真实家庭状态分流。
    this.timer = setTimeout(() => this.routeByAccount(), 1500);
  },
  async routeByAccount() {
    this.setData({ leaving: true });
    let hasFamily = false;
    try {
      const data = await call('auth.me');
      const app = getApp();
      app.globalData.user = data.user || null;
      app.globalData.family = data.family || null;
      hasFamily = !!data.family;
    } catch (e) {
      // 身份/网络检查失败时进入登录页，避免卡在开屏页。
      hasFamily = false;
    }
    this.leaveTimer = setTimeout(() => {
      if (hasFamily) {
        wx.switchTab({ url: '/pages/timeline/index' });
      } else {
        wx.redirectTo({ url: '/pages/login/index' });
      }
    }, 350);
  },
  onUnload() {
    if (this.timer) clearTimeout(this.timer);
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
  }
});
