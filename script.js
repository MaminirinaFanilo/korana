// ════════════════════════════════════════════
//  KORANA — script.js  v4.0
//  Comptes persistants Firebase Auth + RTDB
//  - Inscription / Connexion (nom unique + mdp)
//  - Tous les utilisateurs visibles (actif/inactif)
//  - Historique illimité
//  - Messages envoyables même hors ligne
// ════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAC_YqmbtYy3cM_AMbX1ngfm_JzBxddGLo",
  authDomain:        "talky-81369.firebaseapp.com",
  databaseURL:       "https://talky-81369-default-rtdb.firebaseio.com",
  projectId:         "talky-81369",
  storageBucket:     "talky-81369.firebasestorage.app",
  messagingSenderId: "307701619599",
  appId:             "1:307701619599:web:2b44fbc45b63776e0a89fa"
};

const AVATARS   = ['🦊','🐺','🐸','🦋','🐙','🦄','🐯','🦁','🐧','🦅','🦜','🐬','🦈','🐲','🦚','🐻','🦝','🦩'];
const EMOJIS    = ['😂','❤️','🔥','👍','🎉','😎','🤔','😢','😡','🤣','✨','💯','🙌','👀','💀','🫶','⚡','🌙','🎮','🍕','🌈','🚀'];
const REACTIONS = ['👍','❤️','😂','😮','😢','🔥'];
const COLORS    = ['#2563eb','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2'];

const STATUS_DOT_COLOR = {
  online:   '#22c55e',
  busy:     '#2563eb',
  dnd:      '#ef4444',
  away:     '#9ca3af',
  vacation: '#f59e0b',
  meeting:  '#8b5cf6',
};
const STATUS_TEXT_COLOR = {
  online:   '#22c55e',
  busy:     '#2563eb',
  dnd:      '#ef4444',
  away:     '#9ca3af',
  vacation: '#f59e0b',
  meeting:  '#8b5cf6',
};

const STATUSES = [
  { icon: '🟢', label: 'En ligne',        value: 'online'   },
  { icon: '🟡', label: 'Occupé',           value: 'busy'     },
  { icon: '🔴', label: 'Ne pas déranger',  value: 'dnd'      },
  { icon: '⚫', label: 'Absent',           value: 'away'     },
  { icon: '🏖️', label: 'En vacances',     value: 'vacation' },
  { icon: '💼', label: 'En réunion',       value: 'meeting'  },
];

const ROOMS = {
  general: { label: 'général',     desc: 'Canal de discussion principal',  emoji: '💬', color: '#2563eb' },
  random:  { label: 'aléatoire',   desc: 'Discussion libre et détendue',   emoji: '🎲', color: '#f59e0b' },
  tech:    { label: 'technologie', desc: 'Code, gadgets et tendances tech', emoji: '💻', color: '#22c55e' },
};

let db          = null;
let auth        = null;
let me          = null;
let currentRoom = 'general';
let allUsers    = {};
let dmLastMsg   = {};
let unread      = {};
let replyTo     = null;
let msgListeners  = {};
let typingRef     = null;
let typingTimeout = null;
let presenceRef   = null;
let seenRef       = null;
let soundEnabled  = true;

function playNotifSound() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freqs = [880, 1100];
    freqs.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.18);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.2);
    });
  } catch (e) { /* AudioContext non disponible */ }
}

// ── Envoie une notification native via le Service Worker ──
function sendPushNotification(msg, roomKey) {
  if (!navigator.serviceWorker?.controller) return;
  // Ne pas notifier ses propres messages
  if (msg.senderId === me?.uid) return;
  // Ne pas notifier si la page est visible et focalisée sur la bonne room
  if (!document.hidden && currentRoom === roomKey) return;

  const isDM   = roomKey.startsWith('dm:');
  const roomInfo = isDM
    ? { label: (allUsers[getDMOtherUidFromKey(roomKey, me?.uid)]?.name || 'Message privé') }
    : (ROOMS[roomKey] || { label: roomKey });

  navigator.serviceWorker.controller.postMessage({
    type:        'NEW_MESSAGE',
    senderName:  msg.senderName  || '?',
    senderAvatar:msg.senderAvatar|| '💬',
    text:        msg.text        || '',
    roomLabel:   roomInfo.label,
    isImage:     msg.type === 'image',
  });
}

// Helper : extraire l'uid de l'autre personne depuis une clé DM et un uid connu
function getDMOtherUidFromKey(dmKey, myUid) {
  return dmKey.replace('dm:', '').split('_').find(p => p !== myUid) || '';
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db   = firebase.database();
    auth = firebase.auth();
    console.log('✅ Firebase connecté');
  } catch (e) {
    console.error('❌ Firebase erreur:', e);
    showAuthError('Erreur de connexion au serveur. Vérifiez votre connexion.');
  }

  // ── Enregistrement Service Worker + permission notifications ──
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('[KORANA] SW enregistré', reg.scope);
        // Demander la permission notifications si pas encore accordée
        if (Notification.permission === 'default') {
          Notification.requestPermission();
        }
      })
      .catch(err => console.warn('[KORANA] SW erreur:', err));
  }

  renderAvatarPicker();
  renderEmojiPanel();
  bindAuthEvents();

  auth.onAuthStateChanged(user => {
    if (user) {
      loadUserProfile(user.uid);
    } else {
      showScreen('screen-auth');
    }
  });
});

function bindAuthEvents() {
  // ── CORRECTION 1 : tab-login/tab-register absents du nouveau design → optionnels
  document.getElementById('tab-login')?.addEventListener('click',    () => switchAuthTab('login'));
  document.getElementById('tab-register')?.addEventListener('click', () => switchAuthTab('register'));

  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  document.getElementById('btn-register').addEventListener('click', doRegister);
  document.getElementById('reg-password2').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });

  const regName = document.getElementById('reg-name');
  let nameCheckTimeout = null;
  regName.addEventListener('input', () => {
    clearTimeout(nameCheckTimeout);
    const val = regName.value.trim();
    const hint = document.getElementById('reg-name-hint');
    if (val.length < 2) { hint.textContent = ''; hint.className = 'field-hint'; return; }
    hint.textContent = '⏳ Vérification…'; hint.className = 'field-hint checking';
    nameCheckTimeout = setTimeout(() => checkNameAvailability(val, hint), 600);
  });

  document.getElementById('reg-avatar-list').innerHTML = '';
  AVATARS.forEach((av, i) => {
    const el = document.createElement('div');
    el.className = 'av-option' + (i === 0 ? ' selected' : '');
    el.textContent = av; el.dataset.av = av;
    el.addEventListener('click', () => {
      document.querySelectorAll('#reg-avatar-list .av-option').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
    });
    document.getElementById('reg-avatar-list').appendChild(el);
  });
}

function switchAuthTab(tab) {
  // ── CORRECTION 2 : tab-login/tab-register optionnels
  document.getElementById('tab-login')?.classList.toggle('active', tab === 'login');
  document.getElementById('tab-register')?.classList.toggle('active', tab === 'register');
  document.getElementById('form-login').style.display    = tab === 'login'    ? '' : 'none';
  document.getElementById('form-register').style.display = tab === 'register' ? '' : 'none';
  clearAuthErrors();
}

