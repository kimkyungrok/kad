// 수정된 서버 파일 (title 포함)
const express = require('express');
const app = express();
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');  // 꼭 여기까지!!
const engine = require('ejs-mate');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ dest: 'public/uploads/' });
const fs = require('fs');
const port = process.env.PORT || 3000;


app.use('/uploads', express.static('/public/uploads'));
app.use(express.static(__dirname + '/public'));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.engine('ejs', engine);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: '비밀코드',
  resave: false,
  saveUninitialized: true
}));

global.excelFullData = null; // 🔥 전체 엑셀 데이터 저장용
global.excelFileName = '';

// 모든 요청에 대해 user를 res.locals에 자동 세팅
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

let db;
const url = 'mongodb+srv://krogy123:rlarudfhr1262@cluster0.qnjcx2e.mongodb.net/?retryWrites=true&w=majority&tls=true&tlsAllowInvalidCertificates=true';

new MongoClient(url)
  .connect()
  .then(client => {
    console.log('DB 연결 성공');
    db = client.db('test_kad');
  app.listen(port, () => {
      console.log('Server listening on ${port}');
    });
  })
  .catch(err => {
    console.error('DB 연결 에러:', err);
  });
  

// 로그인 필요 미들웨어
function 로그인필요(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
}

// 아이디 중복확인 API
app.get('/check-username', async (req, res) => {
  const username = req.query.username;
  const user = await db.collection('users').findOne({ username });
  
  if (user) {
    res.json({ exists: true });
  } else {
    res.json({ exists: false });
  }
});

// 메인 페이지 (홈)
app.get('/', 로그인필요, async (req, res) => {
  const currentUser = req.session.user;

  // site_settings에서 최신 업로드된 이미지 가져오기
  const setting = await db.collection('site_settings').findOne({ key: 'latestWelcomeImage' });
  const uploadedImagePath = setting ? setting.value : null;

  res.render('home', {
    title: '홈페이지',
    user: currentUser,
    uploadedImagePath  // 이거 꼭 넘긴다!
  });
});

// 회원가입 페이지
app.get('/register', (req, res) => {
  res.render('register', { title: '회원가입' });
});

// 환영 페이지
app.get('/welcome', 로그인필요, async (req, res) => {
  const currentUser = req.session.user;

  // site_settings에서 최신 업로드된 이미지를 가져옴
  const setting = await db.collection('site_settings').findOne({ key: 'latestWelcomeImage' });
  const uploadedImagePath = setting ? setting.value : null;

  res.render('welcome', {
    title: '환영 페이지',
    user: currentUser,
    uploadedImagePath  // 모든 유저에게 공통으로 넘겨줌!
  });
});



// 로그인 실패 페이지
app.get('/login-fail', (req, res) => {
  res.render('login-fail', { title: '로그인 실패' });
});


// 회원가입 처리 (비밀번호 해시화 없이 저장)
app.post('/register', async (req, res) => {
  try {
    const {
      username,
      password,
      passwordConfirm,
      name,
      connectId,
      phone,
      birthdate,
      branch,
      bankNameSelect,  // 드롭다운 값
      bankNameInput,   // 직접입력 값
      accountNumber,
      depositAccount
    } = req.body;

    // 필수 항목 체크
    if (!username || !password || !passwordConfirm || !name || !connectId || !phone || !birthdate || !branch || !accountNumber || !depositAccount) {
      return res.status(400).send('모든 필수 입력 항목을 채워주세요.');
    }

    // 비밀번호 일치 검사
    if (password !== passwordConfirm) {
      return res.status(400).send('비밀번호와 비밀번호 확인이 일치하지 않습니다.');
    }

    // 비밀번호 복잡도 검사
    const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_+=\-{}\[\]:;"'<>,.?/]).{8,}$/;
    if (!passwordPattern.test(password)) {
      return res.status(400).send('비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.');
    }

    // 최종 은행명 결정
    const finalBankName = bankNameSelect === '직접입력' ? bankNameInput : bankNameSelect;
    if (!finalBankName) {
      return res.status(400).send('은행명을 선택하거나 입력해주세요.');
    }

    // 아이디 중복 확인
    const existingUser = await db.collection('users').findOne({ username });
    if (existingUser) {
      return res.status(409).send('이미 사용 중인 아이디입니다.');
    }

    // DB 저장
    await db.collection('users').insertOne({
      username,
      password,  // 실제 운영 환경에서는 bcrypt 해싱 필요
      name,
      connectId,
      phone,
      birthdate,
      branch,
      bankName: finalBankName,
      accountNumber,
      depositAccount,
      createdAt: new Date()
    });

    console.log(`회원가입 완료: ${username}`);
    res.redirect('/login');

  } catch (err) {
    console.error(err);
    res.status(500).send('서버 오류 발생');
  }
});



