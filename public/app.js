const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const MOOD_EMOJI = { anxious: "😰", irritated: "😤", happy: "😄", tired: "😮‍💨", emo: "🥺", calm: "😐" };
const MOOD_PRESETS = {
  anxious: ["Too many deadlines", "Need a breather"], irritated: ["Things didn't go as planned", "Need some space"],
  happy: ["Feeling grateful", "Good vibes"], tired: ["Energy drained", "Ready for bed"],
  emo: ["Nostalgic", "Just need a hug"], calm: ["Enjoying the quiet", "Everything is okay"]
};

// 🌟 情绪分数映射 (Y轴坐标)
const MOOD_VALUES = { happy: 5, calm: 4, tired: 3, emo: 2, anxious: 1, irritated: 0 };
const MOOD_NAMES = { 5: 'Peak', 4: 'Good', 3: 'Neutral', 2: 'Low', 1: 'Stressed', 0: 'Bottom' };

let pickedMood = ""; let pickedImgDataUrl = "";
let allUserNotes = []; let currentDateForCal = new Date(); let currentFilterDate = "";
let globalCommunitySuggestions = [];
let globalMoments = [];
let currentDanmakuPage = 0;
const suggestionsPerPage = 5;

// 🌟 预先生成 Emoji 的 Canvas 图片供图表节点使用
const EMOJI_IMAGES = {};
function initEmojiImages() {
  Object.keys(MOOD_EMOJI).forEach(mood => {
     const canvas = document.createElement('canvas');
     canvas.width = 36; canvas.height = 36;
     const ctx = canvas.getContext('2d');
     ctx.font = '26px system-ui';
     ctx.textAlign = 'center';
     ctx.textBaseline = 'middle';
     ctx.fillText(MOOD_EMOJI[mood], 18, 20); // 微调偏移使其居中
     const img = new Image();
     img.src = canvas.toDataURL();
     EMOJI_IMAGES[mood] = img;
  });
}

const DANMAKU_POSITIONS = [
  { top: '4%', left: '4%', right: 'auto' },
  { top: '20%', left: 'auto', right: '4%' },
  { top: '38%', left: '8%', right: 'auto' },
  { top: '55%', left: 'auto', right: '8%' },
  { top: '68%', left: '5%', right: 'auto' }
];

window.onload = () => {
  const splash = $('#splashScreen');
  if(splash) splash.addEventListener('click', () => splash.classList.add('hide'));
  updateClock();
  initEmojiImages(); // 初始化 Emoji 节点

// 🌟 新增：手机端下拉菜单切换逻辑
  const mobileMenuBtn = $('#mobileMenuBtn');
  const topNav = $('#topNav');
  if(mobileMenuBtn && topNav) {
    mobileMenuBtn.addEventListener('click', () => {
      topNav.classList.toggle('open');
    });
  }

  const today = new Date();
  currentFilterDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dateFilter = $('#historyDateFilter');
  if(dateFilter) {
    dateFilter.value = currentFilterDate;
    dateFilter.addEventListener('change', (e) => { currentFilterDate = e.target.value; renderFilteredCheckins(); });
  }

// 🌟 修改：点击导航标签后，在手机端自动收起下拉菜单
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-btn').forEach(b => b.classList.remove('active'));
      $$('.view-section').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');

      const targetId = btn.dataset.target;
      $(`#${targetId}`).classList.add('active');

      // 🌟 新增：点完标签后自动关掉下拉菜单
      if(topNav.classList.contains('open')) {
        topNav.classList.remove('open');
      }

      if(targetId === 'view-history') renderCalendar();
      if(targetId === 'view-community') { fetchCommunityFeed(); fetchMoments(); }
    });
  });

  $$('.comm-tab-btn').forEach((btn, index) => {
    btn.addEventListener('click', () => {
      $$('.comm-tab-btn').forEach(b => b.classList.remove('active'));
      $$('.comm-tab-content').forEach(c => { c.classList.remove('active'); });
      btn.classList.add('active');
      $('#commTabSlider').style.transform = `translateX(${index * 100}%)`;
      $('#commContentTrack').style.transform = `translateX(-${index * 50}%)`;
      const targetId = btn.dataset.tab;
      $(`#${targetId}`).classList.add('active');
    });
  });

  checkLoginState(); fetchCheckins();
};

