const { call } = require('../../utils/api');
const cities = require('../../utils/cities');
const app = getApp();
function trim(v) { return String(v || '').trim(); }
Page({
  data: {
    photos: [], publishing: false, placeKeyword: '', suggestions: [], tagsText: '', travelersText: '',
    form: { content: '', city: '', province: '', country: '中国', district: '', spot: '', hotel: '', restaurant: '', transport: '', amount: '', visitDate: new Date().toISOString().slice(0,10), lat: null, lng: null, locationName: '' }
  },
  onLoad() { if (!app.globalData.family) wx.redirectTo({ url: '/pages/login/index' }); },
  onInput(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  onTagsInput(e) { this.setData({ tagsText: e.detail.value }); },
  onTravelersInput(e) { this.setData({ travelersText: e.detail.value }); },
  onDateChange(e) { this.setData({ 'form.visitDate': e.detail.value }); },
  async choosePhotos() {
    try {
      const res = await wx.chooseMedia({ count: 9 - this.data.photos.length, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] });
      const next = res.tempFiles.map(f => ({ path: f.tempFilePath, size: f.size }));
      this.setData({ photos: this.data.photos.concat(next).slice(0,9) });
    } catch (e) { /* 用户取消选择不提示错误 */ }
  },
  removePhoto(e) { const photos = this.data.photos.slice(); photos.splice(Number(e.currentTarget.dataset.index), 1); this.setData({ photos }); },
  onPlaceKeyword(e) { this.setData({ placeKeyword: e.detail.value }); },
  async chooseLocation() {
    try {
      const res = await wx.chooseLocation();
      this.setData({ 'form.locationName': res.name || res.address || '', 'form.lat': Number(res.latitude), 'form.lng': Number(res.longitude) });
      await this.reverseGeocode(res.latitude, res.longitude, res.address || '');
    } catch (e) { /* 用户取消 */ }
  },
  async useCurrentLocation() {
    try {
      const res = await wx.getLocation({ type: 'gcj02' });
      this.setData({ 'form.lat': Number(res.latitude), 'form.lng': Number(res.longitude) });
      await this.reverseGeocode(res.latitude, res.longitude, '当前位置');
    } catch (e) { wx.showToast({ title: '无法获取定位，请检查权限或使用地图选点', icon: 'none' }); }
  },
  async reverseGeocode(lat, lng, fallbackName) {
    try {
      const res = await wx.cloud.callFunction({ name: 'location', data: { action: 'reverse', lat, lng } });
      const result = (res.result || {}).data;
      if (result) this.setData({
        'form.country': result.country || this.data.form.country,
        'form.province': result.province || this.data.form.province,
        'form.city': result.city || this.data.form.city,
        'form.district': result.district || this.data.form.district,
        'form.locationName': this.data.form.locationName || result.address || fallbackName
      });
    } catch (e) {
      if (fallbackName && !this.data.form.locationName) this.setData({ 'form.locationName': fallbackName });
    }
  },
  async searchPlaces() {
    const keyword = trim(this.data.placeKeyword);
    if (!keyword) return wx.showToast({ title: '请先输入地点名称', icon: 'none' });
    try {
      const res = await wx.cloud.callFunction({ name: 'location', data: { action: 'suggest', keyword, region: this.data.form.city || this.data.form.province } });
      const result = res.result || {};
      if (!result.ok) throw new Error(result.message || '地点搜索失败');
      this.setData({ suggestions: result.data.items || [] });
    } catch (e) { wx.showToast({ title: e.message || '地点搜索失败，可使用地图选点', icon: 'none' }); }
  },
  chooseSuggestion(e) {
    const item = this.data.suggestions[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    this.setData({
      suggestions: [], 'form.locationName': item.title || item.address || '',
      'form.city': item.city || this.data.form.city, 'form.province': item.province || this.data.form.province,
      'form.district': item.district || this.data.form.district, 'form.country': item.country || this.data.form.country,
      'form.lat': item.lat == null ? this.data.form.lat : Number(item.lat), 'form.lng': item.lng == null ? this.data.form.lng : Number(item.lng)
    });
  },
  async uploadPhotos(familyId) {
    const uploaded = [];
    for (let i = 0; i < this.data.photos.length; i++) {
      const photo = this.data.photos[i];
      const ext = (photo.path.match(/\.([a-zA-Z0-9]+)(?:\?|$)/) || [])[1] || 'jpg';
      const cloudPath = `family/${familyId}/${Date.now()}-${i}-${Math.random().toString(36).slice(2,8)}.${ext}`;
      const res = await wx.cloud.uploadFile({ cloudPath, filePath: photo.path });
      uploaded.push(res.fileID);
    }
    return uploaded;
  },
  async publish() {
    if (this.data.publishing) return;
    const form = { ...this.data.form };
    form.city = trim(form.city); form.content = trim(form.content);
    if (!form.city) return wx.showToast({ title: '请填写旅行城市', icon: 'none' });
    if (!form.content && !this.data.photos.length) return wx.showToast({ title: '至少写点文字或添加照片', icon: 'none' });
    if (form.amount && Number(form.amount) < 0) return wx.showToast({ title: '花费金额不能小于 0', icon: 'none' });
    const cityMeta = cities.find(c => c.city === form.city || c.city.replace(/市$/, '') === form.city.replace(/市$/, ''));
    if ((!form.lat || !form.lng) && cityMeta) { form.lat = cityMeta.lat; form.lng = cityMeta.lng; }
    if (!form.province && cityMeta) form.province = cityMeta.province;
    if (!form.country) form.country = '中国';
    this.setData({ publishing: true });
    try {
      const family = app.globalData.family || (await call('family.info')).family;
      const images = await this.uploadPhotos(family._id);
      const tags = this.data.tagsText.split(/[，,、]/).map(trim).filter(Boolean).slice(0,10);
      const travelers = this.data.travelersText.split(/[，,、]/).map(trim).filter(Boolean).slice(0,20);
      await call('diary.publish', { ...form, images, tags, travelers });
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.switchTab({ url: '/pages/timeline/index' }), 600);
    } catch (e) { wx.showModal({ title: '保存失败', content: e.message || '请检查网络、云存储权限和云函数部署情况。', showCancel: false }); }
    this.setData({ publishing: false });
  }
});