// 로그인 페이지
app.get('/login', (req, res) => {
  res.render('login', { title: '로그인' });
});

// 로그인 처리 (로그인 성공 시 환영 화면으로 이동)
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.collection('users').findOne({ username });

  if (user && user.password === password) {
    req.session.user = user;
    res.redirect('/welcome'); // 성공하면 /welcome으로 이동
  } else {
    res.redirect('/login-fail'); // 실패하면 /login-fail로 이동
  }
});

// 로그인 실패 페이지
app.get('/login-fail', (req, res) => {
  res.render('login-fail');
});

// 개인 맞춤 게시판

app.get('/my-posts', 로그인필요, async (req, res) => {
  try {
    const currentUser = req.session.user;
    const { branch, username } = req.query;

    let filter = {};
    let allUsers = [];
    const isAdmin = ['krogy', 'admin'].includes(currentUser.username);

    if (isAdmin) {
      // 관리자: 조건부 검색 필터 적용
      if (branch) filter.branch = branch;
      if (username) filter.username = username;

      allUsers = await db.collection('users')
        .find({}, { projection: { username: 1, name: 1 } })
        .toArray();
    } else {
      // 일반 사용자: riderName 또는 username이 본인과 일치하는 게시물만 조회
      filter = {
        $or: [
          { riderName: currentUser.name },
          { username: currentUser.username }
        ]
      };
    }

    const posts = await db.collection('posts')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.render('my-posts', {
      title: '내 게시판',
      posts,
      user: currentUser,
      allUsers
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('게시글 조회 중 오류 발생');
  }
});

// 등록된 유저 목록 페이지
app.get('/users', 로그인필요, async (req, res) => {
  try {
    // 현재 로그인한 사용자가 krogy 인지 확인
    const allowedUsers = ['krogy', 'admin'];
    if (!allowedUsers.includes(req.session.user.username)) {
      return res.status(403).send('접근 권한이 없습니다.');
    }

    const users = await db.collection('users').find().toArray();
    res.render('users', { title: '등록된 유저 목록', users });
  } catch (err) {
    console.error(err);
    res.status(500).send('유저 목록 불러오기 실패');
  }
});

// 글쓰기 페이지 
app.get('/write', 로그인필요, (req, res) => {
  const allowedUsers = ['krogy', 'admin'];
  if (!allowedUsers.includes(req.session.user.username)) {
    return res.status(403).send('접근 권한이 없습니다.');
  }
  res.render('write', { title: '정보 등록' });
});


// 이름으로 유저 정보 조회 API
app.get('/find-user', async (req, res) => {
  const name = req.query.name;
  try {
    const user = await db.collection('users').findOne({ name });
    if (!user) {
      return res.json({});
    }

    res.json({
      username: user.username,
      branch: user.branch,
      name: user.name,
      bankName: user.bankName || '',
      accountNumber: user.accountNumber || '',
      depositAccount: user.depositAccount || '',
      registerNumber: user.registerNumber || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('서버 오류');
  }
});


// 글 등록 처리
// write POST - krogy/admin만 저장 가능
app.post('/write', async (req, res) => {
  try {
    const currentUser = req.session.user;

    // krogy나 admin만 작성 허용
    if (!currentUser || (currentUser.username !== 'krogy' && currentUser.username !== 'admin')) {
      return res.status(403).send('<h2>권한이 없습니다. 관리자만 작성 가능합니다.</h2><a href="/">홈으로</a>');
    }

    // 입력 폼에서 데이터 추출
    const {
      name, username, userName, branch,
      riderName, taskCount, residentId, depositAccount, bankName, accountNumber,
      deliveryFeeA, additionalPaymentB, totalDeliveryFeeC, necessaryExpense, paymentAmount,
      riderEmploymentInsurance, riderIndustrialInsurance, riderRetroEmployment, riderRetroIndustrial, riderFinalPaymentH,
      incomeTax, residentTax, withholdingTax, insuranceFee,
      setAchievement, taxFee, ownerInsuranceFee,
      promoRate, promotaskCount, finalPromoPayment, fuelSupport,
      paymentA, refundB, supportC, finalPayment,
      settlementStart, settlementEnd, payDay ,statementPaper
    } = req.body;

    // 제목 자동 생성
    const now = new Date();
    const D = d => d.toString().padStart(2, '0');
    const hour = now.getHours(), ampm = hour < 12 ? '오전' : '오후', hour12 = hour % 12 || 12;
    const minutes = D(now.getMinutes());
    const generatedTitle = statementPaper;

    const newPost = {
      title: generatedTitle,
      name,
      username,
      userName,
      branch,
      riderName,
      taskCount,
      residentId,
      depositAccount,
      bankName,
      accountNumber,
      deliveryFeeA,
      additionalPaymentB,
      totalDeliveryFeeC,
      necessaryExpense,
      paymentAmount,
      riderEmploymentInsurance,
      riderIndustrialInsurance,
      riderRetroEmployment,
      riderRetroIndustrial,
      riderFinalPaymentH,
      incomeTax,
      residentTax,
      withholdingTax,
      insuranceFee,
      setAchievement,
      taxFee,
      ownerInsuranceFee,
      promoRate,
      promotaskCount,
      finalPromoPayment,
      fuelSupport,
      paymentA,
      refundB,
      supportC,
      finalPayment,
      settlementStart,
      settlementEnd,
      payDay,
      confirmed: 'no',
      createdAt: new Date()
    };

    // 저장
    await db.collection('posts').insertOne(newPost);
    res.redirect('/my-posts');
  } catch (err) {
    console.error('정산서 등록 오류:', err);
    res.status(500).send('정산서 등록 중 서버 오류 발생');
  }
});

// 삭제 처리
app.post('/delete-posts', async (req, res) => {
  const currentUser = req.session.user;
  if (!['krogy', 'admin'].includes(currentUser?.username)) {
    return res.status(403).send('권한이 없습니다.');
  }

  try {
    const deleteIds = Array.isArray(req.body.deleteIds) ? req.body.deleteIds : [req.body.deleteIds];

    const objectIds = deleteIds.map(id => new ObjectId(id));
    await db.collection('posts').deleteMany({ _id: { $in: objectIds } });

    res.redirect('/my-posts');
  } catch (err) {
    console.error('게시글 삭제 오류:', err);
    res.status(500).send('게시글 삭제 중 오류 발생');
  }
});


// 게시글 상세보기
app.get('/post/:id', 로그인필요, async (req, res) => {
  try {
    const postId = req.params.id;
    const post = await db.collection('posts').findOne({ _id: new ObjectId(postId) });

    if (!post) {
      return res.status(404).send('게시글을 찾을 수 없습니다.');
    }

    res.render('post-detail', { title: post.title, post });
  } catch (err) {
    console.error(err);
    res.status(500).send('게시글 조회 중 오류 발생');
  }
});

// 게시글 삭제
app.post('/post/:id/delete', 로그인필요, async (req, res) => {
  try {
    const user = req.session.user;
    const postId = req.params.id;

    const post = await db.collection('posts').findOne({ _id: new ObjectId(postId) });

    if (!post) {
      return res.status(404).send('게시글을 찾을 수 없습니다.');
    }

    // krogy, admin 계정이거나 본인 글일 경우 삭제 허용
    if (user.username === 'krogy' || user.username === 'admin' ) { //|| post.author === user.username
      await db.collection('posts').deleteOne({ _id: new ObjectId(postId) });
      return res.redirect('/my-posts');
    } else {
      return res.status(403).send('삭제 권한이 없습니다.');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('게시글 삭제 중 오류 발생');
  }
});

// 정산서 본인 확인
app.post('/post/:id/confirm', 로그인필요, async (req, res) => {
  const postId = req.params.id;
  const currentUser = req.session.user;

  try {
    await db.collection('posts').updateOne(
      { _id: new ObjectId(postId), username: currentUser.username },
      { $set: { confirmed: 'yes' } }
    );
    res.redirect(`/post/${postId}`);
  } catch (err) {
    console.error('확인 처리 오류:', err);
    res.status(500).send('서버 오류');
  }
});


// 수정 폼 페이지
app.get('/edit-user/:id', 로그인필요, async (req, res) => {
  const allowedUsers = ['krogy', 'admin'];
  if (!allowedUsers.includes(req.session.user.username)) {
    return res.status(403).send('접근 권한이 없습니다.');
  }

  const user = await db.collection('users').findOne({ _id: new ObjectId(req.params.id) });
  res.render('edit-user', { title: '가입자 수정', user });
});

// 수정 저장 처리
app.post('/edit-user/:id', async (req, res) => {
  // 로그인 확인
  if (!req.session || !req.session.user) {
    return res.status(401).send('로그인이 필요합니다.');
  }

  // 관리자 계정만 수정 가능
  const allowedUsers = ['krogy', 'admin'];
  if (!allowedUsers.includes(req.session.user.username)) {
    return res.status(403).send('접근 권한이 없습니다.');
  }

  try {
    const {
      name,
      connectId,
      phone,
      birthdate,
      branch,
      bankName,
      accountNumber,
      depositAccount,
      registerNumber 
    } = req.body;

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          name,
          connectId,
          phone,
          birthdate,
          branch,
          bankName,
          accountNumber,
          depositAccount,
          registerNumber 
        }
      }
    );

    console.log(`✅ 사용자 정보 수정 완료: ${req.params.id}`);
    res.redirect('/user-list'); // ✅ 목록 페이지로 이동

  } catch (err) {
    console.error('❌ 사용자 수정 실패:', err);
    res.status(500).send('서버 오류로 인해 사용자 정보를 수정할 수 없습니다.');
  }
});

app.get('/user-list', async (req, res) => {
  try {
    const users = await db.collection('users').find({}).toArray();
    res.render('user-list', { users });
  } catch (error) {
    console.error('유저 목록 로딩 오류:', error);
    res.status(500).send('서버 오류 발생');
  }
});


// 삭제 처리
app.post('/delete-user/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await db.collection('users').deleteOne({ _id: new ObjectId(userId) });

    if (result.deletedCount === 1) {
      console.log(`🗑️ 사용자 삭제 완료: ${userId}`);
      res.redirect('/user-list'); // 유저 목록 페이지로 리디렉션
    } else {
      res.status(404).send('사용자를 찾을 수 없습니다.');
    }
  } catch (error) {
    console.error('사용자 삭제 오류:', error);
    res.status(500).send('서버 오류 발생');
  }
});