async function checkNameAvailability(name, hintEl) {
  try {
    const snap = await db.ref('usernames/' + name.toLowerCase()).once('value');
    if (snap.exists()) {
      hintEl.textContent = '❌ Ce nom est déjà pris';
      hintEl.className = 'field-hint error';
    } else {
      hintEl.textContent = '✅ Nom disponible';
      hintEl.className = 'field-hint success';
    }
  } catch (e) {
    hintEl.textContent = '';
  }
}

async function doLogin() {
  const name = document.getElementById('login-name').value.trim();
  const pass = document.getElementById('login-password').value;
  if (!name || !pass) { showAuthError('Remplissez tous les champs.'); return; }

  setAuthLoading(true, 'btn-login', 'Connexion…');
  clearAuthErrors();

  try {
    const snap = await db.ref('usernames/' + name.toLowerCase()).once('value');
    if (!snap.exists()) {
      showAuthError('Nom d\'utilisateur introuvable.'); setAuthLoading(false, 'btn-login', 'Se connecter'); return;
    }
    const email = snap.val().email;
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (e) {
    console.error('LOGIN ERROR:', e.code, e.message);
    let msg = 'Erreur : ' + (e.code || e.message || 'inconnue');
    if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') msg = 'Mot de passe incorrect.';
    else if (e.code === 'auth/too-many-requests') msg = 'Trop de tentatives. Réessayez dans quelques minutes.';
    else if (e.code === 'auth/operation-not-allowed') msg = '⚠️ Email/Password non activé dans Firebase Console.';
    else if (e.code === 'auth/network-request-failed') msg = 'Erreur réseau. Vérifiez votre connexion.';
    showAuthError(msg);
    setAuthLoading(false, 'btn-login', 'Se connecter');
  }
}

async function doRegister() {
  const firstname = document.getElementById('reg-firstname')?.value.trim() || '';
  const lastname  = document.getElementById('reg-lastname')?.value.trim()  || '';
  const name      = document.getElementById('reg-name').value.trim();
  const bdayDay   = document.getElementById('reg-bday-day')?.value   || '';
  const bdayMonth = document.getElementById('reg-bday-month')?.value || '';
  const bdayYear  = document.getElementById('reg-bday-year')?.value  || '';
  const gender    = document.getElementById('reg-gender')?.value     || '';
  const contact   = document.getElementById('reg-contact')?.value.trim() || '';
  const pass1     = document.getElementById('reg-password').value;
  const pass2     = document.getElementById('reg-password2').value;
  const avatar    = document.querySelector('#reg-avatar-list .av-option.selected')?.dataset.av || AVATARS[0];

  if (!firstname || !lastname) { showAuthError('Entrez votre prénom et nom.'); return; }
  if (!name || !pass1 || !pass2) { showAuthError('Remplissez tous les champs obligatoires.'); return; }
  if (name.length < 2 || name.length > 20) { showAuthError('Le pseudo doit faire entre 2 et 20 caractères.'); return; }
  if (!/^[a-zA-Z0-9_\-À-ÿ]+$/.test(name)) { showAuthError('Pseudo invalide (lettres, chiffres, _ et - uniquement).'); return; }
  if (pass1.length < 6) { showAuthError('Le mot de passe doit faire au moins 6 caractères.'); return; }
  if (pass1 !== pass2) { showAuthError('Les mots de passe ne correspondent pas.'); return; }

  // Date de naissance formatée
  const birthdate = (bdayDay && bdayMonth && bdayYear) ? `${bdayDay}/${bdayMonth}/${bdayYear}` : '';

  setAuthLoading(true, 'btn-register', 'Création…');
  clearAuthErrors();

  try {
    const nameSnap = await db.ref('usernames/' + name.toLowerCase()).once('value');
    if (nameSnap.exists()) {
      showAuthError('Ce pseudo est déjà pris.'); setAuthLoading(false, 'btn-register', 'S\'inscrire'); return;
    }

    const fakeEmail = (name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user') + '@korana.app';
    const cred = await auth.createUserWithEmailAndPassword(fakeEmail, pass1);
    const uid  = cred.user.uid;

    await db.ref(`users/${uid}`).set({
      name, firstname, lastname, avatar,
      birthdate, gender, contact,
      status: 'offline', active: false,
      createdAt: Date.now(),
    });
    await db.ref('usernames/' + name.toLowerCase()).set({ uid, email: fakeEmail });

  } catch (e) {
    console.error('REGISTER ERROR:', e.code, e.message);
    let msg = 'Erreur : ' + (e.code || e.message || 'inconnue');
    if (e.code === 'auth/email-already-in-use')     msg = 'Ce pseudo est déjà utilisé.';
    else if (e.code === 'auth/weak-password')        msg = 'Mot de passe trop faible (6 caractères min).';
    else if (e.code === 'auth/operation-not-allowed') msg = '⚠️ Email/Password non activé dans Firebase Console → Créer → Authentication → Mode de connexion → E-mail/Mot de passe';
    else if (e.code === 'auth/network-request-failed') msg = 'Erreur réseau. Vérifiez votre connexion.';
    else if (e.code === 'auth/configuration-not-found') msg = '⚠️ Firebase Authentication non configuré. Activez Email/Password dans la console Firebase.';
    showAuthError(msg);
    setAuthLoading(false, 'btn-register', 'S\'inscrire');
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = '';
}
function clearAuthErrors() {
  document.getElementById('auth-error').style.display = 'none';
}
function setAuthLoading(loading, btnId, text) {
  const btn = document.getElementById(btnId);
  btn.disabled   = loading;
  btn.textContent = text;
}

async function loadUserProfile(uid) {
  try {
    const snap = await db.ref(`users/${uid}`).once('value');
    const profile = snap.val();
    if (!profile) { auth.signOut(); return; }

    me = { uid, name: profile.name, firstname: profile.firstname || '', lastname: profile.lastname || '',
           avatar: profile.avatar, status: 'online',
           birthdate: profile.birthdate || '', gender: profile.gender || '', contact: profile.contact || '' };

    // Forcer active:true et status:'online' dès la connexion
    await db.ref(`users/${uid}`).update({ active: true, status: 'online', lastSeen: Date.now() });

    presenceRef = db.ref(`users/${uid}`);
    db.ref('.info/connected').on('value', connSnap => {
      if (connSnap.val()) {
        // Reconnexion : remettre active:true avec le statut actuel de l'utilisateur
        presenceRef.update({ active: true, status: me.status, lastSeen: Date.now() });
        // Déconnexion : marquer inactive SANS changer le status
        presenceRef.onDisconnect().update({ active: false, lastSeen: Date.now() });
      }
    });

    // Heartbeat : mise à jour lastSeen toutes les 30s pour détecter les sessions fantômes
    setInterval(() => {
      if (db && me) db.ref(`users/${me.uid}`).update({ lastSeen: Date.now() });
    }, 30000);

    document.getElementById('header-username').textContent = me.name;
    document.getElementById('header-avatar').textContent   = me.avatar;

    showScreen('screen-chat');
    setupChatUI();
    listenAllUsers();
    switchRoom('general');

  } catch (e) {
    console.error('Erreur chargement profil:', e);
    auth.signOut();
  }
}

// Retourne true si l'utilisateur est réellement actif (lastSeen < 60s)
function isReallyActive(u) {
  if (!u.active) return false;
  if (!u.lastSeen) return false;
  return (Date.now() - u.lastSeen) < 60000;
}

function listenAllUsers() {
  db.ref('users').on('value', snap => {
    allUsers = snap.val() || {};
    renderUserList();
    if (currentRoom.startsWith('dm:')) {
      const otherUid = getDMOtherUid(currentRoom);
      const u = allUsers[otherUid];
      if (u) applyStatusToHeader(isReallyActive(u) ? (u.status || 'online') : 'inactive');
    }
  });
}

function setupChatUI() {
  document.querySelectorAll('.room-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.room-nav-item, #users-conv-list .conv-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      switchRoom(item.dataset.room);
    });
  });

  document.getElementById('btn-send').addEventListener('click', sendMessage);
  const inp = document.getElementById('msg-input');
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  inp.addEventListener('input',   () => { autoResize(inp); updateMsgLen(); emitTyping(); });

  document.getElementById('btn-emoji').addEventListener('click', e => {
    e.stopPropagation(); document.getElementById('emoji-panel').classList.toggle('hidden');
  });
  document.addEventListener('click', () => document.getElementById('emoji-panel').classList.add('hidden'));

  document.getElementById('btn-image').addEventListener('click', () => document.getElementById('img-input').click());
  document.getElementById('img-input').addEventListener('change', handleImageUpload);
  document.getElementById('btn-cancel-reply').addEventListener('click', cancelReply);
  document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);
  document.getElementById('btn-toggle-sound').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    document.getElementById('sound-icon-on').style.display  = soundEnabled ? '' : 'none';
    document.getElementById('sound-icon-off').style.display = soundEnabled ? 'none' : '';
    document.getElementById('btn-toggle-sound').title = soundEnabled ? 'Couper le son' : 'Activer le son';
    document.getElementById('btn-toggle-sound').style.opacity = soundEnabled ? '1' : '0.45';
  });
  document.getElementById('header-user-wrap').addEventListener('click', openStatusMenu);
  document.getElementById('btn-logout').addEventListener('click', logout);

  const toggleRight = () => {
    const p = document.getElementById('right-panel');
    p.style.display = p.style.display === 'none' ? '' : 'none';
  };
  document.getElementById('btn-toggle-info').addEventListener('click', toggleRight);
  document.getElementById('btn-toggle-info2').addEventListener('click', toggleRight);

  // ── Recherche globale ──
  initGlobalSearch();
  
  listenAllRooms();

  window.addEventListener('beforeunload', cleanup);
}