function updateClock() {
  const now = new Date();
  $('#liveDateTime').textContent = now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
  const hour = now.getHours();
  $('#greetingText').textContent = (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening") + ".";
}

function processImageInput(inputEl, displayEl, previewEl, callback) {
  inputEl.onchange = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    if (!/^image\/(?:png|jpeg|gif|webp)$/i.test(file.type)) {
      alert("Please choose a PNG, JPEG, GIF, or WebP image.");
      inputEl.value = "";
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      alert("Please choose an image smaller than 3 MB.");
      inputEl.value = "";
      return;
    }
    if(displayEl) displayEl.textContent = file.name;
    const reader = new FileReader();
    reader.onload = (event) => {
      const b64 = event.target.result;
      if(previewEl) {
        const image = document.createElement('img');
        image.src = b64;
        image.alt = "Preview";
        previewEl.replaceChildren(image);
      }
      if(callback) callback(b64);
    };
    reader.readAsDataURL(file);
  };
}

$('#customFileBtn').onclick = () => $('#checkinImg').click();
processImageInput($('#checkinImg'), $('#fileNameDisplay'), $('#imgPreviewBox'), (b64) => pickedImgDataUrl = b64);

let postImgDataUrl = "";
$('#postImgBtn').onclick = () => $('#postImgInput').click();
processImageInput($('#postImgInput'), $('#postFileName'), null, (b64) => postImgDataUrl = b64);

// ================= 打卡与记录 =================
window.goToStep = (step) => {
  $$('.wizard-step').forEach(el => el.classList.remove('active'));
  $(`#step${step}`).classList.add('active');
};
window.resetWizard = () => {
  pickedMood = ""; pickedImgDataUrl = ""; $('#checkinText').value = ""; $('#textCounter').textContent = "0/100";
  $('#imgPreviewBox').innerHTML = `<div class="muted">No image selected</div>`;
  $$('.mood').forEach(b => b.classList.remove("active")); goToStep(1);
};

$$('.mood').forEach(btn => {
  btn.addEventListener("click", () => {
    $$('.mood').forEach(b => b.classList.remove("active")); btn.classList.add("active");
    pickedMood = btn.dataset.mood;
    const chipsBox = $('#presetChips'); chipsBox.innerHTML = "";
    MOOD_PRESETS[pickedMood].forEach(text => {
      const chip = document.createElement("div"); chip.className = "preset-chip"; chip.textContent = text;
      chip.onclick = () => { $('#checkinText').value = text; $('#textCounter').textContent = `${text.length}/100`; $$('.preset-chip').forEach(c => c.classList.remove('selected')); chip.classList.add('selected'); };
      chipsBox.appendChild(chip);
    });
    goToStep(2);
  });
});
$('#checkinText').addEventListener("input", (e) => { $('#textCounter').textContent = `${e.target.value.length}/100`; });

// ================= 🌟 情绪波浪图表引擎 🌟 =================
function initChart() {
  const ctx = document.getElementById('moodChart').getContext('2d');
  let gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(245, 163, 163, 0.6)'); // 顶部微粉
  gradient.addColorStop(1, 'rgba(245, 163, 163, 0.0)'); // 底部透明

  window.moodChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{
        label: 'Mood Level', data: [],
        borderColor: '#f5a3a3', backgroundColor: gradient,
        borderWidth: 3, fill: true, tension: 0.4, // tension 创造波浪感
        pointRadius: 16, pointHoverRadius: 20
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 20, bottom: 10, left: 10, right: 20 } },
      scales: {
        y: {
          min: -0.5, max: 5.5,
          ticks: { stepSize: 1, callback: (val) => MOOD_NAMES[val] || '', font: { size: 10, color: '#948c86' } },
          grid: { color: 'rgba(220, 200, 185, 0.3)' }, border: { display: false }
        },
        x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 11, color: '#948c86' } } }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.9)', titleColor: '#2e2a27', bodyColor: '#a14b4b',
          borderColor: '#ffcece', borderWidth: 1, padding: 10, displayColors: false,
          callbacks: { label: (ctx) => {
            const rev = {5:'Happy 😄', 4:'Calm 😐', 3:'Tired 😮‍💨', 2:'Emo 🥺', 1:'Anxious 😰', 0:'Irritated 😤'};
            return ` ${rev[ctx.raw]}`;
          }}
        }
      }
    }
  });
}