//메인화면 이미지 등록
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const now = new Date();
    const D = n => n.toString().padStart(2, '0');
    const datePart = `${now.getFullYear()}.${D(now.getMonth() + 1)}.${D(now.getDate())}`;
    const timePart = `${D(now.getHours())}-${D(now.getMinutes())}`;
    const koreanTime = `${datePart} ${timePart}`;
    cb(null, 'welcome-' + koreanTime + path.extname(file.originalname));
  }
});

// 업로드 라우터
app.post('/upload-welcome-image', 로그인필요, upload.single('welcomeImage'), async (req, res) => {
  const currentUser = req.session.user;

  if (currentUser.username !== 'krogy' && currentUser.username !== 'admin') {
    return res.status(403).send('권한이 없습니다.');
  }

  const uploadedImagePath = '/uploads/' + req.file.filename;

  // DB의 users 컬렉션에 업로드 경로 저장
  await db.collection('site_settings').updateOne(
    { key: 'latestWelcomeImage' },
    { $set: { value: uploadedImagePath } },
    { upsert: true }
  );
  

  // 세션에도 바로 반영
  req.session.user.uploadedImagePath = uploadedImagePath;

  res.redirect('/welcome');  // 다시 welcome 페이지로 이동
});


let excelData = {}; // 메모리에 저장 (간단 버전)

