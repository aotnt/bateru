const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'betteryou_secret_key_2024_xK9mP2vL';
const DB_PATH = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());

// ─── Mutex Write Lock ───────────────────────────────────────
let writeLock = Promise.resolve();
function acquireLock() {
  let release;
  const newLock = new Promise((resolve) => { release = resolve; });
  const prevLock = writeLock;
  writeLock = newLock;
  return prevLock.then(() => release);
}

function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(raw);
    if (!db.journal) db.journal = [];
    if (!db.planner) db.planner = [];
    if (!db.events) db.events = [];
    if (!db.goals) db.goals = [];
    if (!db.notes) db.notes = [];
    if (!db.pomodoro_sessions) db.pomodoro_sessions = [];
    if (!db.yt_playlists) db.yt_playlists = [];
    if (!db.yt_videos) db.yt_videos = [];
    if (!db.yt_notes) db.yt_notes = [];
    return db;
  } catch (e) {
    return { users: [], habits: [], logs: [], journal: [], planner: [], events: [], goals: [], notes: [], pomodoro_sessions: [], yt_playlists: [], yt_videos: [], yt_notes: [] };
  }
}

async function writeDB(data) {
  const release = await acquireLock();
  try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8'); }
  finally { release(); }
}

// ─── YouTube ID Extraction Helper ───────────────────────────
function extractYouTubeId(url) {
  const regex = /(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// ─── Auth Middleware ─────────────────────────────────────────
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied.' });
  try { const decoded = jwt.verify(token, JWT_SECRET); req.userId = decoded.userId; next(); }
  catch (e) { return res.status(401).json({ error: 'Invalid or expired token.' }); }
}

// ═══ AUTH ROUTES ═══════════════════════════════════════════
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ chars.' });
    const db = readDB();
    if (db.users.find(u => u.email === email.toLowerCase().trim()))
      return res.status(409).json({ error: 'Email already registered.' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = { id: uuidv4(), name: name.trim(), email: email.toLowerCase().trim(), passwordHash, createdAt: new Date().toISOString() };
    db.users.push(user);
    await writeDB(db);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    const db = readDB();
    const user = db.users.find(u => u.email === email.toLowerCase().trim());
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: 'Invalid credentials.' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ HABIT ROUTES ══════════════════════════════════════════
app.get('/api/habits', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.habits.filter(h => h.userId === req.userId && !h.isArchived));
});

app.post('/api/habits', authenticateToken, async (req, res) => {
  try {
    const { title, type, icon, category } = req.body;
    if (!title || !type) return res.status(400).json({ error: 'Title and type required.' });
    if (!['positive', 'negative'].includes(type)) return res.status(400).json({ error: 'Invalid type.' });
    const db = readDB();
    const habit = { id: uuidv4(), userId: req.userId, title: title.trim(), type, icon: icon || '🎯', category: category || 'أخرى', createdAt: new Date().toISOString(), isArchived: false };
    db.habits.push(habit);
    await writeDB(db);
    res.status(201).json(habit);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.put('/api/habits/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.habits.findIndex(h => h.id === req.params.id && h.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    const { title, type, icon, category, isArchived } = req.body;
    if (title) db.habits[idx].title = title.trim();
    if (type && ['positive', 'negative'].includes(type)) db.habits[idx].type = type;
    if (icon) db.habits[idx].icon = icon;
    if (category) db.habits[idx].category = category;
    if (typeof isArchived === 'boolean') db.habits[idx].isArchived = isArchived;
    await writeDB(db);
    res.json(db.habits[idx]);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.delete('/api/habits/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.habits.findIndex(h => h.id === req.params.id && h.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    db.habits.splice(idx, 1);
    db.logs = db.logs.filter(l => l.habitId !== req.params.id);
    await writeDB(db);
    res.json({ message: 'Deleted.' });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ LOG ROUTES ════════════════════════════════════════════
app.get('/api/logs', authenticateToken, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date required.' });
  const db = readDB();
  res.json(db.logs.filter(l => l.userId === req.userId && l.date === date));
});

app.post('/api/logs', authenticateToken, async (req, res) => {
  try {
    const { habitId, date, status } = req.body;
    if (!habitId || !date || !status) return res.status(400).json({ error: 'habitId, date, status required.' });
    if (!['done', 'missed', 'resisted', 'failed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const db = readDB();
    if (!db.habits.find(h => h.id === habitId && h.userId === req.userId)) return res.status(404).json({ error: 'Habit not found.' });
    const ei = db.logs.findIndex(l => l.habitId === habitId && l.userId === req.userId && l.date === date);
    let log;
    if (ei !== -1) { db.logs[ei].status = status; log = db.logs[ei]; }
    else { log = { id: uuidv4(), habitId, userId: req.userId, date, status }; db.logs.push(log); }
    await writeDB(db);
    res.json(log);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ ANALYTICS ═════════════════════════════════════════════
app.get('/api/analytics', authenticateToken, (req, res) => {
  const db = readDB();
  const userHabits = db.habits.filter(h => h.userId === req.userId && !h.isArchived);
  const userLogs = db.logs.filter(l => l.userId === req.userId);
  const today = new Date().toISOString().split('T')[0];
  const totalHabits = userHabits.length;
  const todayLogs = userLogs.filter(l => l.date === today);
  let successCount = 0;
  todayLogs.forEach(l => {
    const h = userHabits.find(hb => hb.id === l.habitId);
    if (!h) return;
    if ((h.type === 'positive' && l.status === 'done') || (h.type === 'negative' && l.status === 'resisted')) successCount++;
  });
  const todayScore = totalHabits > 0 ? Math.round((successCount / totalHabits) * 100) : 0;
  const weeklyData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const dl = userLogs.filter(l => l.date === ds);
    let ds2 = 0;
    dl.forEach(l => { const h = userHabits.find(hb => hb.id === l.habitId); if (!h) return; if ((h.type === 'positive' && l.status === 'done') || (h.type === 'negative' && l.status === 'resisted')) ds2++; });
    const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    weeklyData.push({ date: ds, dayName: dayNames[d.getDay()], score: totalHabits > 0 ? Math.round((ds2 / totalHabits) * 100) : 0 });
  }
  const streaks = {};
  userHabits.forEach(habit => {
    let streak = 0;
    const ss = habit.type === 'positive' ? 'done' : 'resisted';
    for (let i = 1; i <= 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const log = userLogs.find(l => l.habitId === habit.id && l.date === ds);
      if (log && log.status === ss) streak++;
      else if (log && (log.status === 'missed' || log.status === 'failed')) break;
      else break;
    }
    const tl = userLogs.find(l => l.habitId === habit.id && l.date === today);
    if (tl && tl.status === ss) streak++;
    if (tl && (tl.status === 'missed' || tl.status === 'failed')) streak = 0;
    streaks[habit.id] = streak;
  });
  const successRates = {};
  userHabits.forEach(h => {
    const hl = userLogs.filter(l => l.habitId === h.id);
    if (!hl.length) { successRates[h.id] = 0; return; }
    const ss = h.type === 'positive' ? 'done' : 'resisted';
    successRates[h.id] = Math.round((hl.filter(l => l.status === ss).length / hl.length) * 100);
  });
  res.json({ todayScore, weeklyData, streaks, successRates, totalHabits, completedToday: successCount });
});

app.get('/api/analytics/calendar', authenticateToken, (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'Month required.' });
  const db = readDB();
  const userHabits = db.habits.filter(h => h.userId === req.userId && !h.isArchived);
  const userLogs = db.logs.filter(l => l.userId === req.userId);
  const totalHabits = userHabits.length;
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const calendar = {};
  for (let day = 1; day <= daysInMonth; day++) {
    const ds = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dl = userLogs.filter(l => l.date === ds);
    if (!dl.length) { calendar[ds] = null; continue; }
    let s = 0;
    dl.forEach(l => { const h = userHabits.find(hb => hb.id === l.habitId); if (!h) return; if ((h.type === 'positive' && l.status === 'done') || (h.type === 'negative' && l.status === 'resisted')) s++; });
    calendar[ds] = totalHabits > 0 ? Math.round((s / totalHabits) * 100) : 0;
  }
  res.json(calendar);
});

// ═══ JOURNAL ROUTES ════════════════════════════════════════
app.get('/api/journal', authenticateToken, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date required.' });
  const db = readDB();
  const entry = db.journal.find(j => j.userId === req.userId && j.date === date);
  res.json(entry || null);
});

app.post('/api/journal', authenticateToken, async (req, res) => {
  try {
    const { date, content, mood } = req.body;
    if (!date) return res.status(400).json({ error: 'Date required.' });
    const db = readDB();
    const ei = db.journal.findIndex(j => j.userId === req.userId && j.date === date);
    let entry;
    if (ei !== -1) {
      if (content !== undefined) db.journal[ei].content = content;
      if (mood !== undefined) db.journal[ei].mood = mood;
      db.journal[ei].updatedAt = new Date().toISOString();
      entry = db.journal[ei];
    } else {
      entry = { id: uuidv4(), userId: req.userId, date, content: content || '', mood: mood || 3, updatedAt: new Date().toISOString() };
      db.journal.push(entry);
    }
    await writeDB(db);
    res.json(entry);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ PLANNER ROUTES ════════════════════════════════════════
app.get('/api/planner', authenticateToken, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date required.' });
  const db = readDB();
  const plan = db.planner.find(p => p.userId === req.userId && p.date === date);
  res.json(plan || { date, blocks: [] });
});

app.post('/api/planner', authenticateToken, async (req, res) => {
  try {
    const { date, blocks } = req.body;
    if (!date) return res.status(400).json({ error: 'Date required.' });
    const db = readDB();
    const ei = db.planner.findIndex(p => p.userId === req.userId && p.date === date);
    const safeBlocks = (blocks || []).map(b => ({ id: b.id || uuidv4(), startTime: b.startTime, endTime: b.endTime, title: b.title, color: b.color || '#f97316', completed: !!b.completed }));
    let plan;
    if (ei !== -1) { db.planner[ei].blocks = safeBlocks; plan = db.planner[ei]; }
    else { plan = { id: uuidv4(), userId: req.userId, date, blocks: safeBlocks }; db.planner.push(plan); }
    await writeDB(db);
    res.json(plan);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ EVENTS ROUTES ═════════════════════════════════════════
app.get('/api/events', authenticateToken, (req, res) => {
  const { month } = req.query;
  const db = readDB();
  let events = db.events.filter(e => e.userId === req.userId);
  if (month) events = events.filter(e => e.date.startsWith(month));
  res.json(events);
});

app.post('/api/events', authenticateToken, async (req, res) => {
  try {
    const { date, title, color, time, note } = req.body;
    if (!date || !title) return res.status(400).json({ error: 'Date and title required.' });
    const db = readDB();
    const event = { id: uuidv4(), userId: req.userId, date, title, color: color || '#f97316', time: time || '', note: note || '' };
    db.events.push(event);
    await writeDB(db);
    res.status(201).json(event);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.delete('/api/events/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.events.findIndex(e => e.id === req.params.id && e.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    db.events.splice(idx, 1);
    await writeDB(db);
    res.json({ message: 'Deleted.' });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ WEEKLY GOALS ROUTES ═══════════════════════════════════
app.get('/api/goals', authenticateToken, (req, res) => {
  const { weekStart } = req.query;
  if (!weekStart) return res.status(400).json({ error: 'weekStart required.' });
  const db = readDB();
  const goal = db.goals.find(g => g.userId === req.userId && g.weekStart === weekStart);
  res.json(goal || { weekStart, items: [] });
});

app.post('/api/goals', authenticateToken, async (req, res) => {
  try {
    const { weekStart, items } = req.body;
    if (!weekStart) return res.status(400).json({ error: 'weekStart required.' });
    const db = readDB();
    const ei = db.goals.findIndex(g => g.userId === req.userId && g.weekStart === weekStart);
    const safeItems = (items || []).map(it => ({ id: it.id || uuidv4(), text: it.text, completed: !!it.completed }));
    let goal;
    if (ei !== -1) { db.goals[ei].items = safeItems; goal = db.goals[ei]; }
    else { goal = { id: uuidv4(), userId: req.userId, weekStart, items: safeItems }; db.goals.push(goal); }
    await writeDB(db);
    res.json(goal);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ NOTES ROUTES ══════════════════════════════════════════
app.get('/api/notes', authenticateToken, (req, res) => {
  const db = readDB();
  const notes = db.notes.filter(n => n.userId === req.userId).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(notes);
});

app.post('/api/notes', authenticateToken, async (req, res) => {
  try {
    const { title, content, color } = req.body;
    const db = readDB();
    const note = { id: uuidv4(), userId: req.userId, title: title || '', content: content || '', color: color || '#fff4ed', pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.notes.push(note);
    await writeDB(db);
    res.status(201).json(note);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.put('/api/notes/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.notes.findIndex(n => n.id === req.params.id && n.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    const { title, content, color, pinned } = req.body;
    if (title !== undefined) db.notes[idx].title = title;
    if (content !== undefined) db.notes[idx].content = content;
    if (color !== undefined) db.notes[idx].color = color;
    if (typeof pinned === 'boolean') db.notes[idx].pinned = pinned;
    db.notes[idx].updatedAt = new Date().toISOString();
    await writeDB(db);
    res.json(db.notes[idx]);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.notes.findIndex(n => n.id === req.params.id && n.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    db.notes.splice(idx, 1);
    await writeDB(db);
    res.json({ message: 'Deleted.' });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ POMODORO ROUTES ═══════════════════════════════════════
app.post('/api/pomodoro', authenticateToken, async (req, res) => {
  try {
    const { date, focusMinutes, cycles, taskLabel } = req.body;
    const db = readDB();
    const session = { id: uuidv4(), userId: req.userId, date: date || new Date().toISOString().split('T')[0], focusMinutes: focusMinutes || 25, cycles: cycles || 1, taskLabel: taskLabel || '', completedAt: new Date().toISOString() };
    db.pomodoro_sessions.push(session);
    await writeDB(db);
    res.status(201).json(session);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.get('/api/pomodoro/stats', authenticateToken, (req, res) => {
  const db = readDB();
  const sessions = db.pomodoro_sessions.filter(s => s.userId === req.userId);
  const today = new Date().toISOString().split('T')[0];
  const todaySessions = sessions.filter(s => s.date === today);
  const todayCycles = todaySessions.reduce((sum, s) => sum + (s.cycles || 1), 0);
  const todayFocusMinutes = todaySessions.reduce((sum, s) => sum + (s.focusMinutes || 0), 0);
  const d = new Date(); const weekAgo = new Date(d); weekAgo.setDate(d.getDate() - 7);
  const weekTotal = sessions.filter(s => new Date(s.date) >= weekAgo).reduce((sum, s) => sum + (s.cycles || 1), 0);
  res.json({ todayCycles, todayFocusMinutes, weekTotal });
});

// ═══ CALENDAR ENRICHMENT ═══════════════════════════════════
app.get('/api/calendar/enrichment', authenticateToken, (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'Month required.' });
  const db = readDB();
  const moods = {};
  db.journal.filter(j => j.userId === req.userId && j.date.startsWith(month)).forEach(j => { moods[j.date] = j.mood; });
  const eventDays = {};
  db.events.filter(e => e.userId === req.userId && e.date.startsWith(month)).forEach(e => { eventDays[e.date] = true; });
  const plannerDays = {};
  db.planner.filter(p => p.userId === req.userId && p.date.startsWith(month) && p.blocks.length > 0).forEach(p => { plannerDays[p.date] = true; });
  const videoDays = {};
  db.yt_videos.filter(v => v.userId === req.userId && v.watched && v.watchedAt && v.watchedAt.startsWith(month)).forEach(v => { videoDays[v.watchedAt.split('T')[0]] = true; });
  res.json({ moods, eventDays, plannerDays, videoDays });
});

// ═══ UPCOMING EVENTS ════════════════════════════════════════
app.get('/api/events/upcoming', authenticateToken, (req, res) => {
  const db = readDB();
  const today = new Date().toISOString().split('T')[0];
  const upcoming = db.events.filter(e => e.userId === req.userId && e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  res.json(upcoming);
});

// ═══ YOUTUBE PLAYLISTS ═════════════════════════════════════
app.get('/api/yt/playlists', authenticateToken, (req, res) => {
  const db = readDB();
  const playlists = db.yt_playlists.filter(p => p.userId === req.userId).map(p => {
    const vids = db.yt_videos.filter(v => v.userId === req.userId && v.playlistId === p.id);
    return { ...p, videoCount: vids.length, watchedCount: vids.filter(v => v.watched).length };
  });
  res.json(playlists);
});

app.post('/api/yt/playlists', authenticateToken, async (req, res) => {
  try {
    const { title, description, playlistUrl, color, icon } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required.' });
    const db = readDB();
    const pl = { id: uuidv4(), userId: req.userId, title: title.trim(), description: description || '', playlistUrl: playlistUrl || '', color: color || '#f97316', icon: icon || '📚', createdAt: new Date().toISOString() };
    db.yt_playlists.push(pl);
    await writeDB(db);
    res.status(201).json({ ...pl, videoCount: 0, watchedCount: 0 });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.put('/api/yt/playlists/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.yt_playlists.findIndex(p => p.id === req.params.id && p.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    const { title, description, playlistUrl, color, icon } = req.body;
    if (title !== undefined) db.yt_playlists[idx].title = title.trim();
    if (description !== undefined) db.yt_playlists[idx].description = description;
    if (playlistUrl !== undefined) db.yt_playlists[idx].playlistUrl = playlistUrl;
    if (color !== undefined) db.yt_playlists[idx].color = color;
    if (icon !== undefined) db.yt_playlists[idx].icon = icon;
    await writeDB(db);
    const vids = db.yt_videos.filter(v => v.userId === req.userId && v.playlistId === req.params.id);
    res.json({ ...db.yt_playlists[idx], videoCount: vids.length, watchedCount: vids.filter(v => v.watched).length });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.delete('/api/yt/playlists/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.yt_playlists.findIndex(p => p.id === req.params.id && p.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    db.yt_playlists.splice(idx, 1);
    const videoIds = db.yt_videos.filter(v => v.playlistId === req.params.id && v.userId === req.userId).map(v => v.id);
    db.yt_videos = db.yt_videos.filter(v => !(v.playlistId === req.params.id && v.userId === req.userId));
    db.yt_notes = db.yt_notes.filter(n => !videoIds.includes(n.videoId));
    await writeDB(db);
    res.json({ message: 'Deleted.' });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ YOUTUBE VIDEOS ════════════════════════════════════════
app.get('/api/yt/videos', authenticateToken, (req, res) => {
  const { playlistId } = req.query;
  const db = readDB();
  let vids;
  if (playlistId) {
    vids = db.yt_videos.filter(v => v.userId === req.userId && v.playlistId === playlistId).sort((a, b) => (a.order || 0) - (b.order || 0));
  } else {
    vids = db.yt_videos.filter(v => v.userId === req.userId).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  const noteCounts = {};
  vids.forEach(v => { noteCounts[v.id] = db.yt_notes.filter(n => n.videoId === v.id).length; });
  res.json(vids.map(v => ({ ...v, noteCount: noteCounts[v.id] || 0 })));
});

app.get('/api/yt/videos/standalone', authenticateToken, (req, res) => {
  const db = readDB();
  const vids = db.yt_videos.filter(v => v.userId === req.userId && !v.playlistId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const noteCounts = {};
  vids.forEach(v => { noteCounts[v.id] = db.yt_notes.filter(n => n.videoId === v.id).length; });
  res.json(vids.map(v => ({ ...v, noteCount: noteCounts[v.id] || 0 })));
});

app.post('/api/yt/videos', authenticateToken, async (req, res) => {
  try {
    const { playlistId, title, youtubeUrl, duration, order } = req.body;
    if (!youtubeUrl) return res.status(400).json({ error: 'YouTube URL required.' });
    const videoId = extractYouTubeId(youtubeUrl);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL.' });
    const db = readDB();
    if (playlistId) {
      const pl = db.yt_playlists.find(p => p.id === playlistId && p.userId === req.userId);
      if (!pl) return res.status(404).json({ error: 'Playlist not found.' });
    }
    const existingCount = db.yt_videos.filter(v => v.userId === req.userId && v.playlistId === (playlistId || null)).length;
    const vid = { id: uuidv4(), userId: req.userId, playlistId: playlistId || null, title: (title || '').trim() || 'فيديو بدون عنوان', youtubeUrl, videoId, duration: duration || '', order: order !== undefined ? order : existingCount, watched: false, watchedAt: null, linkedToHabit: null, linkedToGoal: null, createdAt: new Date().toISOString() };
    db.yt_videos.push(vid);
    await writeDB(db);
    res.status(201).json({ ...vid, noteCount: 0 });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.put('/api/yt/videos/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.yt_videos.findIndex(v => v.id === req.params.id && v.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    const { title, watched, order, linkedToHabit, linkedToGoal, playlistId, youtubeUrl, duration } = req.body;
    if (title !== undefined) db.yt_videos[idx].title = title.trim();
    if (typeof watched === 'boolean') { db.yt_videos[idx].watched = watched; db.yt_videos[idx].watchedAt = watched ? new Date().toISOString() : null; }
    if (order !== undefined) db.yt_videos[idx].order = order;
    if (linkedToHabit !== undefined) db.yt_videos[idx].linkedToHabit = linkedToHabit;
    if (linkedToGoal !== undefined) db.yt_videos[idx].linkedToGoal = linkedToGoal;
    if (playlistId !== undefined) db.yt_videos[idx].playlistId = playlistId;
    if (youtubeUrl !== undefined) { db.yt_videos[idx].youtubeUrl = youtubeUrl; const vid = extractYouTubeId(youtubeUrl); if (vid) db.yt_videos[idx].videoId = vid; }
    if (duration !== undefined) db.yt_videos[idx].duration = duration;
    await writeDB(db);
    const nc = db.yt_notes.filter(n => n.videoId === req.params.id).length;
    res.json({ ...db.yt_videos[idx], noteCount: nc });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.delete('/api/yt/videos/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.yt_videos.findIndex(v => v.id === req.params.id && v.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    db.yt_videos.splice(idx, 1);
    db.yt_notes = db.yt_notes.filter(n => n.videoId !== req.params.id);
    await writeDB(db);
    res.json({ message: 'Deleted.' });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.post('/api/yt/videos/:id/watch', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.yt_videos.findIndex(v => v.id === req.params.id && v.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    db.yt_videos[idx].watched = !db.yt_videos[idx].watched;
    db.yt_videos[idx].watchedAt = db.yt_videos[idx].watched ? new Date().toISOString() : null;
    await writeDB(db);
    res.json(db.yt_videos[idx]);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.post('/api/yt/videos/reorder', authenticateToken, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required.' });
    const db = readDB();
    items.forEach(({ id, order }) => {
      const idx = db.yt_videos.findIndex(v => v.id === id && v.userId === req.userId);
      if (idx !== -1) db.yt_videos[idx].order = order;
    });
    await writeDB(db);
    res.json({ message: 'Reordered.' });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ YOUTUBE NOTES ═════════════════════════════════════════
app.get('/api/yt/notes/:videoId', authenticateToken, (req, res) => {
  const db = readDB();
  const vid = db.yt_videos.find(v => v.id === req.params.videoId && v.userId === req.userId);
  if (!vid) return res.status(404).json({ error: 'Video not found.' });
  const notes = db.yt_notes.filter(n => n.videoId === req.params.videoId && n.userId === req.userId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json(notes);
});

app.post('/api/yt/notes', authenticateToken, async (req, res) => {
  try {
    const { videoId, timestamp, content } = req.body;
    if (!videoId || !content) return res.status(400).json({ error: 'videoId and content required.' });
    const db = readDB();
    const vid = db.yt_videos.find(v => v.id === videoId && v.userId === req.userId);
    if (!vid) return res.status(404).json({ error: 'Video not found.' });
    const note = { id: uuidv4(), userId: req.userId, videoId, timestamp: timestamp || '', content: content.trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.yt_notes.push(note);
    await writeDB(db);
    res.status(201).json(note);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.put('/api/yt/notes/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.yt_notes.findIndex(n => n.id === req.params.id && n.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    const { timestamp, content } = req.body;
    if (timestamp !== undefined) db.yt_notes[idx].timestamp = timestamp;
    if (content !== undefined) db.yt_notes[idx].content = content.trim();
    db.yt_notes[idx].updatedAt = new Date().toISOString();
    await writeDB(db);
    res.json(db.yt_notes[idx]);
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.delete('/api/yt/notes/:id', authenticateToken, async (req, res) => {
  try {
    const db = readDB();
    const idx = db.yt_notes.findIndex(n => n.id === req.params.id && n.userId === req.userId);
    if (idx === -1) return res.status(404).json({ error: 'Not found.' });
    db.yt_notes.splice(idx, 1);
    await writeDB(db);
    res.json({ message: 'Deleted.' });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

// ═══ YOUTUBE STATS ═════════════════════════════════════════
app.get('/api/yt/stats', authenticateToken, (req, res) => {
  const db = readDB();
  const playlists = db.yt_playlists.filter(p => p.userId === req.userId);
  const videos = db.yt_videos.filter(v => v.userId === req.userId);
  const watched = videos.filter(v => v.watched);
  const notes = db.yt_notes.filter(n => n.userId === req.userId);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const videosThisWeek = watched.filter(v => v.watchedAt && new Date(v.watchedAt) >= weekAgo).length;
  res.json({
    totalPlaylists: playlists.length,
    totalVideos: videos.length,
    watchedVideos: watched.length,
    watchedPercent: videos.length > 0 ? Math.round((watched.length / videos.length) * 100) : 0,
    videosThisWeek,
    totalNotes: notes.length
  });
});

// ═══ IMPORT YOUTUBE PLAYLIST ═══════════════════════════════
app.post('/api/yt/import-playlist', authenticateToken, async (req, res) => {
  try {
    const { playlistUrl, title } = req.body;
    if (!playlistUrl) return res.status(400).json({ error: 'Playlist URL required.' });
    
    // Extract playlist ID from URL
    const plMatch = playlistUrl.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (!plMatch) return res.status(400).json({ error: 'Invalid playlist URL. Must contain ?list=...' });
    const plId = plMatch[1];
    
    // Fetch playlist page to extract video IDs
    const https = require('https');
    const fetchPage = (url) => new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' } }, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve(data));
      }).on('error', reject);
    });
    
    const html = await fetchPage(`https://www.youtube.com/playlist?list=${plId}`);
    
    // Extract video IDs from the page
    const videoIdRegex = /\"videoId\":\"([a-zA-Z0-9_-]{11})\"/g;
    const titleRegex = /\"title\":\{\"runs\":\[\{\"text\":\"(.*?)\"\}\]/g;
    const videoIds = [];
    const titles = [];
    let match;
    
    while ((match = videoIdRegex.exec(html)) !== null) {
      if (!videoIds.includes(match[1])) videoIds.push(match[1]);
    }
    while ((match = titleRegex.exec(html)) !== null) {
      titles.push(match[1]);
    }
    
    if (!videoIds.length) return res.status(400).json({ error: 'Could not find videos in this playlist. Try adding videos manually.' });
    
    const db = readDB();
    
    // Create the playlist
    const playlist = {
      id: uuidv4(), userId: req.userId,
      title: (title || '').trim() || 'قائمة مستوردة',
      description: `Imported from YouTube (${videoIds.length} videos)`,
      playlistUrl, color: '#f97316', icon: '📺',
      createdAt: new Date().toISOString()
    };
    db.yt_playlists.push(playlist);
    
    // Add each video
    const addedVideos = [];
    videoIds.forEach((vid, i) => {
      const video = {
        id: uuidv4(), userId: req.userId, playlistId: playlist.id,
        title: titles[i] || `Video ${i + 1}`,
        youtubeUrl: `https://www.youtube.com/watch?v=${vid}`,
        videoId: vid, duration: '', order: i,
        watched: false, watchedAt: null,
        linkedToHabit: null, linkedToGoal: null,
        createdAt: new Date().toISOString()
      };
      db.yt_videos.push(video);
      addedVideos.push(video);
    });
    
    await writeDB(db);
    res.status(201).json({
      playlist: { ...playlist, videoCount: addedVideos.length, watchedCount: 0 },
      videosAdded: addedVideos.length
    });
  } catch (e) {
    console.error('Import error:', e.message);
    res.status(500).json({ error: 'Failed to import playlist. Try adding videos manually.' });
  }
});

// ═══ Serve Frontend ═════════════════════════════════════════
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.listen(PORT, () => { console.log(`🚀 BetterYou server running at http://localhost:${PORT}`); });
