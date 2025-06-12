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
const uploadPath = 'public/uploads';
const isAdmin = require('./middlewares/isAdmin');
const now = new Date();
const nowKST = new Date(now.getTime() + 9 * 60 * 60 * 1000); // KST
const bodyParser = require('body-parser');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

app.use('/uploads', express.static('/public/uploads'));
app.use(express.static(__dirname + '/public'));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.engine('ejs', engine);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
  secret: '비밀코드',
  resave: false,
  saveUninitialized: true
}));

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}


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
     app.locals.db = db;
  app.listen(port, () => {
      console.log('Server listening on ${port}');
    });
  })
  .catch(err => {
    console.error('DB 연결 에러:', err);
  });


// 이벤트 이미지 업로드용 multer 설정
const eventStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/events/');
  },
  filename: (req, file, cb) => {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // 한국 시간
    const D = n => n.toString().padStart(2, '0');
    const datePart = `${now.getFullYear()}${D(now.getMonth() + 1)}${D(now.getDate())}`;
    const timePart = `${D(now.getHours())}${D(now.getMinutes())}${D(now.getSeconds())}`;
    cb(null, `event_${datePart}_${timePart}${path.extname(file.originalname)}`);
  }
});

const eventUpload = multer({ storage: eventStorage });

// 로그인 필요 미들웨어
function 로그인필요(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
}
// 메일 발송
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'krogy123@gmail.com', // 발신자 이메일
    pass: 'okbf tahn sche hdbx'           // Gmail의 앱 비밀번호 (2단계 인증 사용자 필수)
  }
});

// 아이디 중복확인 API
app.post('/check-username', async (req, res) => {
  const { username } = req.body;
  const existingUser = await db.collection('users').findOne({ username });

  if (existingUser) {
    return res.json({ status: 'error', message: '이미 사용 중인 아이디입니다.' });
  }

  return res.json({ status: 'success', message: '사용 가능한 아이디입니다.' });
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

  const setting = await db.collection('site_settings').findOne({ key: 'latestWelcomeImage' });
  const uploadedImagePath = setting ? setting.value : null;

  const activeEvent = await db.collection('events').findOne({ status: 'active' });

  res.render('welcome', {
    title: '환영 페이지',
    user: currentUser,
    uploadedImagePath,
    activeEvent  // ✅ 진행중 이벤트 1개 전달
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
      username, password, passwordConfirm, name, connectId, phone,
      birthdate, branch, bankNameSelect, bankNameInput,
      accountNumber, depositAccount
    } = req.body;

    if (!username || !password || !passwordConfirm || !name || !connectId || !phone || !birthdate || !branch || !accountNumber || !depositAccount) {
      return res.json({ status: 'error', message: '모든 필수 입력 항목을 채워주세요.' });
    }

    if (password !== passwordConfirm) {
      return res.json({ status: 'error', message: '비밀번호와 비밀번호 확인이 일치하지 않습니다.' });
    }

    const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_+=\-{}\[\]:;"'<>,.?/]).{8,}$/;
    if (!passwordPattern.test(password)) {
      return res.json({ status: 'error', message: '비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.' });
    }

    const finalBankName = bankNameSelect === '직접입력' ? bankNameInput : bankNameSelect;
    if (!finalBankName) {
      return res.json({ status: 'error', message: '은행명을 선택하거나 입력해주세요.' });
    }

    const existingUser = await db.collection('users').findOne({ username });
    if (existingUser) {
      return res.json({ status: 'error', message: '이미 사용 중인 아이디입니다.' });
    }

    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);

    // 1️⃣ 회원정보 저장
    await db.collection('users').insertOne({
      username,
      password,
      name,
      connectId,
      phone,
      birthdate,
      branch,
      bankName: finalBankName,
      accountNumber,
      depositAccount,
      approved: false,
      createdAt: nowKST
    });

    console.log(`회원가입 완료 (승인 대기): ${username}`);

    // 2️⃣ 관리자에게 메일 전송
    const mailOptions = {
      from: '"KAD 회원가입 시스템" <krogy123@gmail.com>',
      to: 'krogy123@gmail.com,krogy@naver.com',
      subject: `[가입요청] ${name} 님이 회원가입을 요청했습니다.`,
      text: `
📌 이름: ${name}
👤 아이디: ${username}
🏢 지사: ${branch}
📱 전화번호: ${phone}

신규 회원가입 요청이 접수되었습니다.
관리자 페이지에서 승인 처리를 해 주세요.
      `
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('❌ 메일 발송 실패:', error);
      } else {
        console.log('✅ 가입요청 메일 발송 완료:', info.response);
      }
    });

    // 3️⃣ 사용자에게 응답
    res.json({ status: 'success', message: '회원가입 신청이 완료되었습니다. 관리자의 승인을 기다려주세요.' });

  } catch (err) {
    console.error('❌ 회원가입 처리 중 오류:', err);
    res.status(500).send('서버 오류 발생');
  }
});