app.get('/accounts', (req, res) => {
  res.render('accounts', { title: '엑셀 업로드' });
});

// 엑셀 업로드
app.post('/upload-excel', upload.single('file'), (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).send('파일이 없습니다.');
  }

  try {
    const workbook = XLSX.readFile(file.path);

    const sheets = {};

    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet['!ref']);

      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellAddress = { c: C, r: R };
          const cellRef = XLSX.utils.encode_cell(cellAddress);
          const cell = worksheet[cellRef];

          if (cell && cell.t === 'n') {
            // 수치가 20000 이상이면 날짜로 간주
            if (cell.v > 20000 && cell.v < 60000) {
              const date = XLSX.SSF.parse_date_code(cell.v);
              if (date) {
                const year = date.y;
                const month = String(date.m).padStart(2, '0');
                const day = String(date.d).padStart(2, '0');
                worksheet[cellRef].v = `${year}-${month}-${day}`;
                worksheet[cellRef].w = `${year}-${month}-${day}`;
              }
            }
          }
        }
      }

      const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
      sheets[sheetName] = json;
    });

    global.excelFullData = {
      sheetNames: workbook.SheetNames,
      sheets: sheets,
    };

    global.excelFileName = file.originalname;

    console.log('엑셀 업로드 성공:', global.excelFileName);

    fs.unlink(file.path, (err) => {
      if (err) console.error('임시파일 삭제 실패:', err);
    });

    res.redirect('/accounts');
  } catch (err) {
    console.error('엑셀 파싱 실패:', err);
    res.status(500).send('엑셀 파일 읽기 실패');
  }
});


