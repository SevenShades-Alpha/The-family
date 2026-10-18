// 家庭旅行日记业务云函数：所有家庭数据都在这里完成身份校验与读写。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ok = data => ({ ok: true, data: data || {} });
const bad = message => ({ ok: false, message: message || '请求失败' });
const trim = v => String(v == null ? '' : v).trim();
const normCity = value => {
  const city = trim(value);
  if (!city || ['香港特别行政区', '澳门特别行政区', '台北市'].includes(city)) return city;
  return city.endsWith('市') ? city : `${city}市`;
};
const validNumber = v => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
const asDate = v => { const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? new Date() : d; };
const dayKey = d => asDate(d).toISOString().slice(0, 10);
const queryOne = async (collection, where) => {
  const result = await db.collection(collection).where(where).limit(1).get();
  return result.data[0] || null;
};
const getUserByOpenid = openid => queryOne('users', { openid });

async function getOrCreateUser(openid, profile = {}) {
  let user = await getUserByOpenid(openid);
  const nickname = trim(profile.nickName || profile.nickname).slice(0, 30);
  const avatarUrl = trim(profile.avatarUrl).startsWith('https://') ? trim(profile.avatarUrl) : '';
  if (!user) {
    const result = await db.collection('users').add({ data: {
      openid,
      nickname: nickname || '家庭成员',
      avatarUrl,
      familyId: null,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }});
    user = { _id: result._id, openid, nickname: nickname || '家庭成员', avatarUrl, familyId: null };
  } else if (nickname || avatarUrl) {
    const patch = { updatedAt: db.serverDate() };
    if (nickname) patch.nickname = nickname;
    if (avatarUrl) patch.avatarUrl = avatarUrl;
    await db.collection('users').doc(user._id).update({ data: patch });
    user = { ...user, ...patch };
  }
  return user;
}
function publicUser(user) {
  if (!user) return null;
  return { _id: user._id, userId: user._id, nickname: user.nickname || '家庭成员', avatarUrl: user.avatarUrl || '', familyId: user.familyId || null, createdAt: user.createdAt || null };
}
async function familyForUser(user) {
  if (!user || !user.familyId) return null;
  const member = await queryOne('family_members', { familyId: user.familyId, userId: user._id, isActive: true });
  if (!member) return null;
  try {
    const res = await db.collection('families').doc(user.familyId).get();
    return res.data || null;
  } catch (_) { return null; }
}
async function requireFamily(openid) {
  const user = await getUserByOpenid(openid);
  if (!user) throw new Error('请先完成微信身份识别');
  if (!user.familyId) throw new Error('请先创建或加入家庭');
  const member = await queryOne('family_members', { familyId: user.familyId, userId: user._id, isActive: true });
  if (!member) throw new Error('当前账号不是这个家庭的有效成员');
  const family = await db.collection('families').doc(user.familyId).get().then(r => r.data).catch(() => null);
  if (!family) throw new Error('家庭空间不存在或已失效');
  return { user, family, member, familyId: family._id };
}
function inviteCode() { return Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[O0I1]/g, 'A'); }
async function newInviteCode() {
  for (let i = 0; i < 10; i++) {
    const code = inviteCode();
    const exists = await queryOne('families', { inviteCode: code });
    if (!exists) return code;
  }
  throw new Error('生成邀请码失败，请重试');
}
async function getTempUrlMap(fileIDs) {
  const unique = Array.from(new Set((fileIDs || []).filter(x => typeof x === 'string' && x.startsWith('cloud://'))));
  if (!unique.length) return {};
  const result = await cloud.getTempFileURL({ fileList: unique.map(fileID => ({ fileID, maxAge: 60 * 60 })) });
  const map = {};
  (result.fileList || []).forEach(item => { if (item.status === 0 && item.tempFileURL) map[item.fileID] = item.tempFileURL; });
  return map;
}
async function hydrateDiaries(records) {
  const ids = Array.from(new Set(records.map(d => d.authorId).filter(Boolean)));
  const authors = {};
  await Promise.all(ids.map(async id => {
    try { const res = await db.collection('users').doc(id).get(); authors[id] = publicUser(res.data); }
    catch (_) { authors[id] = { nickname: '家庭成员', avatarUrl: '' }; }
  }));
  const fileIDs = records.flatMap(d => d.images || []);
  const urls = await getTempUrlMap(fileIDs);
  return records.map(d => ({
    ...d,
    author: authors[d.authorId] || { nickname: '家庭成员', avatarUrl: '' },
    imageUrls: (d.images || []).map(id => urls[id]).filter(Boolean),
    likesCount: typeof d.likesCount === 'number' ? d.likesCount : 0
  }));
}
async function recordVisit(ctx, place, visitDate, source, incrementDiary) {
  const city = normCity(place.city);
  if (!city) return null;
  const date = asDate(visitDate || new Date());
  const country = trim(place.country) || '中国';
  const province = trim(place.province);
  const lat = validNumber(place.lat) ? Number(place.lat) : null;
  const lng = validNumber(place.lng) ? Number(place.lng) : null;

  const existingPlace = await queryOne('places', { familyId: ctx.familyId, city });
  if (!existingPlace) {
    await db.collection('places').add({ data: {
      familyId: ctx.familyId, country, province, city, lat, lng,
      visitCount: 1, firstVisit: date, lastVisit: date, diaryCount: incrementDiary ? 1 : 0,
      createdAt: db.serverDate(), updatedAt: db.serverDate()
    }});
  } else {
    const prevFirst = asDate(existingPlace.firstVisit || date);
    const prevLast = asDate(existingPlace.lastVisit || date);
    const firstVisit = date < prevFirst ? date : prevFirst;
    const lastVisit = date > prevLast ? date : prevLast;
    const count = Number(existingPlace.visitCount || 0) + (dayKey(date) === dayKey(prevLast) ? 0 : 1);
    await db.collection('places').doc(existingPlace._id).update({ data: {
      country: country || existingPlace.country, province: province || existingPlace.province,
      lat: lat === null ? existingPlace.lat : lat, lng: lng === null ? existingPlace.lng : lng,
      firstVisit, lastVisit, visitCount: count,
      diaryCount: Number(existingPlace.diaryCount || 0) + (incrementDiary ? 1 : 0), updatedAt: db.serverDate()
    }});
  }
  const ownCheckin = await queryOne('checkins', { familyId: ctx.familyId, userId: ctx.user._id, city });
  if (!ownCheckin) {
    await db.collection('checkins').add({ data: {
      familyId: ctx.familyId, userId: ctx.user._id, country, province, city, lat, lng,
      visitCount: 1, firstVisit: date, lastVisit: date, source: source || 'diary',
      createdAt: db.serverDate(), updatedAt: db.serverDate()
    }});
  } else {
    const prevFirst = asDate(ownCheckin.firstVisit || date);
    const prevLast = asDate(ownCheckin.lastVisit || date);
    await db.collection('checkins').doc(ownCheckin._id).update({ data: {
      country, province, lat: lat === null ? ownCheckin.lat : lat, lng: lng === null ? ownCheckin.lng : lng,
      firstVisit: date < prevFirst ? date : prevFirst,
      lastVisit: date > prevLast ? date : prevLast,
      visitCount: Number(ownCheckin.visitCount || 0) + (dayKey(date) === dayKey(prevLast) ? 0 : 1),
      source: source || ownCheckin.source || 'diary', updatedAt: db.serverDate()
    }});
  }
  return queryOne('places', { familyId: ctx.familyId, city });
}
async function countFor(collection, where) {
  const result = await db.collection(collection).where(where).count();
  return result.total || 0;
}
async function getFamilyDiaries(familyId, maximum = 1000) {
  let all = [], skip = 0;
  while (skip < maximum) {
    const result = await db.collection('diaries').where({ familyId }).orderBy('visitDate', 'desc').skip(skip).limit(Math.min(100, maximum - skip)).get();
    all = all.concat(result.data || []);
    if (!result.data || result.data.length < 100) break;
    skip += result.data.length;
  }
  return all;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const action = trim(event.action);
    if (action === 'auth.me') {
      const user = await getOrCreateUser(OPENID);
      const family = await familyForUser(user);
      return ok({ user: publicUser(user), family: family ? { _id: family._id, name: family.name, inviteCode: family.inviteCode, memberCount: family.memberCount || 1 } : null });
    }
    if (action === 'auth.login') {
      const user = await getOrCreateUser(OPENID, event.profile || {});
      const family = await familyForUser(user);
      return ok({ user: publicUser(user), family: family ? { _id: family._id, name: family.name, inviteCode: family.inviteCode, memberCount: family.memberCount || 1 } : null });
    }
    if (action === 'auth.createFamily') {
      const user = await getOrCreateUser(OPENID);
      if (user.familyId) throw new Error('当前账号已经加入一个家庭；MVP 暂不支持多家庭切换');
      const name = trim(event.name).slice(0, 24) || '我们一家人';
      const code = await newInviteCode();
      const created = await db.collection('families').add({ data: { name, inviteCode: code, creatorId: user._id, memberCount: 1, createdAt: db.serverDate() } });
      const familyId = created._id;
      await db.collection('family_members').add({ data: { familyId, userId: user._id, openid: OPENID, role: 'admin', isActive: true, joinedAt: db.serverDate(), createdAt: db.serverDate() } });
      await db.collection('users').doc(user._id).update({ data: { familyId, updatedAt: db.serverDate() } });
      const updated = { ...user, familyId };
      const family = { _id: familyId, name, inviteCode: code, memberCount: 1 };
      return ok({ user: publicUser(updated), family });
    }
    if (action === 'auth.joinFamily') {
      const user = await getOrCreateUser(OPENID);
      if (user.familyId) throw new Error('当前账号已经加入一个家庭；MVP 暂不支持多家庭切换');
      const code = trim(event.inviteCode).toUpperCase();
      if (!code) throw new Error('请输入邀请码');
      const family = await queryOne('families', { inviteCode: code });
      if (!family) throw new Error('邀请码无效，请向创建者核对');
      await db.collection('family_members').add({ data: { familyId: family._id, userId: user._id, openid: OPENID, role: 'member', isActive: true, joinedAt: db.serverDate(), createdAt: db.serverDate() } });
      await db.collection('users').doc(user._id).update({ data: { familyId: family._id, updatedAt: db.serverDate() } });
      await db.collection('families').doc(family._id).update({ data: { memberCount: _.inc(1) } });
      return ok({ user: publicUser({ ...user, familyId: family._id }), family: { _id: family._id, name: family.name, inviteCode: family.inviteCode, memberCount: Number(family.memberCount || 0) + 1 } });
    }

    if (action === 'profile.update') {
      // 个人资料只更新当前微信 OPENID 对应的用户，不依赖家庭创建者权限。
      const currentUser = await getOrCreateUser(OPENID);
      const nickname = trim(event.nickname).slice(0, 30);
      if (!nickname) throw new Error('个人名称不能为空');
      const patch = { nickname, updatedAt: db.serverDate() };
      const avatarUrl = trim(event.avatarUrl);
      if (avatarUrl) {
        if (!avatarUrl.startsWith('cloud://')) throw new Error('头像文件无效，请重新选择');
        patch.avatarUrl = avatarUrl;
      }
      await db.collection('users').doc(currentUser._id).update({ data: patch });
      return ok({ updated: true });
    }

    const ctx = await requireFamily(OPENID);
    if (action === 'family.info') {
      let avatarUrl = ctx.family.avatarUrl || '';
      if (avatarUrl.startsWith('cloud://')) {
        try { const temp = await cloud.getTempFileURL({ fileList: [avatarUrl] }); avatarUrl = temp.fileList && temp.fileList[0] && temp.fileList[0].tempFileURL || ''; } catch (_) { avatarUrl = ''; }
      }
      return ok({ family: { _id: ctx.family._id, name: ctx.family.name, avatarUrl, inviteCode: ctx.family.inviteCode, memberCount: ctx.family.memberCount || 1, createdAt: ctx.family.createdAt, creatorId: ctx.family.creatorId } });
    }
    if (action === 'family.update') {
      if (ctx.member.role !== 'admin' || ctx.family.creatorId !== ctx.user._id) throw new Error('只有家庭创建者可以修改家庭资料');
      const patch = { updatedAt: db.serverDate() };
      if (event.name !== undefined) {
        const name = trim(event.name).slice(0, 24);
        if (!name) throw new Error('家庭名称不能为空');
        patch.name = name;
      }
      if (event.avatarUrl !== undefined) {
        const avatarUrl = trim(event.avatarUrl);
        if (avatarUrl && !avatarUrl.startsWith('cloud://')) throw new Error('家庭头像文件无效，请重新选择');
        patch.avatarUrl = avatarUrl;
      }
      await db.collection('families').doc(ctx.familyId).update({ data: patch });
      return ok({ updated: true });
    }
    if (action === 'family.removeMember') {
      if (ctx.member.role !== 'admin' || ctx.family.creatorId !== ctx.user._id) throw new Error('只有家庭创建者可以管理成员');
      const targetUserId = trim(event.userId);
      if (!targetUserId || targetUserId === ctx.user._id) throw new Error('不能移除自己');
      if (targetUserId === ctx.family.creatorId) throw new Error('不能移除家庭创建者');
      const target = await queryOne('family_members', { familyId: ctx.familyId, userId: targetUserId, isActive: true });
      if (!target) throw new Error('该成员已不存在或已退出');
      await db.collection('family_members').doc(target._id).update({ data: { isActive: false, leftAt: db.serverDate() } });
      const targetUser = await queryOne('users', { _id: targetUserId });
      if (targetUser) await db.collection('users').doc(targetUserId).update({ data: { familyId: null, updatedAt: db.serverDate() } });
      await db.collection('families').doc(ctx.familyId).update({ data: { memberCount: _.inc(-1), updatedAt: db.serverDate() } });
      return ok({ removed: true });
    }
    if (action === 'family.members') {
      const result = await db.collection('family_members').where({ familyId: ctx.familyId, isActive: true }).orderBy('joinedAt', 'asc').limit(100).get();
      const members = await Promise.all((result.data || []).map(async member => {
        let user = null;
        try { user = (await db.collection('users').doc(member.userId).get()).data; } catch (_) {}
        let avatarUrl = user ? (user.avatarUrl || '') : '';
        if (avatarUrl.startsWith('cloud://')) {
          try { const temp = await cloud.getTempFileURL({ fileList: [avatarUrl] }); avatarUrl = temp.fileList && temp.fileList[0] && temp.fileList[0].tempFileURL || ''; } catch (_) { avatarUrl = ''; }
        }
        return { userId: member.userId, nickname: user ? user.nickname : '家庭成员', avatarUrl, role: member.role, joinedAt: member.joinedAt };
      }));
      return ok({ members });
    }
    if (action === 'diary.list') {
      const result = await db.collection('diaries').where({ familyId: ctx.familyId }).orderBy('visitDate', 'desc').limit(100).get();
      const diaries = await hydrateDiaries(result.data || []);
      // 点赞和评论数量在 MVP 中按条目逐一统计，适合家庭的小数据量。
      await Promise.all(diaries.map(async diary => {
        diary.likesCount = await countFor('likes', { familyId: ctx.familyId, diaryId: diary._id });
        diary.commentCount = await countFor('comments', { familyId: ctx.familyId, diaryId: diary._id });
      }));
      return ok({ diaries });
    }
    if (action === 'diary.publish') {
      const content = trim(event.content).slice(0, 3000);
      const city = normCity(event.city);
      const images = Array.isArray(event.images) ? event.images.filter(x => typeof x === 'string' && x.startsWith('cloud://')).slice(0, 9) : [];
      if (!city) throw new Error('请填写旅行城市');
      if (!content && !images.length) throw new Error('至少添加一张照片或写一段文字');
      const visitDate = asDate(event.visitDate || new Date());
      const lat = validNumber(event.lat) ? Number(event.lat) : null;
      const lng = validNumber(event.lng) ? Number(event.lng) : null;
      const tags = Array.isArray(event.tags) ? event.tags.map(trim).filter(Boolean).slice(0, 10) : [];
      const travelers = Array.isArray(event.travelers) ? event.travelers.map(trim).filter(Boolean).slice(0, 20) : [];
      const payload = {
        familyId: ctx.familyId, authorId: ctx.user._id, content, images,
        country: trim(event.country) || '中国', province: trim(event.province), city,
        district: trim(event.district), spot: trim(event.spot), hotel: trim(event.hotel), restaurant: trim(event.restaurant),
        transport: trim(event.transport), amount: validNumber(event.amount) ? Number(event.amount) : null, currency: 'CNY',
        lat, lng, locationName: trim(event.locationName), visitDate, travelers, tags,
        createdAt: db.serverDate(), updatedAt: db.serverDate(), imageCount: images.length
      };
      const result = await db.collection('diaries').add({ data: payload });
      await recordVisit(ctx, { city, country: payload.country, province: payload.province, lat, lng }, visitDate, 'diary', true);
      return ok({ diaryId: result._id });
    }
    if (action === 'diary.detail') {
      const diaryId = trim(event.diaryId);
      const diary = await queryOne('diaries', { _id: diaryId, familyId: ctx.familyId });
      if (!diary) throw new Error('日记不存在，或你无权查看');
      const [hydrated] = await hydrateDiaries([diary]);
      const commentsResult = await db.collection('comments').where({ familyId: ctx.familyId, diaryId }).orderBy('createdAt', 'desc').limit(50).get();
      const comments = commentsResult.data || [];
      const commentsWithAuthors = await Promise.all(comments.map(async c => {
        let author = null; try { author = publicUser((await db.collection('users').doc(c.authorId).get()).data); } catch (_) {}
        return { ...c, author: author || { nickname: '家庭成员', avatarUrl: '' } };
      }));
      const liked = await queryOne('likes', { familyId: ctx.familyId, diaryId, userId: ctx.user._id });
      return ok({ diary: hydrated, comments: commentsWithAuthors, liked: !!liked, likesCount: await countFor('likes', { familyId: ctx.familyId, diaryId }), canDelete: diary.authorId === ctx.user._id || ctx.family.creatorId === ctx.user._id });
    }
    if (action === 'diary.delete') {
      const diaryId = trim(event.diaryId);
      if (!diaryId) throw new Error('缺少日记编号');
      const diary = await queryOne('diaries', { _id: diaryId, familyId: ctx.familyId });
      if (!diary) throw new Error('日记不存在，或你无权删除');
      // 作者可删除自己的日记；家庭创建者可管理家庭内所有日记。
      if (diary.authorId !== ctx.user._id && ctx.family.creatorId !== ctx.user._id) {
        throw new Error('只能删除自己发布的日记');
      }
      // 先删除主记录，再尽力清理关联数据和云存储文件。
      await db.collection('diaries').doc(diaryId).remove();
      const [commentsResult, likesResult] = await Promise.all([
        db.collection('comments').where({ familyId: ctx.familyId, diaryId }).limit(1000).get(),
        db.collection('likes').where({ familyId: ctx.familyId, diaryId }).limit(1000).get()
      ]);
      await Promise.all([
        ...(commentsResult.data || []).map(item => db.collection('comments').doc(item._id).remove().catch(() => null)),
        ...(likesResult.data || []).map(item => db.collection('likes').doc(item._id).remove().catch(() => null))
      ]);
      const fileIDs = Array.isArray(diary.images) ? diary.images.filter(id => typeof id === 'string' && id.startsWith('cloud://')) : [];
      if (fileIDs.length) await cloud.deleteFile({ fileList: fileIDs }).catch(() => null);
      // 同步减少城市日记数；不删除足迹本身，避免影响其他日记或手动打卡。
      const city = normCity(diary.city);
      if (city) {
        const place = await queryOne('places', { familyId: ctx.familyId, city });
        if (place) await db.collection('places').doc(place._id).update({ data: { diaryCount: Math.max(0, Number(place.diaryCount || 0) - 1), updatedAt: db.serverDate() } }).catch(() => null);
      }
      return ok({ deleted: true });
    }
    if (action === 'diary.likeToggle') {
      const diaryId = trim(event.diaryId);
      const diary = await queryOne('diaries', { _id: diaryId, familyId: ctx.familyId });
      if (!diary) throw new Error('日记不存在，或你无权操作');
      const existing = await queryOne('likes', { familyId: ctx.familyId, diaryId, userId: ctx.user._id });
      let liked;
      if (existing) { await db.collection('likes').doc(existing._id).remove(); liked = false; }
      else { await db.collection('likes').add({ data: { familyId: ctx.familyId, diaryId, userId: ctx.user._id, createdAt: db.serverDate() } }); liked = true; }
      return ok({ liked, likesCount: await countFor('likes', { familyId: ctx.familyId, diaryId }) });
    }
    if (action === 'diary.comment') {
      const diaryId = trim(event.diaryId), content = trim(event.content).slice(0, 500);
      const diary = await queryOne('diaries', { _id: diaryId, familyId: ctx.familyId });
      if (!diary) throw new Error('日记不存在，或你无权评论');
      if (!content) throw new Error('留言内容不能为空');
      const result = await db.collection('comments').add({ data: { familyId: ctx.familyId, diaryId, authorId: ctx.user._id, content, createdAt: db.serverDate() } });
      return ok({ commentId: result._id });
    }
    if (action === 'stats.mapData') {
      const result = await db.collection('places').where({ familyId: ctx.familyId }).limit(1000).get();
      return ok({ places: result.data || [] });
    }
    if (action === 'stats.checkin') {
      const place = event.place || {};
      if (!trim(place.city)) throw new Error('请先选择一个城市');
      const saved = await recordVisit(ctx, place, event.visitDate || new Date(), trim(event.source) === 'manual' ? 'manual' : 'diary', false);
      return ok({ place: saved });
    }
    if (action === 'stats.cityDetail') {
      const city = normCity(event.city);
      if (!city) throw new Error('缺少城市名称');
      const place = await queryOne('places', { familyId: ctx.familyId, city });
      const result = await db.collection('diaries').where({ familyId: ctx.familyId, city }).orderBy('visitDate', 'desc').limit(100).get();
      return ok({ place, diaries: await hydrateDiaries(result.data || []) });
    }
    if (action === 'stats.summary') {
      const placesResult = await db.collection('places').where({ familyId: ctx.familyId }).limit(1000).get();
      const places = placesResult.data || [];
      const allDiaries = await getFamilyDiaries(ctx.familyId, 5000);
      const membersResult = await db.collection('family_members').where({ familyId: ctx.familyId, isActive: true }).limit(100).get();
      const mine = allDiaries.filter(d => d.authorId === ctx.user._id);
      const countDistinct = (arr, key) => new Set(arr.map(x => trim(x[key])).filter(Boolean)).size;
      const totalPhotos = allDiaries.reduce((sum, d) => sum + Number(d.imageCount || (d.images || []).length || 0), 0);
      const myPhotos = mine.reduce((sum, d) => sum + Number(d.imageCount || (d.images || []).length || 0), 0);
      const myCheckins = await db.collection('checkins').where({ familyId: ctx.familyId, userId: ctx.user._id }).limit(1000).get();
      return ok({
        familyId: ctx.familyId, cityCount: places.length,
        provinceCount: countDistinct(places, 'province'), countryCount: countDistinct(places, 'country'),
        diaryCount: await countFor('diaries', { familyId: ctx.familyId }), photoCount: totalPhotos,
        memberCount: (membersResult.data || []).length,
        myDiaryCount: mine.length, myPhotoCount: myPhotos, myCityCount: (myCheckins.data || []).length
      });
    }
    return bad('不支持的操作');
  } catch (error) {
    // 只将业务错误信息返回前端，不返回 OpenID 或数据库内部细节。
    return bad(error && error.message ? error.message : '服务暂时不可用，请稍后重试');
  }
};