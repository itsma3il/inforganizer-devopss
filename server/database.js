'use strict';

const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'inforganizer.db');

const dbDir = path.dirname(DB_PATH);
if (DB_PATH !== ':memory:' && !fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH === ':memory:' ? ':memory:' : DB_PATH);
console.log(`Database connected at ${DB_PATH}`);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    -- Users
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT    UNIQUE NOT NULL,
        password_hash TEXT    NOT NULL,
        created_at    TEXT    NOT NULL
    );

    -- Info Notes: each user can have multiple named profiles
    CREATE TABLE IF NOT EXISTS info_notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
    );

    -- Custom Fields: user-defined fields attached to a note + section
    CREATE TABLE IF NOT EXISTS custom_fields (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id   INTEGER NOT NULL REFERENCES info_notes(id) ON DELETE CASCADE,
        field_key TEXT    NOT NULL,
        label     TEXT    NOT NULL,
        section   TEXT    NOT NULL DEFAULT 'custom',
        position  INTEGER NOT NULL DEFAULT 0,
        UNIQUE(note_id, field_key)
    );

    -- Field Values: key-value store per note (both built-in and custom fields)
    CREATE TABLE IF NOT EXISTS note_field_values (
        note_id   INTEGER NOT NULL REFERENCES info_notes(id) ON DELETE CASCADE,
        field_key TEXT    NOT NULL,
        value     TEXT    NOT NULL,
        PRIMARY KEY (note_id, field_key)
    );

    -- Universities tracked per note
    CREATE TABLE IF NOT EXISTS universities (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id    INTEGER NOT NULL REFERENCES info_notes(id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        type       TEXT    NOT NULL DEFAULT 'CI',
        status     TEXT    NOT NULL DEFAULT 'Applied',
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
    );

    -- Reminders are per user (not per note)
    CREATE TABLE IF NOT EXISTS reminders (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text    TEXT    NOT NULL,
        date    TEXT    NOT NULL
    );
`);

module.exports = db;