function updateChart() {
  if (typeof Chart === 'undefined') return;
  if (!window.moodChartInstance) initChart();

  const year = currentDateForCal.getFullYear();
  const month = currentDateForCal.getMonth();
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // 取出当前月的所有记录，并按时间先后严格排序
  const monthNotes = allUserNotes.filter(n => {
    const d = new Date(n.createdAt);
    return d.getFullYear() === year && d.getMonth() === month;
  }).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));

  const labels = [];
  const dataPoints = [];
  const pointStyles = [];

  // 🌟 核心修改：不再按天去重，而是遍历当月的每一次打卡
  monthNotes.forEach(note => {
    const d = new Date(note.createdAt);
    const day = d.getDate();
    // 提取具体时间 (例如 09:30 AM)
    const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // 横坐标标签显示为：Mar 25, 09:30 AM
    labels.push(`${monthNames[month]} ${day}, ${timeStr}`);
    dataPoints.push(MOOD_VALUES[note.mood]);
    pointStyles.push(EMOJI_IMAGES[note.mood] || 'circle'); // 注入 Emoji
  });

  window.moodChartInstance.data.labels = labels;
  window.moodChartInstance.data.datasets[0].data = dataPoints;
  window.moodChartInstance.data.datasets[0].pointStyle = pointStyles;
  window.moodChartInstance.update();
}


function renderCalendar() {
  const year = currentDateForCal.getFullYear(); const month = currentDateForCal.getMonth();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  $('#calendarMonthYear').textContent = `${monthNames[month]} ${year}`;
  const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid = $('#calendarGrid'); grid.innerHTML = '';
  for(let i = 0; i < firstDay; i++) grid.innerHTML += `<div class="cal-day empty"></div>`;
  const today = new Date();
  for(let day = 1; day <= daysInMonth; day++) {
    const dayNotes = allUserNotes.filter(n => {
      const nDate = new Date(n.createdAt); return nDate.getFullYear() === year && nDate.getMonth() === month && nDate.getDate() === day;
    });
    let classes = "cal-day";
    if (year === today.getFullYear() && month === today.getMonth() && day === today.getDate()) classes += " today";
    let moodHtml = "";
    if (dayNotes.length > 0) { classes += " has-record"; moodHtml = `<div class="cal-mood" title="${escapeHTML(dayNotes[0].text || 'Recorded')}">${MOOD_EMOJI[dayNotes[0].mood] || '📝'}</div>`; }
    grid.innerHTML += `<div class="${classes}"><span>${day}</span>${moodHtml}</div>`;
  }

  updateChart(); // 🌟 同步更新图表数据
}

$('#prevMonthBtn').onclick = () => { currentDateForCal.setMonth(currentDateForCal.getMonth() - 1); renderCalendar(); };
$('#nextMonthBtn').onclick = () => { currentDateForCal.setMonth(currentDateForCal.getMonth() + 1); renderCalendar(); };

