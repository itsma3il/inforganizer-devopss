'use strict';

// ─── Apply saved theme immediately (prevents flash) ──────────────────────────
(function () {
    if (localStorage.getItem('theme') === 'dark-mode') {
        document.body.classList.add('dark-mode');
    }
})();

// ─── CONSTANTS & STATE ────────────────────────────────────────────────────────
const API = '';          // same-origin — Express serves the client
let universities  = [];
let reminders     = [];
let userNotes     = [];
let currentNoteId = null;
let customFields  = [];
let noteData      = {};  // current note field values (key → value), used by search

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function debounce(fn, ms) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

// ─── API HELPER ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
    try {
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        const token = localStorage.getItem('token');
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        if (body !== undefined) opts.body = JSON.stringify(body);
        const res = await fetch(API + path, opts);
        if (res.status === 204) return {};
        return res.json();
    } catch (e) {
        console.error('API error:', e);
        return { error: 'Network error' };
    }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function showAuthPane(pane) {
    document.getElementById('loginPane').style.display  = pane === 'login'  ? '' : 'none';
    document.getElementById('signupPane').style.display = pane === 'signup' ? '' : 'none';
}

async function doLogin() {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl    = document.getElementById('loginError');
    errEl.textContent = '';
    if (!email || !password) { errEl.textContent = 'Email and password required.'; return; }
    const res = await api('POST', '/api/auth/login', { email, password });
    if (res.error) { errEl.textContent = res.error; return; }
    localStorage.setItem('token', res.token);
    await initApp();
}

async function doSignup() {
    const email    = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirm  = document.getElementById('signupConfirm').value;
    const errEl    = document.getElementById('signupError');
    errEl.textContent = '';
    if (!email || !password)          { errEl.textContent = 'Email and password required.';         return; }
    if (password !== confirm)          { errEl.textContent = 'Passwords do not match.';              return; }
    if (password.length < 6)           { errEl.textContent = 'Password must be at least 6 chars.';  return; }
    const res = await api('POST', '/api/auth/signup', { email, password });
    if (res.error) { errEl.textContent = res.error; return; }
    localStorage.setItem('token', res.token);
    await initApp();
}

function doLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('lastNoteId');
    location.reload();
}

// ─── APP INIT ─────────────────────────────────────────────────────────────────
async function initApp() {
    document.getElementById('authOverlay').style.display = 'none';

    // Load notes; create default if none exist
    await loadNotes();
    if (userNotes.length === 0) {
        await api('POST', '/api/notes', { name: 'My Application' });
        await loadNotes();
    }

    // Pick last-used note or first in list
    const lastId = Number(localStorage.getItem('lastNoteId'));
    const target = userNotes.find(n => n.id === lastId) || userNotes[0];
    currentNoteId = target.id;
    localStorage.setItem('lastNoteId', currentNoteId);
    document.getElementById('currentNoteBtn').textContent = `📒 ${target.name} ▾`;

    // Load custom fields → render → load note data (fills fields including custom ones)
    const fields = await api('GET', `/api/notes/${currentNoteId}/fields`);
    customFields = Array.isArray(fields) ? fields : [];
    renderCustomFields(customFields);
    await loadNoteData();

    // Load universities (note-scoped) and reminders (user-scoped)
    const unis = await api('GET', `/api/notes/${currentNoteId}/universities`);
    universities = Array.isArray(unis) ? unis : [];
    updateUniversityList();

    const rems = await api('GET', '/api/reminders');
    reminders = Array.isArray(rems) ? rems : [];
    updateReminderList();

    // UI
    switchTheme();
    LoadShowHideColumn();
    if (!Object.keys(noteData).length && !universities.length && !reminders.length) {
        showModal('welcomeModal');
    }
    checkReminders();
}

window.onload = async function () {
    const token = localStorage.getItem('token');
    if (!token) return; // auth overlay stays visible
    const me = await api('GET', '/api/auth/me');
    if (!me || me.error) return; // invalid token — stay on auth overlay
    await initApp();
};