function switchRoom(room) {
  currentRoom = room;
  replyTo = null;
  document.getElementById('reply-bar').style.display = 'none';
  document.getElementById('messages-list').innerHTML  = '';

  unread[room] = 0;
  refreshBadge(room);

  const isDM = room.startsWith('dm:');
  const haMain = document.getElementById('chat-ha-main');

  if (isDM) {
    const otherUid  = getDMOtherUid(room);
    const u         = allUsers[otherUid] || {};
    const color     = COLORS[otherUid.charCodeAt(0) % COLORS.length];
    haMain.textContent = u.avatar || '👤';
    haMain.style.background = color;
    document.getElementById('current-room-name').textContent = u.name || '…';
    applyStatusToHeader(isReallyActive(u) ? (u.status || 'online') : 'inactive');
    document.getElementById('rp-avatar').textContent = u.avatar || '👤';
    document.getElementById('rp-avatar').style.background = color;
    document.getElementById('rp-name').textContent = u.firstname && u.lastname ? u.firstname + ' ' + u.lastname : (u.name || '…');
    document.getElementById('rp-sub').textContent  = '@' + (u.name || '');
    // Panneau À propos : infos de l'utilisateur ciblé
    renderRpAboutUser(u);
  } else {
    const info = ROOMS[room];
    haMain.textContent = info.emoji;
    haMain.style.background = info.color;
    document.getElementById('current-room-name').textContent = '# ' + info.label;
    resetHeaderDesc(info.desc);
    document.getElementById('rp-avatar').textContent = info.emoji;
    document.getElementById('rp-avatar').style.background = info.color;
    document.getElementById('rp-name').textContent = '# ' + info.label;
    document.getElementById('rp-sub').textContent  = info.desc;
    // Panneau À propos : infos du salon
    renderRpAboutRoom(info);
  }

  listenRoomMessages(room);
  listenTyping(room);
  listenSeen(room);
  markSeen(room);
  listenRoomImages(room);

  document.getElementById('msg-input').focus();
}

function getDMOtherUid(dmKey) {
  return dmKey.replace('dm:', '').split('_').find(p => p !== me.uid) || '';
}
function makeDMKey(uid) {
  return 'dm:' + [me.uid, uid].sort().join('_');
}
function getStatusLabel(val) {
  if (val === 'inactive') return 'Inactif';
  return (STATUSES.find(s => s.value === val) || STATUSES[0]).label;
}
function applyStatusToHeader(val) {
  const label = getStatusLabel(val);
  const color = val === 'inactive' ? '#9ca3af' : (STATUS_TEXT_COLOR[val] || '#22c55e');
  const el    = document.getElementById('current-room-desc');
  el.textContent = label; el.style.color = color; el.style.fontWeight = '600';
}
function resetHeaderDesc(text) {
  const el = document.getElementById('current-room-desc');
  el.textContent = text; el.style.color = ''; el.style.fontWeight = '';
}

// ─── Panneau À propos : utilisateur (DM) ───
function renderRpAboutUser(u) {
  const list = document.getElementById('rp-about-list');
  if (!list) return;

  const fullName = (u.firstname && u.lastname) ? u.firstname + ' ' + u.lastname : (u.name || '—');
  const statusInfo = STATUSES.find(s => s.value === (u.status || 'online')) || STATUSES[0];
  const isActive = isReallyActive(u);

  const rows = [
    { icon: '👤', label: 'Nom complet',     value: fullName },
    { icon: '🏷️', label: 'Pseudo',          value: u.name || '—' },
    { icon: '🎂', label: 'Date de naissance', value: u.birthdate || 'Non renseigné' },
    { icon: '⚧',  label: 'Genre',            value: u.gender   || 'Non renseigné' },
    { icon: '📱', label: 'Contact',          value: u.contact  || 'Non renseigné' },
    { icon: '🟢', label: 'Statut',           value: isActive ? statusInfo.label : 'Inactif' },
  ];

  list.innerHTML = rows.map(r => `
    <div class="rp-about-row">
      <span class="rp-about-icon">${r.icon}</span>
      <div class="rp-about-info">
        <div class="rp-about-label">${r.label}</div>
        <div class="rp-about-value">${escHtml(r.value)}</div>
      </div>
    </div>
  `).join('');
}

// ─── Panneau À propos : salon (groupe) ───
function renderRpAboutRoom(info) {
  const list = document.getElementById('rp-about-list');
  if (!list) return;

  const activeCount = Object.values(allUsers).filter(u => isReallyActive(u)).length;

  const rows = [
    { icon: info.emoji, label: 'Salon',       value: '# ' + info.label },
    { icon: '📝',       label: 'Description', value: info.desc },
    { icon: '👥',       label: 'Membres actifs', value: activeCount + ' en ligne' },
    { icon: '♾️',       label: 'Historique',  value: 'Illimité' },
    { icon: '🔓',       label: 'Accès',       value: 'Public' },
  ];

  list.innerHTML = rows.map(r => `
    <div class="rp-about-row">
      <span class="rp-about-icon">${r.icon}</span>
      <div class="rp-about-info">
        <div class="rp-about-label">${r.label}</div>
        <div class="rp-about-value">${escHtml(String(r.value))}</div>
      </div>
    </div>
  `).join('');
}

