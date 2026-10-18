// 统一通过云函数访问业务数据；前端不直接读写家庭数据库集合。
function call(action, data = {}) {
  return wx.cloud.callFunction({ name: 'api', data: { action, ...data } }).then(res => {
    const result = res.result || {};
    if (!result.ok) throw new Error(result.message || '请求失败，请稍后重试');
    return result.data;
  });
}
module.exports = { call };