//서버에 엑셀 데이터 조회 API
app.get('/excel-data', (req, res) => {
  if (!global.excelFullData) {
    return res.status(404).json({ error: "엑셀 데이터 없음" });
  }
  res.json(global.excelFullData);
});

// 로그아웃
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

//탈퇴
app.get('/terminate', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login'); // 비로그인 시 로그인 페이지로
  }
  res.render('terminate'); // terminate.ejs 파일로 렌더링
});

// 실제 탈퇴 처리
app.post('/delete-account', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('로그인이 필요합니다.');
  }

  try {
    await db.collection('users').deleteOne({ username: req.session.user.username });

    // 세션 제거 후 굿바이페이지로 이동
    req.session.destroy(err => {
      if (err) {
        console.error('세션 삭제 오류:', err);
        return res.status(500).send('세션 삭제 오류');
      }
      res.redirect('/goodbye');
    });
  } catch (err) {
    console.error('회원 탈퇴 오류:', err);
    res.status(500).send('회원 탈퇴 중 오류 발생');
  }
});

app.get('/goodbye', (req, res) => {
  res.render('goodbye');
});

//마이페이지
app.get('/my-page', 로그인필요, async (req, res) => {
  const user = await db.collection('users').findOne({ username: req.session.user.username });
  res.render('my-page', { user });
});

app.post('/update-my-info', 로그인필요, async (req, res) => {
  const { phone, bankName, accountNumber, depositAccount, registerNumber } = req.body;
  await db.collection('users').updateOne(
    { username: req.session.user.username },
    {
      $set: { phone, bankName, accountNumber, depositAccount, registerNumber }
    }
  );
  res.redirect('/my-page');
});