function listenRoomMessages(room) {
  if (msgListeners[room]) { db.ref(`messages/${room}`).off(); delete msgListeners[room]; }

  let isFirstLoad = true;
  let firstLoadCount = 0;

  const query = db.ref(`messages/${room}`).orderByChild('ts').limitToLast(200);

  query.once('value', snap => {
    firstLoadCount = snap.numChildren();
    let loaded = 0;
    if (firstLoadCount === 0) isFirstLoad = false;

    msgListeners[room] = query.on('child_added', snap => {
      if (!snap.val()) return;
      
      if (isFirstLoad) {
        receiveMessage(snap.val(), true, room);
        loaded++;
        if (loaded >= firstLoadCount) isFirstLoad = false;
      } else {
        receiveMessage(snap.val(), false, room);
      }
    });
  });

  db.ref(`messages/${room}`).on('child_removed', snap => {
    document.getElementById(`msg-${snap.key}`)?.classList.add('msg-deleted');
  });
  db.ref(`reactions/${room}`).on('value', snap => updateAllReactions(snap.val() || {}));
}

function listenTyping(room) {
  if (typingRef) typingRef.off();
  typingRef = db.ref(`typing/${room}`);
  typingRef.on('value', snap => {
    const others = Object.entries(snap.val() || {})
      .filter(([uid, ts]) => uid !== me.uid && Date.now() - ts < 4000)
      .map(([uid]) => allUsers[uid]?.name || '…');
    const ind = document.getElementById('typing-indicator');
    const txt = document.getElementById('typing-text');
    if (others.length) {
      ind.classList.remove('hidden');
      txt.textContent = ' ' + others.join(', ') + (others.length === 1 ? ' écrit…' : ' écrivent…');
    } else { ind.classList.add('hidden'); }
  });
}

function listenSeen(room) {
  if (seenRef) seenRef.off();
  seenRef = db.ref(`seen/${room}`);
  seenRef.on('value', () => refreshSeenDisplay());
}

function sendMessage() {
  const inp  = document.getElementById('msg-input');
  const text = inp.value.trim();
  if (!text) return;

  const msg = {
    id: genId(), senderId: me.uid, senderName: me.name, senderAvatar: me.avatar,
    text, ts: Date.now(), type: 'text',
  };
  if (replyTo) msg.replyTo = { id: replyTo.id, senderName: replyTo.senderName, text: replyTo.text };

  inp.value = ''; autoResize(inp); updateMsgLen(); cancelReply();

  const ref = db.ref(`messages/${currentRoom}`).push();
  msg.id = ref.key; ref.set(msg);
  db.ref(`typing/${currentRoom}/${me.uid}`).remove();
}

function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    const msg = {
      id: genId(), senderId: me.uid, senderName: me.name, senderAvatar: me.avatar,
      text: '', imageUrl: ev.target.result, ts: Date.now(), type: 'image',
    };
    if (replyTo) msg.replyTo = { id: replyTo.id, senderName: replyTo.senderName, text: replyTo.text };
    cancelReply();
    const ref = db.ref(`messages/${currentRoom}`).push();
    msg.id = ref.key; ref.set(msg);
  };
  reader.readAsDataURL(file);
}

function receiveMessage(msg, isHistory = false, room = currentRoom) {
  if (document.getElementById(`msg-${msg.id}`)) return;

  // Ne jamais afficher un message si sa room n'est pas la room actuellement ouverte
  if (room !== currentRoom) {
    // Juste mettre à jour badge + preview DM si besoin
    if (!isHistory && msg.senderId !== me.uid) {
      if (room.startsWith('dm:')) {
        const otherUid = room.replace('dm:', '').split('_').find(p => p !== me.uid) || '';
        const previewText = msg.text || '📷 Image';
        dmLastMsg[otherUid] = { text: previewText, ts: msg.ts };
        updateConvItemPreview(otherUid, previewText, msg.ts);
        unread[room] = (unread[room] || 0) + 1;
        refreshBadge(room);
      }
      playNotifSound();
      sendPushNotification(msg, room);
    }
    return;
  }

  const isOwn = msg.senderId === me.uid;
  const list  = document.getElementById('messages-list');

  const dateLabel = formatDate(msg.ts);
  const lastSep   = list.querySelector('.msg-date-sep:last-of-type');
  if (!lastSep || lastSep.dataset.date !== dateLabel) {
    const sep = document.createElement('div');
    sep.className = 'msg-date-sep'; sep.dataset.date = dateLabel;
    sep.innerHTML = `<span>${dateLabel}</span>`;
    list.appendChild(sep);
  }

  const wrap = document.createElement('div');
  wrap.className = `msg-bubble ${isOwn ? 'own' : ''}`;
  wrap.id = `msg-${msg.id}`;

  const contentHtml = (msg.type === 'image' && msg.imageUrl)
    ? `<div class="msg-image-wrap"><img src="${msg.imageUrl}" class="msg-image" onclick="openLightbox(this.src)"/></div>`
    : `<div class="msg-text">${formatMsgText(msg.text)}</div>`;

  const replyHtml = msg.replyTo
    ? `<div class="msg-reply-ref" onclick="scrollToMsg('${msg.replyTo.id}')">
         <span class="reply-author">${escHtml(msg.replyTo.senderName)}</span>
         <span class="reply-preview">${escHtml((msg.replyTo.text||'').slice(0,60))}</span>
       </div>` : '';

  const actionsHtml = `
    <div class="msg-actions">
      <button class="msg-action-btn" onclick="openReactionPicker('${msg.id}',this)">😊</button>
      <button class="msg-action-btn" onclick="setReply('${msg.id}','${escHtml(msg.senderName)}','${escHtml((msg.text||'').slice(0,80))}')">↩</button>
      ${isOwn ? `<button class="msg-action-btn danger" onclick="deleteMessage('${msg.id}')">🗑</button>` : ''}
    </div>`;

  wrap.innerHTML = `
    ${!isOwn ? `<div class="msg-av">${msg.senderAvatar}</div>` : ''}
    <div class="msg-content">
      <div class="msg-meta">
        ${!isOwn ? `<span class="name">${escHtml(msg.senderName)}</span>` : ''}
        <span class="time">${formatTime(msg.ts)}</span>
        ${isOwn ? `<span class="seen-indicator" id="seen-${msg.id}"></span>` : ''}
      </div>
      ${replyHtml}${contentHtml}
      <div class="msg-reactions" id="reactions-${msg.id}"></div>
    </div>
    ${actionsHtml}`;

  list.appendChild(wrap);
  scrollToBottom();

  const previewText = msg.text || '📷 Image';
  // Ne mettre à jour le preview DM QUE si le message vient d'un DM (pas d'un groupe)
  if (currentRoom.startsWith('dm:')) {
    if (!isOwn && msg.senderId) {
      dmLastMsg[msg.senderId] = { text: previewText, ts: msg.ts };
      updateConvItemPreview(msg.senderId, previewText, msg.ts);
    }
    if (isOwn) {
      const otherUid = getDMOtherUid(currentRoom);
      dmLastMsg[otherUid] = { text: 'Vous : ' + previewText, ts: msg.ts };
      updateConvItemPreview(otherUid, 'Vous : ' + previewText, msg.ts);
    }
  }

  if (!isHistory && !isOwn) {
    playNotifSound();
    sendPushNotification(msg, currentRoom);
    markSeen(currentRoom);
    refreshSeenDisplay();
  }
}