// ─── DARK MODE ────────────────────────────────────────────────────────────────
const toggleButton = document.getElementById('mode-toggle');
toggleButton.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark-mode' : 'light-mode');
    toggleButton.innerHTML = isDark ? 'Light' : 'Dark';
});

function switchTheme() {
    let theme = localStorage.getItem('theme');
    if (!theme) {
        theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
            ? 'dark-mode' : 'light-mode';
        localStorage.setItem('theme', theme);
    }
    if (theme === 'dark-mode') {
        document.body.classList.add('dark-mode');
        toggleButton.innerHTML = 'Light';
    } else {
        document.body.classList.remove('dark-mode');
        toggleButton.innerHTML = 'Dark';
    }
}

// ─── ACCORDION ────────────────────────────────────────────────────────────────
document.querySelectorAll('h3').forEach(h3 => {
    h3.addEventListener('click', () => {
        const content = h3.nextElementSibling;
        if (!content) return;
        content.style.height = content.style.height === '0px'
            ? content.scrollHeight + 1 + 'px'
            : '0';
    });
});

document.getElementById('closeAll-toggle').addEventListener('click', () => {
    document.querySelectorAll('section').forEach(s => { s.style.height = '0'; });
});

// ─── MENU TOGGLE ──────────────────────────────────────────────────────────────
const menu       = document.querySelector('.menu');
const toggleMenu = document.getElementById('toggleMenu');
toggleMenu.addEventListener('click', () => {
    const isOpen = toggleMenu.innerHTML === 'Close';
    toggleMenu.innerHTML = isOpen ? 'Menu' : 'Close';
    menu.classList.toggle('menu-active', !isOpen);
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
function notif(msg) {
    const notification = document.getElementById('notif');
    const message      = document.getElementById('notif_msg');
    notification.style.opacity   = 1;
    notification.style.transform = 'translateY(0)';
    message.innerHTML = msg;
    setTimeout(() => {
        notification.style.opacity   = 0;
        notification.style.transform = 'translateY(-85px)';
    }, 1000);
}

function copyField(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    navigator.clipboard
        .writeText(field.value)
        .then(() => notif(`${field.value} copied to clipboard!`))
        .catch(err => console.error('Could not copy text:', err));
}

// ─── NOTES ────────────────────────────────────────────────────────────────────
async function loadNotes() {
    const data = await api('GET', '/api/notes');
    userNotes = Array.isArray(data) ? data : [];
    return userNotes;
}

async function createNote(event) {
    event.preventDefault();
    const nameEl = document.getElementById('newNoteName');
    const name   = nameEl.value.trim();
    if (!name) return;
    const note = await api('POST', '/api/notes', { name });
    if (note.error) { notif('Error: ' + note.error); return; }
    nameEl.value = '';
    await loadNotes();
    renderNotesList();
    await switchNote(note.id);
    notif('Note created: ' + note.name);
}

async function renameNote(id, currentName) {
    const newName = prompt('Rename note:', currentName);
    if (!newName || newName.trim() === currentName) return;
    const res = await api('PUT', `/api/notes/${id}`, { name: newName.trim() });
    if (res.error) { notif('Error: ' + res.error); return; }
    const n = userNotes.find(n => n.id === id);
    if (n) n.name = newName.trim();
    renderNotesList();
    if (id === currentNoteId) {
        document.getElementById('currentNoteBtn').textContent = `📒 ${newName.trim()} ▾`;
    }
    notif('Note renamed.');
}

async function deleteNote(id) {
    if (!confirm('Delete this note and ALL its data? This cannot be undone.')) return;
    const res = await api('DELETE', `/api/notes/${id}`);
    if (res && res.error) { notif('Error: ' + res.error); return; }
    await loadNotes();
    if (id === currentNoteId) {
        localStorage.removeItem('lastNoteId');
        if (userNotes.length > 0) {
            await switchNote(userNotes[0].id);
        } else {
            currentNoteId = null;
            clearAllFields();
            document.getElementById('currentNoteBtn').textContent = '📒 (no notes) ▾';
        }
    }
    renderNotesList();
    notif('Note deleted.');
}

async function switchNote(id) {
    currentNoteId = id;
    localStorage.setItem('lastNoteId', id);
    const note = userNotes.find(n => n.id === id);
    if (note) document.getElementById('currentNoteBtn').textContent = `📒 ${note.name} ▾`;
    clearAllFields();
    const fields = await api('GET', `/api/notes/${id}/fields`);
    customFields = Array.isArray(fields) ? fields : [];
    renderCustomFields(customFields);
    await loadNoteData();
    const unis = await api('GET', `/api/notes/${id}/universities`);
    universities = Array.isArray(unis) ? unis : [];
    updateUniversityList();
    renderNotesList();
    closeModal('notesModal');
}

function openNotesModal() {
    renderNotesList();
    showModal('notesModal');
}

function renderNotesList() {
    const ul = document.getElementById('notesList');
    if (!ul) return;
    ul.innerHTML = '';
    userNotes.forEach(note => {
        const li      = document.createElement('li');
        li.className  = note.id === currentNoteId ? 'active-note' : '';
        const eName   = escHtml(note.name);
        const eSafe   = eName.replace(/'/g, "\\'");
        li.innerHTML  =
            `<span style="flex:1;cursor:pointer" onclick="switchNote(${note.id})">${eName}</span>` +
            `<button class="notes-bar-btn" onclick="renameNote(${note.id},'${eSafe}')">✏️</button>` +
            `<button class="notes-bar-btn" onclick="deleteNote(${note.id})" style="color:#c0392b">🗑</button>`;
        ul.appendChild(li);
    });
}

// ─── CUSTOM FIELDS ────────────────────────────────────────────────────────────
function openAddFieldModal(section) {
    document.getElementById('newFieldLabel').value   = '';
    document.getElementById('newFieldSection').value = section;
    showModal('addFieldModal');
}

async function submitAddField() {
    const label   = document.getElementById('newFieldLabel').value.trim();
    const section = document.getElementById('newFieldSection').value;
    if (!label)          { notif('Please enter a field label.'); return; }
    if (!currentNoteId)  { notif('No active note.');             return; }
    const res = await api('POST', `/api/notes/${currentNoteId}/fields`, { label, section });
    if (res.error) { notif('Error: ' + res.error); return; }
    customFields.push(res);
    renderCustomFields(customFields);
    closeModal('addFieldModal');
    notif(`Field "${label}" added.`);
}

function openEditFieldModal(fieldId, currentLabel) {
    document.getElementById('editFieldId').value    = fieldId;
    document.getElementById('editFieldLabel').value = currentLabel;
    showModal('editFieldModal');
}

async function submitEditField() {
    const fieldId = Number(document.getElementById('editFieldId').value);
    const label   = document.getElementById('editFieldLabel').value.trim();
    if (!label) { notif('Label cannot be empty.'); return; }
    const res = await api('PUT', `/api/notes/${currentNoteId}/fields/${fieldId}`, { label });
    if (res.error) { notif('Error: ' + res.error); return; }
    const idx = customFields.findIndex(f => f.id === fieldId);
    if (idx !== -1) customFields[idx].label = label;
    renderCustomFields(customFields);
    closeModal('editFieldModal');
    notif('Field renamed.');
}

async function deleteCustomField(fieldId) {
    if (!confirm('Delete this custom field and its saved data?')) return;
    const res = await api('DELETE', `/api/notes/${currentNoteId}/fields/${fieldId}`);
    if (res && res.error) { notif('Error: ' + res.error); return; }
    customFields = customFields.filter(f => f.id !== fieldId);
    renderCustomFields(customFields);
    notif('Field deleted.');
}

function renderCustomFields(fields) {
    ['info', 'carte', 'bac', 'dts', 'custom'].forEach(sec => {
        const container = document.getElementById(`custom-${sec}`);
        if (!container) return;
        container.innerHTML = '';
        fields.filter(f => f.section === sec).forEach(field => {
            const fkey   = escHtml(field.field_key);
            const flabel = escHtml(field.label);
            const fval   = escHtml(noteData[field.field_key] || '');
            const fSafe  = flabel.replace(/'/g, "\\'");
            const div    = document.createElement('div');
            div.innerHTML =
                `<label for="${fkey}">${flabel}</label>` +
                `<div class="flex">` +
                `<input type="text" id="${fkey}" value="${fval}" />` +
                `<button class="copy-field-button" onclick="copyField('${fkey}')">Copy</button>` +
                `<button class="cf-action-btn" title="Rename" onclick="openEditFieldModal(${field.id},'${fSafe}')">✏️</button>` +
                `<button class="cf-action-btn" title="Delete" onclick="deleteCustomField(${field.id})" style="color:#c0392b">✕</button>` +
                `</div>`;
            container.appendChild(div);
        });
    });
}

// ─── NOTE DATA ────────────────────────────────────────────────────────────────
async function loadNoteData() {
    if (!currentNoteId) return;
    const data = await api('GET', `/api/notes/${currentNoteId}/data`);
    noteData = (data && typeof data === 'object' && !data.error) ? data : {};
    Object.entries(noteData).forEach(([key, val]) => {
        const el = document.getElementById(key);
        if (el && el.tagName === 'INPUT' && el.type !== 'file' && el.type !== 'checkbox') {
            el.value = val;
        }
    });
}

async function saveData() {
    if (!currentNoteId) { notif('No active note to save.'); return; }
    const data = {};
    // Only collect inputs inside data sections (not modals, auth, or utility forms)
    document.querySelectorAll('nav input[id], section.grid-2 input[id]').forEach(input => {
        if (input.type !== 'file' && input.type !== 'checkbox' && input.value !== '') {
            data[input.id] = input.value.trim();
        }
    });
    noteData = data;
    await api('PUT', `/api/notes/${currentNoteId}/data`, data);
    notif('Your Information has been saved!');
}

function clearAllFields() {
    document.querySelectorAll('input[id]').forEach(input => {
        if (input.type !== 'file' && input.type !== 'checkbox') input.value = '';
    });
    noteData = {};
}

async function clearAllData() {
    if (!confirm('Clear ALL data for this note? This cannot be undone.')) return;
    if (!currentNoteId) return;
    await api('DELETE', `/api/notes/${currentNoteId}/clear`);
    clearAllFields();
    notif('All data cleared for this note.');
}

document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveData();
    }
});

// ─── EXPORT / IMPORT ──────────────────────────────────────────────────────────
async function exportData() {
    if (!currentNoteId) { notif('No active note.'); return; }
    const [nd, unis, rems] = await Promise.all([
        api('GET', `/api/notes/${currentNoteId}/data`),
        api('GET', `/api/notes/${currentNoteId}/universities`),
        api('GET', '/api/reminders')
    ]);
    const a    = document.createElement('a');
    a.href     = 'data:application/json;charset=utf-8,' +
                 encodeURIComponent(JSON.stringify({ noteData: nd, universities: unis, reminders: rems, customFields }, null, 2));
    a.download = 'inforganizer_export.json';
    a.click();
}

function importData(event) {
    const importInput = document.getElementById('importData');
    // If triggered by the button (not the file input), open the file dialog
    if (event.target !== importInput) { importInput.click(); return; }
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = ''; // reset so same file can be re-imported
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const payload = JSON.parse(e.target.result);
            if (payload.noteData) {
                await api('PUT', `/api/notes/${currentNoteId}/data`, payload.noteData);
                await loadNoteData();
            }
            if (payload.universities) {
                await api('PUT', `/api/notes/${currentNoteId}/universities`, payload.universities);
                universities = payload.universities;
                updateUniversityList();
            }
            if (payload.reminders) {
                await api('PUT', '/api/reminders', payload.reminders);
                reminders = payload.reminders;
                updateReminderList();
            }
            notif('Data imported successfully!');
        } catch (err) {
            console.error('Import error:', err);
            notif('Error importing data. Please check the file format.');
        }
    };
    reader.readAsText(file);
}