// 로그인 페이지
app.get('/login', (req, res) => {
  res.render('login', { title: '로그인' });
});

// 로그인 처리 (로그인 성공 시 환영 화면으로 이동)
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const db = req.app.locals.db;

    const user = await db.collection('users').findOne({ username });

    if (!user || user.password !== password) {
      return res.redirect('/login-fail');
    }

    if (!user.approved) {
      return res.redirect('/approved');
    }

    req.session.user = user;
    res.redirect('/welcome');

  } catch (err) {
    console.error('❌ 로그인 오류:', err);
    res.status(500).send('서버 오류 발생');
  }
});


// 로그인 실패 페이지
app.get('/login-fail', (req, res) => {
  res.render('login-fail');
});

// 가입 승인 대기 페이지
app.get('/approved', (req, res) => {
  res.render('approved');
});

// 개인 맞춤 게시판

app.get('/my-posts', 로그인필요, async (req, res) => {
  try {
    const currentUser = req.session.user;
    const { branch, username } = req.query;

    let filter = {};
    let allUsers = [];
    //const isAdmin = ['krogy', 'admin'].includes(currentUser.username);

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
app.get('/users', 로그인필요, isAdmin, async (req, res) => {
  try {
    const users = await db.collection('users').find().toArray();
    res.render('users', { title: '등록된 유저 목록', users });
  } catch (err) {
    console.error(err);
    res.status(500).send('유저 목록 불러오기 실패');
  }
});

// 글쓰기 페이지 
app.get('/write', 로그인필요, async (req, res) => {
  const allowedUsers = ['krogy', 'admin'];
  if (!allowedUsers.includes(req.session.user.username)) {
    return res.status(403).send('접근 권한이 없습니다.');
  }

  // 🔽 최신 프로모션 데이터 1개 가져오기
  const latest = await db.collection('promotions')
    .find({ type: 'table' })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();

  // 🔽 데이터 포맷 변경 (data 배열 형태)
  let latestPromo = null;
  if (latest.length > 0 && latest[0].content) {
    latestPromo = {
      createdAt: latest[0].createdAt,
      data: Object.values(latest[0].content).map(row => {
        const values = Object.values(row);
        return {
          name: values[0],
          pay: values[1]
        };
      })
    };
  }

  res.render('write', { title: '정보 등록',latestPromo});
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
app.post('/write', 로그인필요, isAdmin, async (req, res) => {
  try {
    const currentUser = req.session.user;

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

    const now = new Date(); // 먼저 선언
    const nowKST = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC+9

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
      createdAt: nowKST
    };

    await db.collection('posts').insertOne(newPost);
    res.redirect('/my-posts');
  } catch (err) {
    console.error('정산서 등록 오류:', err);
    res.status(500).send('정산서 등록 중 서버 오류 발생');
  }
});


// 삭제 처리
app.post('/delete-posts', 로그인필요, isAdmin, async (req, res) => {
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

    res.render('post-detail', { title: `${post.riderName} (${post.branch}) 정산 내역서`, post });
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

    // 관리자 여부 확인
    const isAdminUser = await req.app.locals.db.collection('admins').findOne({ username: user.username });

    // 관리자이거나 작성자 본인이면 삭제 허용
    if (isAdminUser || post.username === user.username) {
      await db.collection('posts').deleteOne({ _id: new ObjectId(postId) });
      return res.redirect('/my-posts');
    } else {
      return res.status(403).send('삭제 권한이 없습니다.');
    }

  } catch (err) {
    console.error('게시글 삭제 중 오류:', err);
    res.status(500).send('게시글 삭제 중 서버 오류 발생');
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
app.get('/edit-user/:id', 로그인필요, isAdmin, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.params.id) });
    if (!user) {
      return res.status(404).send('사용자를 찾을 수 없습니다.');
    }

    res.render('edit-user', { title: '가입자 수정', user });
  } catch (err) {
    console.error('사용자 정보 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});


// 수정 저장 처리
app.post('/edit-user/:id', 로그인필요, isAdmin, async (req, res) => {
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
    res.redirect('/user-list');
    
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
      res.redirect('/users'); // 유저 목록 페이지로 리디렉션
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
    const now = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC+9
    const D = n => n.toString().padStart(2, '0');
    const datePart = `${now.getFullYear()}.${D(now.getMonth() + 1)}.${D(now.getDate())}`;
    const timePart = `${D(now.getHours())}-${D(now.getMinutes())}`;
    const koreanTime = `${datePart} ${timePart}`;
    cb(null, 'welcome-' + koreanTime + path.extname(file.originalname));
  }
});

// 업로드 라우터
app.post('/upload-welcome-image',로그인필요, isAdmin,upload.single('welcomeImage'),async (req, res) => {
    try {
      const uploadedImagePath = '/uploads/' + req.file.filename;

      // DB에 저장
      await db.collection('site_settings').updateOne(
        { key: 'latestWelcomeImage' },
        { $set: { value: uploadedImagePath } },
        { upsert: true }
      );

      // 세션에도 저장
      req.session.user.uploadedImagePath = uploadedImagePath;

      res.redirect('/welcome');
    } catch (err) {
      console.error('이미지 업로드 실패:', err);
      res.status(500).send('이미지 저장 중 오류 발생');
    }
  }
);


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

    // ✅ 추가: 2번째 시트에서 C18~ 아래 행 추출
    const secondSheetName = workbook.SheetNames[1]; // 인덱스 1: 두 번째 시트
    const secondSheetData = sheets[secondSheetName];

    const riderData = [];

    for (let i = 17; i < secondSheetData.length; i++) {
      const row = secondSheetData[i];
      const name = row[2];  // C열
      const value = row[3]; // D열

      if (name && name.toString().trim() !== '') {
        riderData.push({
          name: name.toString().trim(),
          value: parseFloat(value) || 0
        });
      }
    }

    // ✅ 병합 그룹 정의
const mergeGroups = [
  { name: '함형민', aliases: ['함형민', '김세라'] },
  { name: '장래규', aliases: ['장래규', '임미경'] },
  { name: '이상협', aliases: ['이상협', '김주은'] }
];

// 2. 병합
const mergedData = [];
const usedNames = new Set();

mergeGroups.forEach(group => {
  let total = 0;
  riderData.forEach(item => {
    if (group.aliases.includes(item.name)) {
      total += item.value;
      usedNames.add(item.name);
    }
  });
  mergedData.push({ name: group.name, value: total });
});

// 3. 병합되지 않은 나머지 데이터 추가
riderData.forEach(item => {
  if (!usedNames.has(item.name)) {
    mergedData.push(item);
  }
});

// 4. 정렬
mergedData.sort((a, b) => b.value - a.value);

// 5. 장래규, 이상협 제거
const filtered = mergedData.filter(item => item.name !== '장래규' && item.name !== '이상협');

// 6. 상위 5명에게만 등수 부여
const finalData = filtered.map((item, index) => {
  if (index < 5) {
    return { ...item, rank: `${index + 1}등` };
  } else {
    return { ...item, rank: '' };
  }
});

global.riderData = finalData;

    console.log('엑셀 업로드 성공:', global.excelFileName);
    console.log('라이더 정산 데이터 수:', mergedData.length);

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

app.get('/promoReg', async (req, res) => {
  const users = await db.collection('users').find().toArray();
  res.render('promoReg', { users });
});

// promoReg.ejs 제출 처리
app.get('/promoReg', 로그인필요, isAdmin, async (req, res) => {
  try {
    const users = await db.collection('users').find().toArray();
    res.render('promoReg', { users });
  } catch (err) {
    console.error('프로모션 등록 페이지 로딩 실패:', err);
    res.status(500).send('서버 오류');
  }
});


app.post('/promoReg', 로그인필요, isAdmin, async (req, res) => {
  try {
    const { promoTitle, paymentType, conditionType, promoText, tableData } = req.body;

    const promo = {
      title: promoTitle,
      paymentType,
      conditionType,
      type: promoText ? 'text' : 'table',
      content: promoText || tableData || {},
      createdAt: nowKST
    };

    await db.collection('promotions').insertOne(promo);
    res.redirect('/promoPage');
  } catch (err) {
    console.error('프로모션 등록 오류:', err);
    res.status(500).send('서버 오류');
  }
});


//프로모션 페이지 랜더링
app.get('/promoPage', 로그인필요, async (req, res) => {
  const promos = await db.collection('promotions').find().sort({ createdAt: -1 }).toArray();
  res.render('promoPage', { promos });
});

//프로모션 페이지 삭제 기능
app.post('/promo/:id/delete', 로그인필요, isAdmin, async (req, res) => {
  try {
    await db.collection('promotions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/promoPage');
  } catch (err) {
    console.error('프로모션 삭제 오류:', err);
    res.status(500).render('error', {
      title: '서버 오류',
      message: '프로모션 삭제 중 오류가 발생했습니다.'
    });
  }
});



app.get('/accountTable', async (req, res) => {
  const promos = await db.collection('promotions').find({}).toArray();
  res.render('accountTable', {
    riderData: global.riderData || [],
    promos
  });
});

app.post('/save-promo-result', 로그인필요, async (req, res) => {
  try {
    const { date, data } = req.body;
    const user = req.session.user;

    await db.collection('promotion_results').insertOne({
      date,
      data,
      createdAt: nowKST,
      createdBy: user.username
    });

    res.json({ message: '프로모션 결과가 저장되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '저장 실패' });
  }
});

app.get('/my-promoPage', 로그인필요, async (req, res) => {
  const user = req.session.user;
  const latestPromo = await db.collection('promotion_results').find().sort({ createdAt: -1 }).limit(1).toArray();
  let allPromos = [];

  if (['admin', 'krogy'].includes(user.username)) {
    allPromos = await db.collection('promotion_results').find().sort({ createdAt: -1 }).toArray();
  }

  res.render('my-promoPage', {
    title: '프로모션 결과 확인',
    user,
    latestPromo: latestPromo[0] || null,
    allPromos
  });
});


// 최신 프로모션 지급 결과 반환 API
app.get('/latest-promo', async (req, res) => {
  try {
    const latest = await db.collection('promotion_results')
      .find({})
      .sort({ createdAt: -1 }) // 최신순 정렬
      .limit(1)
      .toArray();

    if (!latest || latest.length === 0) {
      return res.json({});
    }

    res.json(latest[0]); // { date, createdBy, data: [ {name, value, rank, pay}, ... ] }
  } catch (err) {
    console.error('❌ 최신 프로모션 데이터 조회 실패:', err);
    res.status(500).json({ error: '서버 오류 발생' });
  }
});

app.delete('/promo-result/:id', 로그인필요, async (req, res) => {
  const user = req.session.user;
  if (!['admin', 'krogy'].includes(user?.username)) {
    return res.status(403).json({ message: '접근 권한 없음' });
  }

  try {
    const id = req.params.id;
    const result = await db.collection('promotion_results').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 1) {
      return res.json({ message: '삭제되었습니다.' });
    } else {
      return res.status(404).json({ message: '대상을 찾을 수 없습니다.' });
    }
  } catch (err) {
    console.error('삭제 실패:', err);
    res.status(500).json({ message: '서버 오류' });
  }
});

// 🔹 관리자 페이지 렌더링
app.get('/admin-register', async (req, res) => {
  try {
    const admins = await db.collection('admins').find().sort({ createdAt: -1 }).toArray();
    res.render('admin-register', { adminList: admins });
  } catch (err) {
    res.status(500).send('관리자 목록 불러오기 실패');
  }
});

// 🔹 관리자 추가
app.post('/admin-register/add', async (req, res) => {
  const { name, username } = req.body;
  if (!name || !username) return res.status(400).send('이름 또는 아이디 누락');

  try {
    const exists = await db.collection('admins').findOne({ username });
    if (exists) return res.status(409).send('이미 등록된 아이디입니다.');

    await db.collection('admins').insertOne({ name, username, createdAt: new Date() });
    res.status(200).send('등록 성공');
  } catch (err) {
    console.error(err);
    res.status(500).send('DB 저장 실패');
  }
});

// 🔹 관리자 삭제
app.post('/admin-register/delete', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).send('아이디 누락');

  try {
    await db.collection('admins').deleteOne({ username });
    res.status(200).send('삭제 성공');
  } catch (err) {
    console.error(err);
    res.status(500).send('삭제 실패');
  }
});

app.get('/admin-pending', async (req, res) => {
  const db = req.app.locals.db;
  const users = await db.collection('users').find({ approved: false }).toArray();
  res.render('admin-pending', { users });
});

app.post('/approve-user/:id', async (req, res) => {
  const db = req.app.locals.db;
  await db.collection('users').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { approved: true } }
  );
  res.redirect('/admin-pending');
});

app.post('/reject-user/:id', async (req, res) => {
  const db = req.app.locals.db;
  await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin-pending');
});

// GET: ScoreTable 페이지 로딩
app.get('/ScoreTable', 로그인필요, async (req, res) => {
  const user = req.session.user;

  const adminList = await db.collection('admins').find().toArray();
  const scoreDoc = await db.collection('score_data').findOne({ _id: 'shared' });

  const savedScore = scoreDoc?.data || {};
  const savedAt = scoreDoc?.updatedAt || null; // <-- 이 부분에서 const 키워드 필요

  res.render('ScoreTable', {
    title: '시간대별 점수',
    currentUser: user,
    adminList,
    allScoreData: savedScore,
    updatedAt: savedAt
  });
});


app.post('/save-score', 로그인필요, async (req, res) => {
  try {
    const user = req.session.user;
    const { data } = req.body;

    // 관리자 확인
    const adminList = await db.collection('admins').find().toArray();
    const isAdmin = adminList.some(admin => admin.username === user.username);

    if (!isAdmin) return res.status(403).json({ error: '관리자만 저장할 수 있습니다.' });

    // score_data 컬렉션에 단일 문서로 저장
    await db.collection('score_data').updateOne(
      { _id: 'shared' },
      { $set: { data, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ status: 'success' });
  } catch (err) {
    console.error('❌ 점수 저장 실패:', err);
    res.status(500).json({ error: '저장 실패' });
  }
});



// 매주 수요일 오전 6시(KST) 삭제 (→ UTC 화요일 21시)
cron.schedule('0 21 * * 2', async () => {
  try {
    await db.collection('score_data').deleteMany({});
    console.log('✅ 주간 점수 데이터 삭제 완료');
  } catch (err) {
    console.error('❌ 주간 점수 삭제 실패:', err);
  }
});

// 아이디 및 비밀번호 찾기 페이지 렌더링
app.get('/FindAccount', (req, res) => {
  res.render('FindAccount', { message: '' });
});

// 아이디 찾기 처리
app.post('/find-id', async (req, res) => {
  try {
    const { name, phone } = req.body;
    const user = await db.collection('users').findOne({ name, phone });
    const message = user
      ? `당신의 아이디는 ${user.username}입니다.`
      : '일치하는 정보가 없습니다.';
    res.render('FindAccount', { message });
  } catch (err) {
    console.error('아이디 찾기 오류:', err);
    res.status(500).send('서버 오류');
  }
});

// 비밀번호 찾기 처리
app.post('/find-password', async (req, res) => {
  try {
    const { username, phone } = req.body;
    const user = await db.collection('users').findOne({ username, phone });
    const message = user
      ? `비밀번호는 ${user.password} 입니다.`
      : '일치하는 정보가 없습니다.';
    res.render('FindAccount', { message });
  } catch (err) {
    console.error('비밀번호 찾기 오류:', err);
    res.status(500).send('서버 오류');
  }
});
// 메일 발송자 설정 (예: Gmail 기준)

app.get('/SetEvent', 로그인필요, isAdmin, async (req, res) => {
  try {
    const [activeEvents, doneEvents] = await Promise.all([
      db.collection('events').find({ status: 'active' }).sort({ createdAt: -1 }).toArray(),
      db.collection('events').find({ status: 'done' }).sort({ completedAt: -1 }).toArray()
    ]);

    res.render('SetEvent', {
      title: '이벤트 등록',
      activeEvents,
      doneEvents
    });
  } catch (err) {
    console.error('이벤트 목록 로딩 오류:', err);
    res.status(500).send('서버 오류');
  }
});

app.post('/set-event', 로그인필요, isAdmin, eventUpload.single('Eventimage'), async (req, res) => {
  try {
    // 1. 기존 진행중인 이벤트가 있다면 완료 처리
    await db.collection('events').updateMany(
      { status: 'active' },
      { $set: { status: 'done', completedAt: new Date() } }
    );

    // 2. 새 이벤트 등록
    const {
      title, item, quantity, type,
      description, startDate, endDate
    } = req.body;

    const imagePath = req.file ? '/uploads/events/' + req.file.filename : null;
    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);

    const newEvent = {
      title,
      item,
      quantity: parseInt(quantity),
      type,
      description,
      imagePath,
      status: 'active', // 진행중 이벤트로 등록
      createdAt: nowKST,
      createdBy: req.session.user.username
    };

    if (type === '기간 한정') {
      newEvent.startDate = new Date(startDate);
      newEvent.endDate = new Date(endDate);
    }

    await db.collection('events').insertOne(newEvent);
    res.redirect('/SetEvent');

  } catch (err) {
    console.error('이벤트 등록 오류:', err);
    res.status(500).send('서버 오류 발생');
  }
});

// 이벤트 수령 처리 및 클레임 기록 저장
app.post('/claim-event', 로그인필요, async (req, res) => {
  try {
    // 1. 로그인된 유저 정보와 현재 시각
    const userId    = req.session.user.username;
    const claimedAt = new Date();

    // 2. 진행중인 이벤트 조회
    const eventsCol = db.collection('events');
    const event     = await eventsCol.findOne({ status: 'active' });

    if (!event || event.quantity <= 0) {
      return res.json({ success: false, message: '이벤트 종료 또는 수량 없음' });
    }

    // 3. 이벤트 수량 차감
    const newQuantity = event.quantity - 1;
    await eventsCol.updateOne(
      { _id: event._id },
      { $set: { quantity: newQuantity } }
    );

    // 4. 클레임 기록 저장
    await db.collection('claims').insertOne({
      eventId:   event._id,
      userId,                // 세션에서 읽은 사용자 아이디
      claimedAt              // 현재 시각
    });

    // 5. 결과 반환
    res.json({ success: true, newQuantity });
  } catch (err) {
    console.error('이벤트 수령 처리 오류:', err);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});
