const isAdmin = async (req, res, next) => {
  if (!req.session?.user?.username) {
    return res.status(401).send('로그인이 필요합니다.');
  }

  const currentUsername = req.session.user.username;

  try {
    const admin = await req.app.locals.db.collection('admins').findOne({ username: currentUsername });
    if (!admin) {
      return res.status(403).send('접근 권한이 없습니다.');
    }
    next();
  } catch (err) {
    console.error('isAdmin 오류:', err);
    res.status(500).send('관리자 권한 확인 중 서버 오류');
  }
};

module.exports = isAdmin; // ✅ 반드시 이 줄이 있어야 합니다!