async function fetchCheckins() {
  const token = localStorage.getItem('oasis_token'); const box = $('#recentCheckins');
  if (!token) { box.innerHTML = `<div class="muted" style="text-align:center; padding: 20px;">Please login to see your records.</div>`; allUserNotes = []; renderCalendar(); return; }
  try {
    const res = await fetch('/api/notes', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (data.error === "Token expired or invalid") return logout();
    allUserNotes = data.notes || []; renderCalendar(); renderFilteredCheckins();
  } catch (e) { }
}

function renderFilteredCheckins() {
  const box = $('#recentCheckins'); const currentUsername = localStorage.getItem('oasis_username') || 'User';
  if(!allUserNotes.length) { box.innerHTML = `<p class="muted" style="text-align:center; padding: 20px;">No records yet.</p>`; return; }
  let filteredNotes = allUserNotes;
  if (currentFilterDate) {
    filteredNotes = allUserNotes.filter(note => {
      const noteDate = new Date(note.createdAt);
      return `${noteDate.getFullYear()}-${String(noteDate.getMonth() + 1).padStart(2, '0')}-${String(noteDate.getDate()).padStart(2, '0')}` === currentFilterDate;
    });
  }
  if(!filteredNotes.length) { box.innerHTML = `<p class="muted" style="text-align:center; padding: 20px;">No check-ins on this date.</p>`; return; }
  box.innerHTML = filteredNotes.map(note => {
    const imageSrc = safeImageSrc(note.img);
    return `
      <div class="item">
        <div class="item-head">
          <span>${MOOD_EMOJI[note.mood] || '📝'} <span style="text-transform: capitalize;">${escapeHTML(note.mood || 'Recorded')}</span> <span class="muted" style="font-size: 13px; margin-left: 8px; font-weight: normal;">by @${escapeHTML(currentUsername)}</span></span>
          <span class="item-time">${new Date(note.createdAt).toLocaleString()}</span>
        </div>
        <div class="item-body">
          <p>${escapeHTML(note.text)}</p>
          ${imageSrc ? `<img src="${imageSrc}" alt="Check-in attachment" style="max-width:200px; border-radius:10px; margin-top:10px;">` : ''}
          <button class="btn danger mt" style="padding:4px 10px;font-size:12px;" onclick="deleteNote('${note.id}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

$('#saveCheckinBtn').onclick = async () => {
  const token = localStorage.getItem('oasis_token');
  if (!token) return alert("Please login to save your mood!"); if (!pickedMood) return alert("Pick a mood first!");
  const payload = { mood: pickedMood, text: $('#checkinText').value.trim() || "Recorded a moment.", img: pickedImgDataUrl };
  const btn = $('#saveCheckinBtn'); btn.textContent = "Saving..."; btn.disabled = true;
  try {
    const res = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
    if(!res.ok) throw new Error("Server rejected request");
    fetchCheckins(); goToStep(4); setTimeout(() => showSuggestions(pickedMood), 1000);
  } catch (e) { alert("Failed to save."); } finally { btn.textContent = "Save Check-in ✨"; btn.disabled = false; }
};

window.deleteNote = async (id) => {
  if(!confirm("Delete?")) return;
  const token = localStorage.getItem('oasis_token');
  await fetch(`/api/notes/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); fetchCheckins();
};

function escapeHTML(str) { return String(str ?? '').replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m])); }
function safeImageSrc(value) {
  if (typeof value !== 'string' || value.length > 4_000_000) return '';
  return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value) ? value : '';
}

// ================= 身份验证 =================
let isLoginMode = true;
window.showAuthModal = () => { $('#authModal').style.display = 'flex'; }; window.closeAuthModal = () => { $('#authModal').style.display = 'none'; };
$('#toggleAuthModeBtn').onclick = () => {
  isLoginMode = !isLoginMode; $('#authTitle').textContent = isLoginMode ? 'Login to Oasis' : 'Create an Account';
  $('#submitAuthBtn').textContent = isLoginMode ? 'Login' : 'Register'; $('#toggleAuthModeBtn').textContent = isLoginMode ? 'Switch to Register' : 'Switch to Login';
};
$('#submitAuthBtn').onclick = async () => {
  const username = $('#authUsername').value.trim(); const password = $('#authPassword').value;
  if (!username || !password) return alert("Please enter username and password");
  const endpoint = isLoginMode ? '/api/login' : '/api/register';
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (data.ok) {
      if (!isLoginMode) { alert("Registration successful! Please login."); $('#toggleAuthModeBtn').click(); }
      else { localStorage.setItem('oasis_token', data.token); localStorage.setItem('oasis_username', data.username); closeAuthModal(); checkLoginState(); fetchCheckins(); fetchCommunityFeed(); fetchMoments(); }
    } else { alert("Error: " + data.error); }
  } catch (e) { alert("Network error"); }
};
function checkLoginState() {
  const token = localStorage.getItem('oasis_token'); const username = localStorage.getItem('oasis_username'); const userArea = $('#userAuthArea');
  userArea.replaceChildren();
  if (token && username) {
    const greeting = document.createElement('span');
    greeting.style.cssText = 'margin-right:15px; font-weight:bold; color:var(--primary);';
    greeting.textContent = `👋 Hi, ${username}`;
    const logoutButton = document.createElement('button');
    logoutButton.className = 'btn ghost';
    logoutButton.textContent = 'Logout';
    logoutButton.addEventListener('click', logout);
    userArea.append(greeting, logoutButton);
  } else {
    const loginButton = document.createElement('button');
    loginButton.className = 'btn primary';
    loginButton.textContent = 'Login / Register';
    loginButton.addEventListener('click', showAuthModal);
    userArea.appendChild(loginButton);
  }
}
window.logout = () => {
  localStorage.removeItem('oasis_token'); localStorage.removeItem('oasis_username'); checkLoginState();
  $('#recentCheckins').innerHTML = `<div class="muted" style="text-align:center; padding: 20px;">Please login to see your records.</div>`;
  allUserNotes = []; globalCommunitySuggestions = []; globalMoments = []; currentDanmakuPage = 0;
  $('#danmakuStage').innerHTML = `<div class="muted" style="text-align:center; font-size:12px; padding-top: 50px;">Login to load community wisdom.</div>`;
  $('#momentsFeed').innerHTML = `<div class="muted" style="text-align:center; font-size:12px;">Please login to see moments.</div>`;
  renderCalendar();
};