function updateConvItemPreview(uid, text, ts) {
  const item = document.querySelector(`#users-conv-list .conv-item[data-uid="${uid}"]`);
  if (!item) return;
  const short = text.length > 36 ? text.slice(0, 36) + '…' : text;
  const p = item.querySelector('.ci-preview');
  const t = item.querySelector('.ci-time');
  if (p) { p.textContent = short; p.classList.add('has-msg'); }
  if (t)   t.textContent = formatTime(ts);
}

function addSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'msg-system'; el.textContent = text;
  document.getElementById('messages-list').appendChild(el);
  scrollToBottom();
}

function formatMsgText(text) {
  return escHtml(text).replace(/(https?:\/\/[^\s]+)/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}

function refreshBadge(room) {
  const count = unread[room] || 0;
  if (room.startsWith('dm:')) {
    const otherUid = getDMOtherUid(room);
    const item     = document.querySelector(`#users-conv-list .conv-item[data-uid="${otherUid}"]`);
    if (!item) return;
    let badge = item.querySelector('.ci-dm-badge');
    if (!badge) { badge = document.createElement('span'); badge.className = 'ci-dm-badge'; item.appendChild(badge); }
    badge.textContent  = count > 0 ? '+' + count : '';
    badge.style.display = count > 0 ? '' : 'none';
  } else {
    const badge = document.getElementById(`badge-${room}`);
    if (!badge) return;
    if (count > 0) { badge.textContent = count; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
}

function renderUserList() {
  const ids      = Object.keys(allUsers);
  const convList = document.getElementById('users-conv-list');
  convList.innerHTML = '';

  ids.sort((a, b) => {
    const aA = isReallyActive(allUsers[a]) ? 1 : 0;
    const bA = isReallyActive(allUsers[b]) ? 1 : 0;
    return bA - aA;
  });

  ids.forEach(uid => {
    if (uid === me.uid) {
      const u = allUsers[uid];
      const color = COLORS[uid.charCodeAt(0) % COLORS.length];
      const item = document.createElement('div');
      item.className = 'conv-item';
      item.innerHTML = `
        <div class="ci-avatar" style="background:${color};">
          ${u.avatar}
          <span class="ci-online-dot" style="background:#22c55e;"></span>
        </div>
        <div class="ci-body">
          <div class="ci-top">
            <span class="ci-name">${escHtml(u.name)} <span style="font-size:10px;color:#9ca3af;font-weight:400">(vous)</span></span>
          </div>
          <div class="ci-preview"></div>
        </div>
      `;
      convList.appendChild(item);
      return;
    }
    const u       = allUsers[uid];
    const color   = COLORS[uid.charCodeAt(0) % COLORS.length];
    const isActive= isReallyActive(u);
    const status  = isActive ? (u.status || 'online') : 'offline';
    const dotColor= isActive ? (STATUS_DOT_COLOR[status] || '#22c55e') : '#d1d5db';
    const lastM   = dmLastMsg[uid];
    const preview = lastM ? (lastM.text.length > 36 ? lastM.text.slice(0,36)+'…' : lastM.text) : '';
    const timeStr = lastM ? formatTime(lastM.ts) : '';
    const dmKey   = makeDMKey(uid);
    const badgeCnt= unread[dmKey] || 0;

    const item = document.createElement('div');
    item.className = 'conv-item';
    item.dataset.uid = uid;

    item.innerHTML = `
      <div class="ci-avatar" style="background:${color};${!isActive ? 'opacity:0.6;' : ''}">
        ${u.avatar}
        ${isActive
          ? `<span class="ci-online-dot" style="background:${dotColor};"></span>`
          : `<span class="ci-offline-dot"></span>`
        }
      </div>
      <div class="ci-body">
        <div class="ci-top">
          <span class="ci-name" style="${!isActive ? 'color:var(--text3);' : ''}">${escHtml(u.name)}</span>
          <span class="ci-time">${timeStr}</span>
        </div>
        <div class="ci-preview${preview ? ' has-msg' : ''}">${escHtml(preview)}</div>
      </div>
      <span class="ci-dm-badge" style="display:${badgeCnt > 0 ? '' : 'none'}">${badgeCnt > 0 ? '+'+badgeCnt : ''}</span>
    `;

    item.addEventListener('click', () => {
      document.querySelectorAll('#users-conv-list .conv-item, .room-nav-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      unread[dmKey] = 0;
      refreshBadge(dmKey);
      switchRoom(dmKey);
    });

    convList.appendChild(item);
  });

  const onlineList  = document.getElementById('rp-online-list');
  const onlineBadge = document.getElementById('rp-online-badge');
  const activeCount = ids.filter(uid => uid !== me.uid && isReallyActive(allUsers[uid])).length;
  if (onlineBadge) onlineBadge.textContent = activeCount;
  onlineList.innerHTML = '';
  ids.forEach(uid => {
    if (uid === me.uid) return;
    const u  = allUsers[uid];
    const isA= isReallyActive(u);
    const si = STATUSES.find(s => s.value === (u.status||'online')) || STATUSES[0];
    const dc = isA ? (STATUS_DOT_COLOR[u.status||'online']||'#22c55e') : '#d1d5db';
    const el = document.createElement('div');
    el.className = 'online-user-item';
    el.innerHTML = `
      <div class="ou-avatar" style="${!isA?'opacity:0.6':''}">
        ${u.avatar}
        ${isA ? `<span class="ci-online-dot" style="background:${dc};"></span>` : `<span class="ci-offline-dot"></span>`}
      </div>
      <div>
        <div class="ou-name" style="${!isA?'color:var(--text3)':''}">${escHtml(u.name)}</div>
        <div style="font-size:11px;color:${isA?(STATUS_TEXT_COLOR[u.status||'online']||'#22c55e'):'#9ca3af'}">${isA ? si.label : 'Inactif'}</div>
      </div>`;
    onlineList.appendChild(el);
  });

  // Mettre à jour header DM et panneau About si DM actif
  if (currentRoom.startsWith('dm:') && me) {
    const otherUid = getDMOtherUid(currentRoom);
    const u = allUsers[otherUid];
    if (u) {
      applyStatusToHeader(isReallyActive(u) ? (u.status || 'online') : 'inactive');
      renderRpAboutUser(u);
    }
  }
}

function openStatusMenu() {
  document.getElementById('status-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'status-menu'; menu.className = 'status-menu';
  menu.innerHTML = STATUSES.map(s =>
    `<div class="status-opt ${me.status === s.value ? 'active' : ''}" data-val="${s.value}">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${STATUS_DOT_COLOR[s.value]};margin-right:8px;"></span>
      ${s.label}
    </div>`
  ).join('');
  document.body.appendChild(menu);
  const ref = document.getElementById('header-user-wrap').getBoundingClientRect();
  menu.style.top   = (ref.bottom + 6) + 'px';
  menu.style.right = (window.innerWidth - ref.right) + 'px';
  menu.querySelectorAll('.status-opt').forEach(opt =>
    opt.addEventListener('click', e => { e.stopPropagation(); setStatus(opt.dataset.val); menu.remove(); })
  );
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

function setStatus(val) {
  me.status = val;
  const s = STATUSES.find(x => x.value === val);
  document.getElementById('header-status-dot').textContent = s?.icon || '🟢';
  if (db && me) db.ref(`users/${me.uid}`).update({ status: val, active: true, lastSeen: Date.now() });
}

function setReply(msgId, senderName, text) {
  replyTo = { id: msgId, senderName, text };
  document.getElementById('reply-author').textContent  = senderName;
  document.getElementById('reply-preview').textContent = text;
  document.getElementById('reply-bar').style.display   = 'flex';
  document.getElementById('msg-input').focus();
}
function cancelReply() {
  replyTo = null;
  document.getElementById('reply-bar').style.display = 'none';
}
function scrollToMsg(msgId) {
  const el = document.getElementById(`msg-${msgId}`);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-highlight'); setTimeout(() => el.classList.remove('msg-highlight'), 1500); }
}

function openReactionPicker(msgId, btn) {
  document.querySelectorAll('.reaction-picker').forEach(p => p.remove());
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.innerHTML = REACTIONS.map(r =>
    `<span class="rp-emoji" onclick="addReaction('${msgId}','${r}');this.closest('.reaction-picker').remove()">${r}</span>`
  ).join('');
  btn.closest('.msg-bubble').appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 10);
}

function addReaction(msgId, emoji) {
  const ref = db.ref(`reactions/${currentRoom}/${msgId}/${emoji}/${me.uid}`);
  ref.once('value', snap => { if (snap.exists()) ref.remove(); else ref.set(true); });
}

function updateAllReactions(data) {
  Object.entries(data).forEach(([msgId, emojiMap]) => {
    const container = document.getElementById(`reactions-${msgId}`);
    if (!container) return;
    container.innerHTML = '';
    Object.entries(emojiMap).forEach(([emoji, users]) => {
      const count = Object.keys(users).length;
      if (!count) return;
      const btn = document.createElement('button');
      btn.className = 'reaction-chip' + (users[me.uid] ? ' mine' : '');
      btn.innerHTML = `${emoji} <span>${count}</span>`;
      btn.addEventListener('click', () => addReaction(msgId, emoji));
      container.appendChild(btn);
    });
  });
}

function deleteMessage(msgId) {
  if (!confirm('Supprimer ce message ?')) return;
  db.ref(`messages/${currentRoom}/${msgId}`).remove();
}

function markSeen(room) {
  if (!db || !me) return;
  db.ref(`seen/${room}/${me.uid}`).set({ ts: Date.now(), name: me.name });
}

function refreshSeenDisplay() {
  document.querySelectorAll('.msg-bubble.own .seen-indicator').forEach(el => {
    el.textContent = ''; el.className = 'seen-indicator';
  });
  const myMsgs = [...document.querySelectorAll('.msg-bubble.own')];
  if (!myMsgs.length) return;
  const seenEl = myMsgs[myMsgs.length - 1].querySelector('.seen-indicator');
  if (!seenEl) return;

  db.ref(`seen/${currentRoom}`).once('value', snap => {
    const viewers = Object.entries(snap.val() || {})
      .filter(([uid]) => uid !== me.uid)
      .map(([, v]) => v.name);
    if (viewers.length) {
      seenEl.textContent = '✓✓ Vu par ' + viewers.join(', ');
      seenEl.className = 'seen-indicator seen';
    } else {
      seenEl.textContent = '✓ Envoyé';
    }
  });
}

function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = src;
  lb.style.display = 'flex';
}
function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
}

function exportPDF() {
  const msgs = document.querySelectorAll('#messages-list .msg-bubble');
  if (!msgs.length) { alert('Aucun message à exporter.'); return; }
  let html = `<html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;font-size:13px;padding:30px}
    h1{font-size:18px}.sub{font-size:12px;color:#666;margin-bottom:20px}
    .msg{margin-bottom:12px}.meta{font-size:11px;color:#888}.name{font-weight:bold;color:#2563eb}
    .bubble{display:inline-block;background:#f3f4f6;padding:8px 12px;border-radius:12px;max-width:70%}
    .own .bubble{background:#dbeafe}
    .sep{text-align:center;color:#aaa;font-size:11px;margin:10px 0;border-top:1px solid #eee;padding-top:6px}
  </style></head><body>
  <h1>💬 KORANA</h1>
  <div class="sub">${document.getElementById('current-room-name').textContent} · ${new Date().toLocaleDateString('fr-FR')}</div>`;
  document.querySelectorAll('#messages-list > *').forEach(el => {
    if (el.classList.contains('msg-date-sep')) html += `<div class="sep">${el.textContent}</div>`;
    else if (el.classList.contains('msg-bubble')) {
      const own = el.classList.contains('own');
      html += `<div class="msg ${own?'own':''}">
        <div class="meta"><span class="name">${escHtml(el.querySelector('.name')?.textContent || me.name)}</span> · ${el.querySelector('.time')?.textContent||''}</div>
        <div class="bubble">${escHtml(el.querySelector('.msg-text')?.textContent || '[Image]')}</div>
      </div>`;
    }
  });
  html += '</body></html>';
  const w = window.open('', '_blank');
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => w.print(), 500);
}

function emitTyping() {
  if (!db || !me) return;
  db.ref(`typing/${currentRoom}/${me.uid}`).set(Date.now());
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => db.ref(`typing/${currentRoom}/${me.uid}`).remove(), 3000);
}

function toggleLeftSection(header) {
  const body   = header.nextElementSibling;
  const toggle = header.querySelector('.left-section-toggle');
  const isOpen = toggle.classList.contains('open');
  body.style.display = isOpen ? 'none' : '';
  toggle.classList.toggle('open', !isOpen);
}

async function logout() {
  if (!confirm('Se déconnecter ?')) return;
  cleanup();
  if (db && me) await db.ref(`users/${me.uid}`).update({ active: false, lastSeen: Date.now() });
  await auth.signOut();
}

function cleanup() {
  if (presenceRef) presenceRef.onDisconnect().cancel();
  if (db) {
    Object.keys(msgListeners).forEach(r => db.ref(`messages/${r}`).off());
    typingRef?.off(); seenRef?.off();
    if (me) db.ref(`typing/${currentRoom}/${me.uid}`).remove();
  }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function renderAvatarPicker() {}
function renderEmojiPanel() {
  const panel = document.getElementById('emoji-panel');
  if (!panel) return;
  EMOJIS.forEach(em => {
    const btn = document.createElement('div');
    btn.className = 'emoji-btn'; btn.textContent = em;
    btn.addEventListener('click', () => { insertAtCursor(document.getElementById('msg-input'), em); updateMsgLen(); });
    panel.appendChild(btn);
  });
}
function genId()    { return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function formatTime(ts) { return new Date(ts).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); }
function formatDate(ts) {
  const d=new Date(ts),t=new Date(),y=new Date(t); y.setDate(t.getDate()-1);
  if(d.toDateString()===t.toDateString()) return 'Aujourd\'hui';
  if(d.toDateString()===y.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
function scrollToBottom() { const c=document.getElementById('messages-container'); if(c) c.scrollTop=c.scrollHeight; }
function autoResize(el)   { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,120)+'px'; }
function updateMsgLen()   {
  const n=document.getElementById('msg-input').value.length;
  const el=document.getElementById('msg-len');
  if(el){ el.textContent=n+'/500'; el.style.display=n>400?'':'none'; }
}
function insertAtCursor(el,text) {
  const s=el.selectionStart,e=el.selectionEnd;
  el.value=el.value.slice(0,s)+text+el.value.slice(e);
  el.selectionStart=el.selectionEnd=s+text.length; el.focus();
}

// ─── Album photo : écoute les images de la room ───
function listenRoomImages(room) {
  const grid = document.getElementById('rp-album-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="rp-album-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 15l4-4 4 4 4-5 6 6"/><circle cx="8.5" cy="8.5" r="1.5"/></svg><span>Chargement…</span></div>';

  db.ref(`messages/${room}`).orderByChild('type').equalTo('image').limitToLast(30)
    .once('value', snap => {
      const imgs = [];
      snap.forEach(child => { if (child.val().imageUrl) imgs.push(child.val().imageUrl); });
      if (!imgs.length) {
        grid.innerHTML = '<div class="rp-album-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 15l4-4 4 4 4-5 6 6"/><circle cx="8.5" cy="8.5" r="1.5"/></svg><span>Aucune photo partagée</span></div>';
        return;
      }
      grid.innerHTML = imgs.reverse().map(src =>
        `<div class="rp-album-thumb"><img src="${src}" loading="lazy" onclick="openLightbox('${src}')"/></div>`
      ).join('');
    });
}

function listenAllRooms() {
  Object.keys(ROOMS).forEach(room => {
    db.ref(`messages/${room}`).orderByChild('ts').limitToLast(1)
      .on('child_added', snap => {
        const msg = snap.val();
        if (!msg || msg.senderId === me.uid) return;
        if (currentRoom === room) return;
        unread[room] = (unread[room] || 0) + 1;
        refreshBadge(room);
        sendPushNotification(msg, room);
      });
  });

  db.ref('users').once('value', snap => {
    const uids = Object.keys(snap.val() || {}).filter(uid => uid !== me.uid);
    uids.forEach(uid => {
      const dmKey = makeDMKey(uid);

      // ── CORRECTION : charger le preview du dernier msg dès le démarrage ──
      db.ref(`messages/${dmKey}`).orderByChild('ts').limitToLast(1)
        .once('value', snap => {
          snap.forEach(child => {
            const msg = child.val();
            if (!msg) return;
            const isOwn = msg.senderId === me.uid;
            const preview = isOwn ? 'Vous : ' + (msg.text || '📷 Image') : (msg.text || '📷 Image');
            dmLastMsg[uid] = { text: preview, ts: msg.ts };
            updateConvItemPreview(uid, preview, msg.ts);
          });
        });

      // ── Écoute en temps réel des nouveaux msgs pour badge + preview ──
      let firstEvent = true;
      db.ref(`messages/${dmKey}`).orderByChild('ts').limitToLast(1)
        .on('child_added', snap => {
          // Ignorer l'événement initial déclenché au chargement
          if (firstEvent) { firstEvent = false; return; }
          const msg = snap.val();
          if (!msg) return;
          const isOwn = msg.senderId === me.uid;
          const preview = isOwn ? 'Vous : ' + (msg.text || '📷 Image') : (msg.text || '📷 Image');
          dmLastMsg[uid] = { text: preview, ts: msg.ts };
          updateConvItemPreview(uid, preview, msg.ts);
          if (!isOwn && currentRoom !== dmKey) {
            unread[dmKey] = (unread[dmKey] || 0) + 1;
            refreshBadge(dmKey);
          }
        });
    });
  });
}

// ════════════════════════════════════════════
//  KORANA — Recherche Globale
//  · Utilisateurs (ouvre DM au clic)
//  · Messages dans la conversation ouverte
//  · Messages dans tous les salons + DMs
// ════════════════════════════════════════════

let searchDebounceTimer = null;
let searchAbortMap = {};   // room → true si on annule la recherche en cours

function initGlobalSearch() {
  const input    = document.getElementById('conv-search-input');
  const dropdown = document.getElementById('global-search-dropdown');
  const clearBtn = document.getElementById('global-search-clear');
  if (!input) return;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.style.display = q ? '' : 'none';
    clearTimeout(searchDebounceTimer);
    if (!q) { closeSearchDropdown(); return; }
    searchDebounceTimer = setTimeout(() => runGlobalSearch(q), 280);
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (q.length >= 1) runGlobalSearch(q);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    closeSearchDropdown();
    input.focus();
  });

  // Fermer dropdown en cliquant ailleurs
  document.addEventListener('click', e => {
    if (!e.target.closest('#global-search-box') && !e.target.closest('#global-search-dropdown')) {
      closeSearchDropdown();
    }
  });

  // Navigation clavier ↑ ↓ Entrée Échap
  input.addEventListener('keydown', e => {
    const items = [...document.querySelectorAll('.gsearch-item')];
    const focused = document.querySelector('.gsearch-item.focused');
    let idx = items.indexOf(focused);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items.forEach(i => i.classList.remove('focused'));
      const next = items[Math.min(idx + 1, items.length - 1)];
      next?.classList.add('focused');
      next?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items.forEach(i => i.classList.remove('focused'));
      const prev = items[Math.max(idx - 1, 0)];
      prev?.classList.add('focused');
      prev?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (focused) { focused.click(); return; }
      if (items.length === 1) items[0].click();
    } else if (e.key === 'Escape') {
      closeSearchDropdown();
      input.blur();
    }
  });
}

function closeSearchDropdown() {
  const d = document.getElementById('global-search-dropdown');
  if (d) d.style.display = 'none';
}

async function runGlobalSearch(query) {
  const q   = query.toLowerCase().trim();
  const res = document.getElementById('gsearch-results');
  const dd  = document.getElementById('global-search-dropdown');
  if (!res || !dd || !q) return;

  res.innerHTML = '<div class="gsearch-loading"><span class="gsearch-spinner"></span> Recherche…</div>';
  dd.style.display = '';

  const sections = [];

  // ── 1. UTILISATEURS ──────────────────────────────────────────
  const userMatches = Object.entries(allUsers)
    .filter(([uid, u]) => uid !== me.uid && (
      u.name?.toLowerCase().includes(q) ||
      (u.firstname + ' ' + u.lastname).toLowerCase().includes(q)
    ))
    .slice(0, 5);

  if (userMatches.length) {
    const items = userMatches.map(([uid, u]) => {
      const color   = COLORS[uid.charCodeAt(0) % COLORS.length];
      const isActive= isReallyActive(u);
      const dotColor= isActive ? (STATUS_DOT_COLOR[u.status||'online']||'#22c55e') : '#d1d5db';
      const fullName= (u.firstname && u.lastname) ? `${u.firstname} ${u.lastname}` : '';
      const subtext = fullName ? `<span class="gsr-sub">${escHtml(fullName)}</span>` : '';
      return `
        <div class="gsearch-item" data-action="open-dm" data-uid="${uid}">
          <div class="gsr-avatar" style="background:${color};">
            ${u.avatar}
            <span class="gsr-dot" style="background:${dotColor};"></span>
          </div>
          <div class="gsr-body">
            <span class="gsr-name">${highlightMatch(escHtml(u.name), q)}</span>
            ${subtext}
          </div>
          <span class="gsr-tag">Message privé</span>
        </div>`;
    }).join('');
    sections.push(`<div class="gsearch-section-title">👤 Utilisateurs</div>${items}`);
  }

  // ── 2. MESSAGES DANS LA CONVERSATION OUVERTE ─────────────────
  const localMsgs = [];
  document.querySelectorAll('#messages-list .msg-bubble').forEach(bubble => {
    const textEl = bubble.querySelector('.msg-text');
    if (!textEl) return;
    const text = textEl.textContent;
    if (!text.toLowerCase().includes(q)) return;
    const nameEl = bubble.querySelector('.msg-meta .name');
    const timeEl = bubble.querySelector('.msg-meta .time');
    const msgId  = bubble.id?.replace('msg-', '');
    localMsgs.push({ text, name: nameEl?.textContent || me.name, time: timeEl?.textContent || '', msgId });
  });

  if (localMsgs.length) {
    const roomName = document.getElementById('current-room-name')?.textContent || 'conversation';
    const items = localMsgs.slice(0, 6).map(m => `
      <div class="gsearch-item" data-action="scroll-msg" data-msgid="${m.msgId}">
        <div class="gsr-icon-wrap">💬</div>
        <div class="gsr-body">
          <span class="gsr-name">${highlightMatch(escHtml(m.text.slice(0, 60)), q)}</span>
          <span class="gsr-sub">${escHtml(m.name)} · ${m.time}</span>
        </div>
        <span class="gsr-tag gsr-tag-room">${escHtml(roomName)}</span>
      </div>`).join('');
    sections.push(`<div class="gsearch-section-title">💬 Dans cette conversation</div>${items}`);
  }

  // ── 3. MESSAGES DANS TOUS LES SALONS + DMs ───────────────────
  // ⚠️ IMPORTANT : on utilise .orderByChild('ts') et NON .equalTo()
  // pour ne PAS interférer avec les listeners .on('child_added') actifs.
  const allRoomKeys = [
    ...Object.keys(ROOMS),
    ...Object.keys(allUsers)
      .filter(uid => uid !== me.uid)
      .map(uid => makeDMKey(uid))
  ];

  // Dédupliquer les clés DM
  const uniqueKeys = [...new Set(allRoomKeys)];

  const remoteResults = [];

  // On utilise des refs fraîches (nouvelle instance) pour ne jamais
  // toucher aux mêmes refs que les listeners temps réel.
  await Promise.all(uniqueKeys.map(async roomKey => {
    try {
      // Utiliser orderByChild('ts') sans equalTo() évite le conflit
      // avec les listeners child_added déjà actifs sur ces refs.
      const snap = await firebase.database()
        .ref(`messages/${roomKey}`)
        .orderByChild('ts')
        .limitToLast(200)
        .once('value');

      snap.forEach(child => {
        const msg = child.val();
        if (!msg || !msg.text || msg.type === 'image') return;
        if (!msg.text.toLowerCase().includes(q)) return;
        // Ne pas dupliquer ce qui est déjà dans la conversation ouverte
        if (roomKey === currentRoom) return;
        remoteResults.push({ roomKey, msg, key: child.key });
      });
    } catch (e) { /* room inaccessible */ }
  }));

  // Trier par date décroissante, limiter à 8
  remoteResults.sort((a, b) => (b.msg.ts || 0) - (a.msg.ts || 0));
  const topRemote = remoteResults.slice(0, 8);

  if (topRemote.length) {
    const items = topRemote.map(({ roomKey, msg }) => {
      const isDM = roomKey.startsWith('dm:');
      let roomLabel, roomIcon;
      if (isDM) {
        const otherUid = roomKey.replace('dm:', '').split('_').find(p => p !== me.uid) || '';
        const u = allUsers[otherUid] || {};
        roomLabel = u.name || 'DM';
        roomIcon  = u.avatar || '👤';
      } else {
        const info = ROOMS[roomKey] || {};
        roomLabel = '# ' + (info.label || roomKey);
        roomIcon  = info.emoji || '💬';
      }
      const shortText = msg.text.length > 60 ? msg.text.slice(0, 60) + '…' : msg.text;
      return `
        <div class="gsearch-item" data-action="open-room" data-room="${roomKey}" data-msgid="${msg.id || ''}">
          <div class="gsr-icon-wrap">${roomIcon}</div>
          <div class="gsr-body">
            <span class="gsr-name">${highlightMatch(escHtml(shortText), q)}</span>
            <span class="gsr-sub">${escHtml(msg.senderName || '?')} · ${formatTime(msg.ts)}</span>
          </div>
          <span class="gsr-tag gsr-tag-room">${escHtml(roomLabel)}</span>
        </div>`;
    }).join('');
    sections.push(`<div class="gsearch-section-title">🌐 Tous les salons & DMs</div>${items}`);
  }

  // ── Rendu final ───────────────────────────────────────────────
  if (!sections.length) {
    res.innerHTML = `<div class="gsearch-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <span>Aucun résultat pour « ${escHtml(query)} »</span>
    </div>`;
  } else {
    res.innerHTML = sections.join('');
    // Bind clics
    res.querySelectorAll('.gsearch-item').forEach(item => {
      item.addEventListener('click', () => handleSearchResultClick(item));
    });
  }
}

function handleSearchResultClick(item) {
  const action = item.dataset.action;
  closeSearchDropdown();
  document.getElementById('conv-search-input').value = '';
  document.getElementById('global-search-clear').style.display = 'none';

  if (action === 'open-dm') {
    const uid   = item.dataset.uid;
    const dmKey = makeDMKey(uid);
    // Activer l'item dans la liste
    document.querySelectorAll('#users-conv-list .conv-item, .room-nav-item').forEach(el => el.classList.remove('active'));
    const convItem = document.querySelector(`#users-conv-list .conv-item[data-uid="${uid}"]`);
    if (convItem) convItem.classList.add('active');
    switchRoom(dmKey);
  }
  else if (action === 'scroll-msg') {
    const msgId = item.dataset.msgid;
    if (msgId) scrollToMsgHighlight(msgId);
  }
  else if (action === 'open-room') {
    const roomKey = item.dataset.room;
    const msgId   = item.dataset.msgid;
    // Naviguer vers la room
    document.querySelectorAll('#users-conv-list .conv-item, .room-nav-item').forEach(el => el.classList.remove('active'));
    const roomItem = document.querySelector(`.room-nav-item[data-room="${roomKey}"]`);
    if (roomItem) roomItem.classList.add('active');
    const isDM = roomKey.startsWith('dm:');
    if (isDM) {
      const otherUid = roomKey.replace('dm:', '').split('_').find(p => p !== me.uid) || '';
      const convItem = document.querySelector(`#users-conv-list .conv-item[data-uid="${otherUid}"]`);
      if (convItem) convItem.classList.add('active');
    }
    switchRoom(roomKey);
    // Scroller vers le message après chargement (délai pour laisser Firebase charger)
    if (msgId) {
      setTimeout(() => scrollToMsgHighlight(msgId), 900);
    }
  }
}

// Scroller + surligner un message
function scrollToMsgHighlight(msgId) {
  const el = document.getElementById(`msg-${msgId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('msg-search-highlight');
  setTimeout(() => el.classList.remove('msg-search-highlight'), 2200);
}

// Surligner le terme trouvé dans le texte
function highlightMatch(html, query) {
  if (!query) return html;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="gsearch-mark">$1</mark>');
}
