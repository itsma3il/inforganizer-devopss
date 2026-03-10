'use strict';

const path     = require('path');
const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const db       = require('./database');
const { signToken, authMiddleware } = require('./auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'client')));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function now() { return new Date().toISOString(); }

// Verify a note belongs to the requesting user
function getOwnedNote(noteId, userId) {
    const note = db.prepare('SELECT * FROM info_notes WHERE id = ?').get(noteId);
    if (!note || note.user_id !== userId) return null;
    return note;
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const stmt = db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?,?,?)');
    const result = stmt.run(email.toLowerCase(), hash, now());
    const userId = result.lastInsertRowid;

    // Create a default note for the new user
    const noteResult = db.prepare('INSERT INTO info_notes (user_id, name, created_at, updated_at) VALUES (?,?,?,?)')
        .run(userId, 'My Application', now(), now());

    const token = signToken(userId);
    res.status(201).json({ token, user: { id: userId, email: email.toLowerCase() }, defaultNoteId: noteResult.lastInsertRowid });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

// ─── Notes (CRUD) ─────────────────────────────────────────────────────────────
app.get('/api/notes', authMiddleware, (req, res) => {
    const notes = db.prepare('SELECT * FROM info_notes WHERE user_id = ? ORDER BY created_at ASC').all(req.userId);
    res.json(notes);
});

app.post('/api/notes', authMiddleware, (req, res) => {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Note name required' });
    const result = db.prepare('INSERT INTO info_notes (user_id, name, created_at, updated_at) VALUES (?,?,?,?)')
        .run(req.userId, name.trim(), now(), now());
    const note = db.prepare('SELECT * FROM info_notes WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(note);
});

app.put('/api/notes/:id', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Note name required' });
    db.prepare('UPDATE info_notes SET name = ?, updated_at = ? WHERE id = ?').run(name.trim(), now(), note.id);
    res.json({ ...note, name: name.trim() });
});

app.delete('/api/notes/:id', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    // Prevent deleting the last note
    const count = db.prepare('SELECT COUNT(*) as n FROM info_notes WHERE user_id = ?').get(req.userId).n;
    if (count <= 1) return res.status(400).json({ error: 'Cannot delete your only note' });
    db.prepare('DELETE FROM info_notes WHERE id = ?').run(note.id);
    res.json({ success: true });
});

// ─── Custom Fields ────────────────────────────────────────────────────────────
app.get('/api/notes/:id/fields', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const fields = db.prepare('SELECT * FROM custom_fields WHERE note_id = ? ORDER BY section, position ASC').all(note.id);
    res.json(fields);
});

app.post('/api/notes/:id/fields', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const { label, section } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: 'Field label required' });
    const fieldKey = `cf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const maxPos = db.prepare('SELECT MAX(position) as m FROM custom_fields WHERE note_id = ? AND section = ?').get(note.id, section || 'custom');
    const position = (maxPos.m ?? -1) + 1;
    const result = db.prepare('INSERT INTO custom_fields (note_id, field_key, label, section, position) VALUES (?,?,?,?,?)')
        .run(note.id, fieldKey, label.trim(), section || 'custom', position);
    const field = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(field);
});

app.put('/api/notes/:id/fields/:fieldId', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const field = db.prepare('SELECT * FROM custom_fields WHERE id = ? AND note_id = ?').get(Number(req.params.fieldId), note.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });
    const { label } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: 'Field label required' });
    db.prepare('UPDATE custom_fields SET label = ? WHERE id = ?').run(label.trim(), field.id);
    res.json({ ...field, label: label.trim() });
});

app.delete('/api/notes/:id/fields/:fieldId', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const field = db.prepare('SELECT * FROM custom_fields WHERE id = ? AND note_id = ?').get(Number(req.params.fieldId), note.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });
    // Also delete the stored value for this field
    db.prepare('DELETE FROM note_field_values WHERE note_id = ? AND field_key = ?').run(note.id, field.field_key);
    db.prepare('DELETE FROM custom_fields WHERE id = ?').run(field.id);
    res.json({ success: true });
});

// ─── Note Field Values (all fields for a note) ───────────────────────────────
app.get('/api/notes/:id/data', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const rows = db.prepare('SELECT field_key, value FROM note_field_values WHERE note_id = ?').all(note.id);
    const data = {};
    rows.forEach(r => { data[r.field_key] = r.value; });
    res.json(data);
});

app.put('/api/notes/:id/data', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const data = req.body || {};
    const upsert = db.prepare('INSERT INTO note_field_values (note_id, field_key, value) VALUES (?,?,?) ON CONFLICT(note_id, field_key) DO UPDATE SET value = excluded.value');
    const del    = db.prepare('DELETE FROM note_field_values WHERE note_id = ? AND field_key = ?');
    db.transaction(() => {
        Object.entries(data).forEach(([key, val]) => {
            if (val !== null && val !== undefined && val !== '') {
                upsert.run(note.id, key, String(val));
            } else {
                del.run(note.id, key);
            }
        });
    })();
    db.prepare('UPDATE info_notes SET updated_at = ? WHERE id = ?').run(now(), note.id);
    res.json({ success: true });
});

// ─── Universities (per note) ──────────────────────────────────────────────────
app.get('/api/notes/:id/universities', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const rows = db.prepare('SELECT * FROM universities WHERE note_id = ? ORDER BY id ASC').all(note.id);
    res.json(rows.map(r => ({ id: r.id, name: r.name, type: r.type, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at })));
});

app.put('/api/notes/:id/universities', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const list = Array.isArray(req.body) ? req.body : [];
    db.transaction(() => {
        db.prepare('DELETE FROM universities WHERE note_id = ?').run(note.id);
        const stmt = db.prepare('INSERT INTO universities (note_id, name, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?)');
        list.forEach(u => stmt.run(note.id, u.name, u.type || 'CI', u.status || 'Applied', u.createdAt || now(), u.updatedAt || now()));
    })();
    res.json({ success: true, count: list.length });
});

// ─── Reminders (per user) ────────────────────────────────────────────────────
app.get('/api/reminders', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT id, text, date FROM reminders WHERE user_id = ? ORDER BY id ASC').all(req.userId);
    res.json(rows);
});

app.put('/api/reminders', authMiddleware, (req, res) => {
    const list = Array.isArray(req.body) ? req.body : [];
    db.transaction(() => {
        db.prepare('DELETE FROM reminders WHERE user_id = ?').run(req.userId);
        const stmt = db.prepare('INSERT INTO reminders (user_id, text, date) VALUES (?,?,?)');
        list.forEach(r => stmt.run(req.userId, r.text, r.date));
    })();
    res.json({ success: true, count: list.length });
});

// ─── Clear note data only ────────────────────────────────────────────────────
app.delete('/api/notes/:id/clear', authMiddleware, (req, res) => {
    const note = getOwnedNote(Number(req.params.id), req.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    db.transaction(() => {
        db.prepare('DELETE FROM note_field_values WHERE note_id = ?').run(note.id);
        db.prepare('DELETE FROM universities WHERE note_id = ?').run(note.id);
    })();
    res.json({ success: true });
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
if (require.main === module) {
    app.listen(PORT, () => console.log(`Inforganizer running on http://0.0.0.0:${PORT}`));
}

module.exports = app;
