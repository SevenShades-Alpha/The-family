const { call } = require('../../utils/api');

Page({
  data: { nickname: '', avatarUrl: '', avatarFileID: '', saving: false, userId: '' },
  onLoad() { this.loadProfile(); },
  async loadProfile() {
    try {
      const result = await call('auth.me');
      const user = result.user || {};
      let avatarUrl = user.avatarUrl || '';
      if (avatarUrl.startsWith('cloud://')) {
        try {
          const temp = await wx.cloud.getTempFileURL({ fileList: [{ fileID: avatarUrl, maxAge: 60 * 60 }] });
          avatarUrl = temp.fileList && temp.fileList[0] && temp.fileList[0].tempFileURL || '';
        } catch (_) { avatarUrl = ''; }
      }
      this.setData({ nickname: user.nickname || '', avatarUrl, avatarFileID: (user.avatarUrl || '').startsWith('cloud://') ? user.avatarUrl : '', userId: user._id || '' });
    } catch (e) { wx.showToast({ title: e.message || '个人资料加载失败', icon: 'none' }); }
  },
  onNicknameInput(e) { this.setData({ nickname: e.detail.value }); },
  async chooseAvatar() {
    try {
      const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] });
      const file = result.tempFiles && result.tempFiles[0];
      if (!file || !file.tempFilePath) return;
      wx.showLoading({ title: '上传头像中…' });
      const extMatch = file.tempFilePath.match(/\.(png|jpg|jpeg|webp)$/i);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
      const uploaded = await wx.cloud.uploadFile({ cloudPath: `user-avatars/${this.data.userId || 'user'}-${Date.now()}.${ext}`, filePath: file.tempFilePath });
      wx.hideLoading();
      this.setData({ avatarUrl: file.tempFilePath, avatarFileID: uploaded.fileID });
    } catch (e) {
      wx.hideLoading();
      if (e && e.errMsg && e.errMsg.includes('cancel')) return;
      wx.showToast({ title: (e && (e.message || e.errMsg)) || '头像选择失败', icon: 'none' });
    }
  },
  async saveProfile() {
    const nickname = String(this.data.nickname || '').trim();
    if (!nickname) return wx.showToast({ title: '请输入个人名称', icon: 'none' });
    if (nickname.length > 30) return wx.showToast({ title: '名称最多30个字', icon: 'none' });
    this.setData({ saving: true });
    try {
      await call('profile.update', { nickname, avatarUrl: this.data.avatarFileID || undefined });
      wx.showToast({ title: '个人资料已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) { wx.showToast({ title: e.message || '保存失败', icon: 'none' }); }
    finally { this.setData({ saving: false }); }
  }
});