// ─── UNIVERSITIES ─────────────────────────────────────────────────────────────
let editingIndex = null;
const university_form = document.getElementById('university_form');
university_form.addEventListener('submit', e => { e.preventDefault(); addUniversity(); });

function addUniversity() {
    const section          = university_form.parentElement.parentElement;
    const universityInput  = document.getElementById('university_input');
    const universityType   = document.getElementById('university_type').value;
    const universityName   = universityInput.value.trim();
    const universityStatus = document.getElementById('university_status').value;
    if (!universityName) { notif('Please enter a university name.'); return; }

    if (editingIndex !== null) {
        universities[editingIndex] = {
            ...universities[editingIndex],
            name: universityName, type: universityType, status: universityStatus,
            updatedAt: new Date().toISOString()
        };
        editingIndex = null;
        document.querySelector('button[type="submit"]').textContent = 'Add';
        notif('University updated successfully!');
    } else {
        universities.push({
            name: universityName, type: universityType, status: universityStatus,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
        section.style.height = section.scrollHeight + 15 + 'px';
        notif('University added successfully!');
    }
    updateUniversityList();
    universityInput.value = '';
    saveUniversities();
}

function deleteAllUniversities() {
    const section = university_form.parentElement.parentElement;
    if (!confirm('Are you sure you want to delete all universities?')) return;
    universities = [];
    updateUniversityList();
    saveUniversities();
    section.style.height = section.firstElementChild.scrollHeight + 'px';
    notif('All universities deleted successfully!');
}

function updateUniversityList() {
    const universityList = document.getElementById('university_list');
    universityList.innerHTML = '';
    universities.forEach((university, index) => {
        const tr = document.createElement('tr');
        if (university.status === 'Rejected') tr.classList.add('rejected');
        const createdDate   = university.createdAt ? new Date(university.createdAt) : new Date(university.updatedAt);
        const formattedDate = isNaN(createdDate) ? 'N/A' : createdDate.toLocaleDateString();
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${escHtml(university.name)}</td>
            <td>${escHtml(university.type)}</td>
            <td>${escHtml(university.status)}</td>
            <td>${formattedDate}</td>
            <td>
                <button onclick="editUniversity(${index})" class="university-crud-btn blue">Update</button>
                <button onclick="deleteUniversity(${index})" class="university-crud-btn red">Delete</button>
            </td>`;
        universityList.appendChild(tr);
    });
    LoadShowHideColumn();
}

function editUniversity(index) {
    const university = universities[index];
    document.getElementById('university_input').value  = university.name;
    document.getElementById('university_type').value   = university.type;
    document.getElementById('university_status').value = university.status;
    editingIndex = index;
    document.querySelector('button[type="submit"]').textContent = 'Update';
    document.querySelector('h3[data-i18n="afterBaccalaureate"]').scrollIntoView({ behavior: 'smooth' });
}

function deleteUniversity(index) {
    if (!confirm('Are you sure you want to delete this university?')) return;
    universities.splice(index, 1);
    updateUniversityList();
    saveUniversities();
    notif('University deleted successfully!');
}

async function saveUniversities() {
    if (!currentNoteId) return;
    await api('PUT', `/api/notes/${currentNoteId}/universities`, universities);
}

function sortUniversities(e, sortBy) {
    const sortButton = e.target;
    if (sortBy === 'name') {
        if (sortButton.textContent === 'Name ↓') {
            sortButton.textContent = 'Name ↑';
            universities.sort((a, b) => b.name.localeCompare(a.name));
        } else {
            sortButton.textContent = 'Name ↓';
            universities.sort((a, b) => a.name.localeCompare(b.name));
        }
    } else if (sortBy === 'type') {
        if (sortButton.textContent === 'Type ↓') {
            sortButton.textContent = 'Type ↑';
            universities.sort((a, b) => b.type.localeCompare(a.type));
        } else {
            sortButton.textContent = 'Type ↓';
            universities.sort((a, b) => a.type.localeCompare(b.type));
        }
    } else if (sortBy === 'status') {
        if (sortButton.textContent === 'Status ↓') {
            sortButton.textContent = 'Status ↑';
            universities.sort((a, b) => b.status.localeCompare(a.status));
        } else {
            sortButton.textContent = 'Status ↓';
            universities.sort((a, b) => a.status.localeCompare(b.status));
        }
    } else if (sortBy === 'created_at') {
        if (sortButton.textContent === 'Date ↓') {
            sortButton.textContent = 'Date ↑';
            universities.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        } else {
            sortButton.textContent = 'Date ↓';
            universities.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        }
    }
    updateUniversityList();
}

function toggleDropdown(e) {
    const dropdown = e.target.nextElementSibling;
    dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
}

const tableDropdownInputs = document.querySelectorAll('.dropdown table td input');
tableDropdownInputs.forEach((input, index) => {
    input.addEventListener('change', () => ShowHideColumn(index, input.checked));
});

function LoadShowHideColumn() {
    tableDropdownInputs.forEach((input, index) => ShowHideColumn(index, input.checked));
}

function ShowHideColumn(index, checked) {
    const table       = document.querySelector('.tableList');
    const tableHeaders = table.querySelectorAll('th');
    const tableRows    = table.querySelectorAll('tbody tr');
    tableHeaders[index].style.display = checked ? 'table-cell' : 'none';
    tableRows.forEach(row => { row.children[index].style.display = checked ? 'table-cell' : 'none'; });
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function showModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
    if (id === 'searchModal') clearSearch();
}

window.onclick = function (event) {
    document.querySelectorAll('.modal').forEach(modal => {
        if (event.target === modal) closeModal(modal.id);
    });
};

// ─── REMINDERS ────────────────────────────────────────────────────────────────
function setDefaultDateTime() {
    const reminderDate = document.getElementById('reminder_date');
    const d = new Date();
    d.setHours(d.getHours() + 5);
    reminderDate.value = d.toISOString().slice(0, 16);
}
setDefaultDateTime();

document.getElementById('reminder-btn').addEventListener('click', () => {
    showModal('reminderModal');
    document.getElementById('reminder_text').focus();
});

const reminderForm = document.getElementById('reminder_form');
const reminderDate = document.getElementById('reminder_date');
const reminderText = document.getElementById('reminder_text');

reminderForm.addEventListener('submit', e => {
    e.preventDefault();
    if (reminderText.value && reminderDate.value) {
        reminders.push({ text: reminderText.value, date: reminderDate.value });
        saveReminders();
        updateReminderList();
        notif('Reminder added successfully!');
        reminderText.value = '';
    } else {
        notif('Please enter both reminder text and date.');
    }
});

document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'BUTTON') e.target.click();
});

async function saveReminders() {
    await api('PUT', '/api/reminders', reminders);
}

function updateReminderList() {
    const reminderList = document.getElementById('reminders-container');
    reminderList.innerHTML = '';
    reminders.forEach((reminder, index) => {
        const localDate = new Date(reminder.date).toLocaleString();
        const fieldset  = document.createElement('fieldset');
        fieldset.innerHTML = `
            <legend>Reminder</legend>
            <ul class="reminder_list">
                <li>
                    ${escHtml(reminder.text)} <span>${localDate}</span>
                    <button onclick="deleteReminder(${index})" class="red">Delete</button>
                </li>
            </ul>`;
        reminderList.appendChild(fieldset);
    });
}

function editReminder(index) {
    const reminder = reminders[index];
    reminderText.value = reminder.text;
    reminderDate.value = reminder.date;
    reminders.splice(index, 1);
    saveReminders();
    updateReminderList();
    notif('Reminder edited successfully!');
}

function deleteReminder(index) {
    reminders.splice(index, 1);
    saveReminders();
    updateReminderList();
    notif('Reminder deleted successfully!');
}

function checkReminders() {
    const today = new Date().toISOString().split('T')[0];
    reminders.forEach(reminder => {
        if (reminder.date >= today) {
            notif(`Reminder: ${reminder.text}`);
            showModal('reminderModal');
        }
    });
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
document.getElementById('search-btn').addEventListener('click', () => {
    showModal('searchModal');
    document.getElementById('search_text').focus();
});

document.addEventListener('keydown', e => {
    if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        showModal('searchModal');
        document.getElementById('search_text').focus();
    }
});

const searchForm    = document.getElementById('search_form');
const searchInputEl = searchForm.firstElementChild;
const searchResults = document.getElementById('search-results');

searchInputEl.addEventListener('input', debounce(() => {
    const text = searchInputEl.value.toLowerCase();
    if (text.length > 2) searchStorage(text);
    else clearSearch();
}, 300));

searchForm.addEventListener('submit', e => e.preventDefault());

function clearSearch() { searchResults.innerHTML = ''; }

function searchStorage(searchText) {
    clearSearch();
    const universityResults = universities.filter(u =>
        [u.name, u.type, u.status].some(f => f.toLowerCase().includes(searchText))
    );
    // Search through live noteData key-value pairs
    const dataResults = Object.entries(noteData).filter(([key, val]) =>
        key.toLowerCase().includes(searchText) || String(val).toLowerCase().includes(searchText)
    );
    displayResults(universityResults, dataResults);
}

function displayResults(universityResults, dataResults) {
    const copySvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 12.9V17.1C16 20.6 14.6 22 11.1 22H6.9C3.4 22 2 20.6 2 17.1V12.9C2 9.4 3.4 8 6.9 8H11.1C14.6 8 16 9.4 16 12.9Z" stroke="#292D32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path opacity="0.4" d="M22 6.9V11.1C22 14.6 20.6 16 17.1 16H16V12.9C16 9.4 14.6 8 11.1 8H8V6.9C8 3.4 9.4 2 12.9 2H17.1C20.6 2 22 3.4 22 6.9Z" stroke="#292D32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    if (universityResults.length > 0) {
        const ul = document.createElement('ul');
        universityResults.forEach(u => {
            const li = document.createElement('li');
            li.textContent = `${u.name} - ${u.type} - ${u.status}`;
            li.style.cursor = 'pointer';
            li.classList.add('search-university');
            li.setAttribute('onclick', `highlightUniversity('${escHtml(u.name).replace(/'/g, "\\'")}')`);
            ul.appendChild(li);
        });
        searchResults.innerHTML = '<h5>Universities:</h5>';
        searchResults.appendChild(ul);
    }

    if (dataResults.length > 0) {
        const ul     = document.createElement('ul');
        const labels = Object.fromEntries([...document.querySelectorAll('label')].map(l => [l.getAttribute('for'), l]));
        let added = 0;
        dataResults.forEach(([key, val]) => {
            const label = labels[key];
            if (!label) return;
            const li = document.createElement('li');
            li.innerHTML =
                `<span>${escHtml(label.textContent.trim())} : ${escHtml(String(val))}</span>` +
                `<button class="search-result-btn" onclick="copyField('${escHtml(key)}')">${copySvg}</button>`;
            li.id = key;
            ul.appendChild(li);
            added++;
        });
        if (added > 0) {
            searchResults.innerHTML += '<h5>User Data:</h5>';
            searchResults.appendChild(ul);
        }
    }

    if (universityResults.length === 0 && dataResults.length === 0) {
        searchResults.innerHTML = '<p>No results found.</p>';
    }
}

function highlightUniversity(universityName) {
    closeModal('searchModal');
    const row = [...document.querySelectorAll('#university_list tr')].find(
        r => r.cells[1] && r.cells[1].textContent === universityName
    );
    if (row) {
        expandAccordion('application');
        setTimeout(() => {
            const y = row.getBoundingClientRect().top + window.pageYOffset
                      - window.innerHeight / 2 + row.clientHeight / 2;
            window.scrollTo({ top: y, behavior: 'smooth' });
            row.classList.add('highlight');
            setTimeout(() => row.classList.remove('highlight'), 1500);
        }, 500);
    }
}

function expandAccordion(accordionId) {
    const el = document.getElementById(accordionId);
    if (el && el.style.height === '0px') {
        el.style.height = el.scrollHeight + 1 + 'px';
    }
}
