// Integration tests — Node.js built-in test runner (Node >=20)
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

// Use in-memory DB for tests
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-for-tests-only';

let server;
let token;     // auth token shared across tests
let noteId;    // the default note created at signup

before(async () => {
    const app = require('../server/server.js');
    await new Promise(resolve => {
        server = app.listen(0, '127.0.0.1', () => resolve());
    });
});
after(() => new Promise(resolve => server.close(resolve)));

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function request(method, path, body, authToken) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            method,
            hostname: '127.0.0.1',
            port: server.address().port,
            path,
            headers: {
                'Content-Type': 'application/json',
                ...(authToken ? { 'Authorization': 'Bearer ' + authToken } : {}),
                ...(payload   ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        };
        const req = http.request(options, res => {
            let data = '';
            res.on('data', chunk => (data += chunk));
            res.on('end', () => {
                let body = null;
                try { body = JSON.parse(data); } catch { body = data; }
                resolve({ status: res.statusCode, body });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// ─── Tests ───────────────────────────────────────────────────────────────────
test('GET /api/health returns ok (no auth needed)', async () => {
    const res = await request('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
});

test('POST /api/auth/signup creates user and returns token', async () => {
    const res = await request('POST', '/api/auth/signup', {
        email: 'test@example.com',
        password: 'testpass123'
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.token, 'token should be present');
    token  = res.body.token;
    noteId = res.body.defaultNoteId;
    assert.ok(noteId, 'defaultNoteId should be present');
});

test('POST /api/auth/signup rejects duplicate email', async () => {
    const res = await request('POST', '/api/auth/signup', {
        email: 'test@example.com',
        password: 'another'
    });
    assert.equal(res.status, 409);
});

test('POST /api/auth/login returns token for valid credentials', async () => {
    const res = await request('POST', '/api/auth/login', {
        email: 'test@example.com',
        password: 'testpass123'
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
});

test('POST /api/auth/login rejects wrong password', async () => {
    const res = await request('POST', '/api/auth/login', {
        email: 'test@example.com',
        password: 'wrongpass'
    });
    assert.equal(res.status, 401);
});

test('GET /api/auth/me returns user info with valid token', async () => {
    const res = await request('GET', '/api/auth/me', null, token);
    assert.equal(res.status, 200);
    assert.equal(res.body.email, 'test@example.com');
});

test('GET /api/notes returns list with the default note', async () => {
    const res = await request('GET', '/api/notes', null, token);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 1);
    assert.ok(res.body[0].id);
    assert.ok(res.body[0].name);
    // Keep noteId in sync in case signup didn't return it
    if (!noteId) noteId = res.body[0].id;
});

test('POST /api/notes creates a new note', async () => {
    const res = await request('POST', '/api/notes', { name: 'OFPPT 2026' }, token);
    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'OFPPT 2026');
});

test('PUT /api/notes/:id renames a note', async () => {
    const res = await request('PUT', `/api/notes/${noteId}`, { name: 'Renamed Note' }, token);
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Renamed Note');
});

test('PUT /api/notes/:id/data stores and GET retrieves field values', async () => {
    const data = { nom: 'Mousdik', prenom: 'Ismail', email: 'test@example.com' };
    const put  = await request('PUT', `/api/notes/${noteId}/data`, data, token);
    assert.equal(put.status, 200);

    const get = await request('GET', `/api/notes/${noteId}/data`, null, token);
    assert.equal(get.status, 200);
    assert.equal(get.body.nom, 'Mousdik');
    assert.equal(get.body.prenom, 'Ismail');
});

test('POST /api/notes/:id/fields creates a custom field', async () => {
    const res = await request('POST', `/api/notes/${noteId}/fields`,
        { label: 'LinkedIn URL', section: 'info' }, token);
    assert.equal(res.status, 201);
    assert.equal(res.body.label, 'LinkedIn URL');
    assert.equal(res.body.section, 'info');
    assert.ok(res.body.field_key);
});

test('GET /api/notes/:id/fields returns field list', async () => {
    const res = await request('GET', `/api/notes/${noteId}/fields`, null, token);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.some(f => f.label === 'LinkedIn URL'));
});

test('PUT /api/notes/:id/universities stores and GET retrieves universities', async () => {
    const unis = [
        { name: 'ENSIAS', type: 'CI', status: 'Applied', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { name: 'INPT',   type: 'CI', status: 'Pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ];
    const put = await request('PUT', `/api/notes/${noteId}/universities`, unis, token);
    assert.equal(put.status, 200);

    const get = await request('GET', `/api/notes/${noteId}/universities`, null, token);
    assert.equal(get.status, 200);
    assert.equal(get.body.length, 2);
    assert.equal(get.body[0].name, 'ENSIAS');
});

test('PUT /api/reminders stores and GET retrieves reminders', async () => {
    const rems = [{ text: 'Submit dossier ENSIAS', date: '2026-03-15T09:00' }];
    const put  = await request('PUT', '/api/reminders', rems, token);
    assert.equal(put.status, 200);

    const get = await request('GET', '/api/reminders', null, token);
    assert.equal(get.status, 200);
    assert.equal(get.body.length, 1);
    assert.equal(get.body[0].text, 'Submit dossier ENSIAS');
});

test('DELETE /api/notes/:id/clear wipes note data only', async () => {
    const del = await request('DELETE', `/api/notes/${noteId}/clear`, null, token);
    assert.equal(del.status, 200);

    const get = await request('GET', `/api/notes/${noteId}/data`, null, token);
    assert.equal(get.status, 200);
    assert.deepEqual(get.body, {});
});

test('Protected routes reject requests without token', async () => {
    const res = await request('GET', '/api/notes');
    assert.equal(res.status, 401);
});