const SUGGESTIONS = {
  anxious: [{title: "4-7-8 Breathing", desc: "Inhale 4s, hold 7s, exhale 8s."}], tired: [{title: "Power Nap", desc: "Close your eyes for 15 minutes."}],
  emo: [{title: "Self-Hug", desc: "It's okay to feel down."}], irritated: [{title: "Cool Down", desc: "Drink a glass of cold water."}],
  happy: [{title: "Share it!", desc: "Tell a friend why you are happy."}], calm: [{title: "Stay Present", desc: "Enjoy this peaceful moment."}]
};
window.closeModal = () => $('#suggestionModal').style.display = 'none';

// ================= 🌟 弹幕智慧库与社区自审核 🌟 =================

async function fetchCommunityFeed(keepPage = false) {
  const token = localStorage.getItem('oasis_token');
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
  try {
    const res = await fetch('/api/suggestions', { headers });
    const data = await res.json();
    if (data.ok) { globalCommunitySuggestions = data.suggestions; if (!keepPage) currentDanmakuPage = 0; renderDanmakuPage(); }
  } catch (e) { console.log("Failed to load Wisdom Library."); }
}

function generateDanmakuHTML(sug) {
  return `
    <div class="comm-title" style="font-size:12px; font-weight:700; color:#a14b4b; margin-bottom: 2px;">
      ${MOOD_EMOJI[sug.mood] || '📝'} ${escapeHTML(sug.title)}
    </div>
    <div class="muted" style="font-size:11px; color:#5c5450;">
      ${escapeHTML(sug.desc)}
    </div>
    <div class="danmaku-actions">
      <button class="danmaku-btn ${sug.hasLiked ? 'active' : ''}" onclick="voteSuggestion(event, '${sug.id}', 'like')">
        ${sug.hasLiked ? '👍' : '🤍'} <span class="count">${sug.likeCount || 0}</span>
      </button>
      <button class="danmaku-btn ${sug.hasDisliked ? 'active' : ''}" onclick="voteSuggestion(event, '${sug.id}', 'dislike')">
        ${sug.hasDisliked ? '👎' : '🖤'} <span class="count">${sug.dislikeCount || 0}</span>
      </button>
    </div>
  `;
}

