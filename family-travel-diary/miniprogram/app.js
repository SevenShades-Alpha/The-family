App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({ title: '当前微信版本过低', content: '请升级微信后再使用云开发功能。', showCancel: false });
      return;
    }
    wx.cloud.init({
      env: 'cloudbase-d8gs745hf26326790', // 替换成云开发环境 ID
      traceUser: true
    });
  },
  globalData: {
    user: null,
    family: null
  }
});