function renderDanmakuPage() {
  const stage = $('#danmakuStage');
  const pagerPrev = $('#danmakuPrev');
  const pagerNext = $('#danmakuNext');

  if(currentDanmakuPage === 0) {
    $('#commTabSlider').style.transform = 'translateX(0%)';
    $('#commContentTrack').style.transform = 'translateX(0%)';
  }

  const totalSug = globalCommunitySuggestions.length;
  const totalPages = Math.ceil(totalSug / suggestionsPerPage);
  pagerPrev.disabled = (currentDanmakuPage === 0 || totalPages === 0);
  pagerNext.disabled = (currentDanmakuPage === totalPages - 1 || totalPages === 0);

  if (totalSug === 0) {
    stage.innerHTML = `<div class="muted" style="text-align:center; font-size:12px; padding-top: 50px;">Be the first to share your wisdom!</div>`;
    return;
  }

  const startIndex = currentDanmakuPage * suggestionsPerPage;
  const batch = globalCommunitySuggestions.slice(startIndex, startIndex + suggestionsPerPage);
  stage.innerHTML = '';

  batch.forEach((sug, index) => {
    const item = document.createElement('div');
    item.className = 'danmaku-item';
    item.id = `danmaku_${sug.id}`;
    item.title = `by @${sug.username || 'Unknown'}`;
    item.innerHTML = generateDanmakuHTML(sug);

    const pos = DANMAKU_POSITIONS[index];
    const randomRotation = (Math.random() * 6) - 3;
    item.style.top = pos.top;
    if (pos.left !== 'auto') item.style.left = pos.left;
    if (pos.right !== 'auto') item.style.right = pos.right;

    item.style.setProperty('--target-transform', `rotate(${randomRotation}deg)`);
    item.style.transform = `rotate(${randomRotation}deg)`;
    stage.appendChild(item);
  });
}

async function loadNextDanmakuPage(direction) {
  const stage = $('#danmakuStage');
  const currentItems = $$('#danmakuStage .danmaku-item');

  if(currentItems.length > 0) {
    currentItems.forEach(item => {
      const targetTransform = item.style.getPropertyValue('--target-transform');
      let moveX = direction === 'next' ? '-150vw' : '150vw';
      item.style.transform = `translateX(${moveX}) ${targetTransform} scale(0.8)`;
      item.classList.add('float-away');
    });
    await new Promise(r => setTimeout(r, 600));
  }

  if (direction === 'next') currentDanmakuPage++; else currentDanmakuPage--;

  const startIndex = currentDanmakuPage * suggestionsPerPage;
  const batch = globalCommunitySuggestions.slice(startIndex, startIndex + suggestionsPerPage);

  stage.innerHTML = '';

  batch.forEach((sug, index) => {
    const item = document.createElement('div');
    item.className = 'danmaku-item';
    item.id = `danmaku_${sug.id}`;
    item.title = `by @${sug.username || 'Unknown'}`;
    item.innerHTML = generateDanmakuHTML(sug);

    const pos = DANMAKU_POSITIONS[index];
    const randomRotation = (Math.random() * 6) - 3;

    item.style.top = pos.top;
    if (pos.left !== 'auto') item.style.left = pos.left;
    if (pos.right !== 'auto') item.style.right = pos.right;

    let fromX = direction === 'next' ? '150vw' : '-150vw';
    item.style.setProperty('--target-transform', `rotate(${randomRotation}deg)`);
    item.style.setProperty('--slide-from', `translateX(${fromX}) rotate(${randomRotation}deg) scale(1.1)`);

    stage.appendChild(item);
    setTimeout(() => { item.classList.add('float-in'); }, 10);
  });

  const totalSug = globalCommunitySuggestions.length;
  const totalPages = Math.ceil(totalSug / suggestionsPerPage);
  $('#danmakuPrev').disabled = (currentDanmakuPage === 0 || totalPages === 0);
  $('#danmakuNext').disabled = (currentDanmakuPage === totalPages - 1 || totalPages === 0);
}

$('#danmakuPrev').onclick = () => loadNextDanmakuPage('prev');
$('#danmakuNext').onclick = () => loadNextDanmakuPage('next');

window.voteSuggestion = async (e, id, action) => {
  e.stopPropagation();
  const token = localStorage.getItem('oasis_token');
  if (!token) return alert("Please login to vote!");

  const sug = globalCommunitySuggestions.find(s => s.id === id);
  if (!sug) return;

  if (action === 'like') {
    if (sug.hasLiked) { sug.hasLiked = false; sug.likeCount--; }
    else { sug.hasLiked = true; sug.likeCount++; if(sug.hasDisliked) { sug.hasDisliked = false; sug.dislikeCount--; } }
  } else {
    if (sug.hasDisliked) { sug.hasDisliked = false; sug.dislikeCount--; }
    else { sug.hasDisliked = true; sug.dislikeCount++; if(sug.hasLiked) { sug.hasLiked = false; sug.likeCount--; } }
  }

  const node = $(`#danmaku_${sug.id}`);
  if (node) { node.innerHTML = generateDanmakuHTML(sug); }

  try {
    await fetch(`/api/suggestions/${id}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ action }) });
    fetchCommunityFeed(true);
  } catch (err) {}
};

window.showSuggestions = (mood) => {
  $('#suggestionMoodLabel').textContent = `For your ${mood}`;
  const sysList = SUGGESTIONS[mood] || SUGGESTIONS['calm'];
  let html = sysList.map(s => `<div class="suggestion-card"><h4>🌱 ${s.title}</h4><p class="muted">${s.desc}</p></div>`).join('');

  const commList = globalCommunitySuggestions.filter(s => s.mood === mood && (s.likeCount || 0) >= 3 && (s.dislikeCount || 0) < 5);

  if (commList.length > 0) {
    html += `<div style="text-align:center; margin: 15px 0 5px; font-size: 12px; color: var(--primary); font-weight: bold;">--- From the Community ---</div>`;
    html += commList.map(s => `<div class="suggestion-card" style="background: rgba(255,206,206,0.15); border-color: rgba(245,163,163,0.5);"><h4>${MOOD_EMOJI[s.mood]} ${escapeHTML(s.title)} <span class="badge-community">@${escapeHTML(s.username)}</span></h4><p class="muted">${escapeHTML(s.desc)}</p></div>`).join('');
  }
  $('#suggestionList').innerHTML = html; $('#suggestionModal').style.display = 'flex';
};

window.showAddSuggestionModal = () => { $('#addSuggestionModal').style.display = 'flex'; };
window.closeAddSuggestionModal = () => { $('#addSuggestionModal').style.display = 'none'; };

$('#addSuggestionFab').onclick = () => {
  const token = localStorage.getItem('oasis_token');
  if (!token) return alert("Please login to share your wisdom with the community!");
  showAddSuggestionModal();
};

$('#submitCommBtn').onclick = async () => {
  const token = localStorage.getItem('oasis_token');
  if (!token) return alert("Please login!");

  const mood = $('#commMood').value; const title = $('#commTitle').value.trim(); const desc = $('#commDesc').value.trim();
  if (!mood || !title || !desc) return alert("Please fill in all fields.");
  const btn = $('#submitCommBtn'); btn.textContent = "Sharing..."; btn.disabled = true;

  try {
    const res = await fetch('/api/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ mood, title, desc }) });
    if (res.ok) { $('#commMood').value = ""; $('#commTitle').value = ""; $('#commDesc').value = ""; alert("Shared!"); closeAddSuggestionModal(); fetchCommunityFeed(); } else { alert("Failed to share."); }
  } catch (e) { alert("Error."); } finally { btn.textContent = "Share to Library 💡"; btn.disabled = false; }
};

// ================= 🌟 朋友圈 (Moments) 🌟 =================

window.showPostModal = () => { $('#postModal').style.display = 'flex'; };
window.closePostModal = () => { $('#postModal').style.display = 'none'; };

$('#importCheckinBtn').onclick = () => {
  if (!allUserNotes || allUserNotes.length === 0) return alert("You haven't checked in yet! Go to Home tab first.");
  const todayStr = new Date().toDateString();
  const todaysNote = allUserNotes.find(n => new Date(n.createdAt).toDateString() === todayStr);
  if (!todaysNote) return alert("No check-in found for today.");

  $('#postTitle').value = `My Daily Check-in`;
  $('#postMood').value = todaysNote.mood;
  $('#postDesc').value = todaysNote.text !== "(no text)" ? todaysNote.text : "";
  postImgDataUrl = todaysNote.img || "";
  $('#postFileName').textContent = postImgDataUrl ? "Image imported" : "";
  alert("Today's check-in imported successfully!");
};

$('#submitPostBtn').onclick = async () => {
  const token = localStorage.getItem('oasis_token');
  if (!token) return alert("Please login to post!");
  const title = $('#postTitle').value.trim(); const mood = $('#postMood').value; const text = $('#postDesc').value.trim();
  const isAnonymous = $('#postAnon').checked;
  if (!title || !mood || !text) return alert("Title, Mood, and Text are required.");

  const btn = $('#submitPostBtn'); btn.textContent = "Posting..."; btn.disabled = true;
  try {
    const res = await fetch('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ title, mood, text, img: postImgDataUrl, isAnonymous }) });
    if (res.ok) { $('#postTitle').value = ""; $('#postMood').value = ""; $('#postDesc').value = ""; $('#postFileName').textContent = ""; postImgDataUrl = ""; $('#postAnon').checked = false; closePostModal(); fetchMoments(); } else { alert("Failed to post."); }
  } catch (e) { alert("Network error."); } finally { btn.textContent = "Post Moment 🚀"; btn.disabled = false; }
};

async function fetchMoments() {
  const token = localStorage.getItem('oasis_token');
  if (!token) {
    globalMoments = [];
    renderMoments();
    return;
  }
  try {
    const res = await fetch('/api/posts', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (data.ok) { globalMoments = data.posts; renderMoments(); }
  } catch (e) { console.log("Failed to load moments."); }
}

function renderMoments() {
  const feed = $('#momentsFeed');
  if (!globalMoments.length) { feed.innerHTML = `<div class="muted" style="text-align:center; font-size:12px;">No moments yet. Be the first!</div>`; return; }

  feed.innerHTML = globalMoments.map(post => {
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const commentsHtml = comments.map(c => `<div class="comment-box"><span style="font-weight:bold; color:var(--primary);">${escapeHTML(c.username)}:</span> <span>${escapeHTML(c.text)}</span></div>`).join('');
    const imageSrc = safeImageSrc(post.img);

    return `
      <div class="comm-item">
        <div class="comm-item-head">
          <span class="comm-title">${MOOD_EMOJI[post.mood] || '📝'} ${escapeHTML(post.title)}</span>
          <span class="comm-author" style="${post.username === 'Anonymous' ? 'background:#e5e7eb; color:#6b7280;' : ''}">@${escapeHTML(post.username)}</span>
        </div>
        <p class="comm-desc">${escapeHTML(post.text)}</p>
        ${imageSrc ? `<img src="${imageSrc}" class="comm-img" alt="Moment attachment">` : ''}
        <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">${new Date(post.createdAt).toLocaleString()}</div>

        <div class="post-actions" style="justify-content: flex-start;">
          <button class="action-btn" onclick="likePost('${post.id}')" style="color: ${post.hasLiked ? 'var(--primary)' : 'var(--muted)'};">
            ${post.hasLiked ? '❤️' : '🤍'} Like (${post.likeCount})
          </button>

          ${post.isMine ? `<button class="action-btn" onclick="deletePost('${post.id}')" style="color: #ef4444; margin-left: auto;">🗑️ Delete</button>` : ''}
        </div>

        <div class="comments-section">
          ${commentsHtml}
          <div class="comment-input-wrapper">
            <input type="text" id="cmtInput_${post.id}" class="comment-input" placeholder="Write a comment...">
            <button class="comment-btn" onclick="submitComment('${post.id}')">Send</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.likePost = async (id) => {
  const token = localStorage.getItem('oasis_token'); if (!token) return alert("Login to like!");
  try {
    const res = await fetch(`/api/posts/${id}/like`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) fetchMoments();
  } catch (e) {}
};

window.submitComment = async (id) => {
  const token = localStorage.getItem('oasis_token'); if (!token) return alert("Login to comment!");
  const inputEl = $(`#cmtInput_${id}`);
  const text = inputEl.value.trim();
  if (!text) return;
  try {
    const res = await fetch(`/api/posts/${id}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ text }) });
    if (res.ok) fetchMoments();
  } catch (e) {}
};

window.deletePost = async (id) => {
  if(!confirm("Are you sure you want to delete this moment?")) return;
  const token = localStorage.getItem('oasis_token');
  try {
    const res = await fetch(`/api/posts/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) { fetchMoments(); } else { alert("Failed to delete. You can only delete your own posts."); }
  } catch (e) { alert("Network error"); }
};
