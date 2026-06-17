/* =============================================
   DrumCifra — Main Application v1.2
   ============================================= */

// =============================================
// UTILITIES
// =============================================
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =============================================
// DEFAULT DATA
// =============================================
const DEFAULT_TAGS = [
  'KC', 'CX', 'HH', 'GROOVE VERSO', 'GROOVE DISCO',
  'BREAKDOWN', 'BUILD', 'BUILDING', 'BREAK',
  'CONVENTION', 'TRIBAL', 'PROGRESSIVE ROCK',
  'LEVADA ALTA', 'LEVADA FULL',
  'CX + KC', 'CX + SURDO + KC',
  'BREAK TO BUILD', 'KC + ARO', 'KC + TONS',
  'OFF', 'SAIDA'
];

const DEFAULT_SECTIONS = [
  'Intro', 'Verso', 'Verso 2', 'Verso 3', 'Verso 4',
  'Pré-Refrão', 'Pré-Refrão 2', 'Pré-Refrão 3',
  'Transição', 'Refrão', 'Refrão 2', 'Coro',
  'Ponte', 'Ponte 2', 'Solo', 'Solo 2',
  'Especial', 'Climax', 'Interlúdio', 'Interlúdio 2',
  'Outro', 'Final', 'A Capella'
];

// Default section color mapping (category → color)
// Numbered variants (e.g. "Verso 2") inherit from the base name via _getSectionColorHex
const DEFAULT_SECTION_COLORS = {
  'intro': '#5E8BFF',
  'verso': '#4ECDC4',
  'pré-refrão': '#FF6B9D',
  'transição': '#FBBF24',
  'refrão': '#FF9F0A',
  'coro': '#FB923C',
  'ponte': '#A78BFA',
  'solo': '#F472B6',
  'especial': '#10B981',
  'climax': '#EF4444',
  'interlúdio': '#8B5CF6',
  'outro': '#6B7280',
  'final': '#6B7280',
  'a capella': '#38BDF8'
};

// Section name patterns for auto-detection
const SECTION_PATTERNS = [
  /^(intro)$/i,
  /^(verso)\s*\d*$/i,
  /^(pré[- ]?refrão)\s*\d*$/i,
  /^(transição)\s*\d*$/i,
  /^(refrão)\s*\d*$/i,
  /^(coro)$/i,
  /^(ponte)\s*\d*$/i,
  /^(solo)\s*\d*$/i,
  /^(especial)$/i,
  /^(climax)$/i,
  /^(interlúdio)\s*\d*$/i,
  /^(outro)$/i,
  /^(final)$/i,
  /^(a capella)$/i
];

function isSectionName(line) {
  let trimmed = line.trim();
  if (!trimmed) return false;
  if (/^\[.+\]$/.test(trimmed)) trimmed = trimmed.slice(1, -1).trim();
  if (trimmed.endsWith(':')) trimmed = trimmed.slice(0, -1).trim();
  for (const pattern of SECTION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  const lower = trimmed.toLowerCase();
  for (const s of DEFAULT_SECTIONS) {
    if (s.toLowerCase() === lower) return true;
  }
  return false;
}

function cleanSectionName(line) {
  let trimmed = line.trim();
  if (/^\[.+\]$/.test(trimmed)) trimmed = trimmed.slice(1, -1).trim();
  if (trimmed.endsWith(':')) trimmed = trimmed.slice(0, -1).trim();
  return trimmed;
}

function parseLyricsText(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let currentSection = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (isSectionName(trimmed)) {
      if (currentSection) sections.push(currentSection);
      currentSection = { id: uid(), name: cleanSectionName(trimmed), tags: [], lines: [] };
      continue;
    }

    if (trimmed === '' && currentSection && currentSection.lines.length === 0) continue;
    if (trimmed === '' && !currentSection) continue;

    if (currentSection) {
      if (trimmed === '') {
        let nextNonEmpty = '';
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim()) { nextNonEmpty = lines[j].trim(); break; }
        }
        if (isSectionName(nextNonEmpty) || nextNonEmpty === '') continue;
      }
      currentSection.lines.push({ id: uid(), lyrics: trimmed, tags: [] });
    } else {
      currentSection = { id: uid(), name: 'Intro', tags: [], lines: [] };
      if (trimmed) currentSection.lines.push({ id: uid(), lyrics: trimmed, tags: [] });
    }
  }

  if (currentSection && currentSection.lines.length > 0) sections.push(currentSection);
  return sections;
}

// =============================================
// CLOUD SYNC (Firebase Firestore)
// =============================================
const CloudSync = {
  _syncCode: null,
  _unsubscribe: null,
  _isSyncing: false,
  _lastSyncTime: null,
  _onDataReceived: null,
  _ignoreNextSnapshot: false,

  get isAvailable() { return typeof db !== 'undefined' && db !== null; },
  get isConnected() { return this.isAvailable && !!this._syncCode; },
  get syncCode() { return this._syncCode; },

  connect(code, onDataReceived) {
    if (!this.isAvailable) return false;
    if (!code || code.trim().length < 3) return false;
    this._syncCode = code.trim().toLowerCase();
    this._onDataReceived = onDataReceived;
    localStorage.setItem('drumcifra_syncCode', this._syncCode);
    this._startListening();
    return true;
  },

  disconnect() {
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
    this._syncCode = null;
    this._onDataReceived = null;
    localStorage.removeItem('drumcifra_syncCode');
  },

  async pushData(data) {
    if (!this.isConnected || this._isSyncing) return;
    this._isSyncing = true;
    this._ignoreNextSnapshot = true;
    try {
      await db.collection('drumcifra').doc(this._syncCode).set({
        songs: data.songs || [],
        setlists: data.setlists || [],
        tags: data.tags || [],
        settings: data.settings || {},
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        version: 1
      });
      this._lastSyncTime = new Date();
    } catch (e) {
      console.error('Cloud sync push error:', e);
      this._ignoreNextSnapshot = false;
    }
    this._isSyncing = false;
  },

  async pullData() {
    if (!this.isConnected) return null;
    try {
      const doc = await db.collection('drumcifra').doc(this._syncCode).get();
      if (doc.exists) {
        this._lastSyncTime = new Date();
        return doc.data();
      }
    } catch (e) { console.error('Cloud sync pull error:', e); }
    return null;
  },

  _startListening() {
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = db.collection('drumcifra').doc(this._syncCode)
      .onSnapshot((doc) => {
        if (this._ignoreNextSnapshot) { this._ignoreNextSnapshot = false; return; }
        if (doc.exists && this._onDataReceived) {
          this._lastSyncTime = new Date();
          this._onDataReceived(doc.data());
        }
      }, (err) => { console.error('Cloud sync listener error:', err); });
  },

  restoreConnection(onDataReceived) {
    const code = localStorage.getItem('drumcifra_syncCode');
    if (code && this.isAvailable) {
      this.connect(code, onDataReceived);
      return true;
    }
    return false;
  }
};

// =============================================
// STORAGE (localStorage + File System + Auto-backup)
// =============================================
const Storage = {
  _fileHandle: null,
  _saveTimeout: null,
  _lastSavedToFile: null,
  _backupInterval: null,
  _backupMinutes: 15,
  _statusEl: null,
  _cloudSyncTimeout: null,

  _get(key) {
    try {
      const data = localStorage.getItem('drumcifra_' + key);
      return data ? JSON.parse(data) : null;
    } catch { return null; }
  },

  _set(key, value) {
    try { localStorage.setItem('drumcifra_' + key, JSON.stringify(value)); }
    catch (e) { console.error('Storage error:', e); }
    this._scheduleFileSave();
    this._scheduleCloudSync();
  },

  _set_local(key, value) {
    try { localStorage.setItem('drumcifra_' + key, JSON.stringify(value)); }
    catch (e) { console.error('Storage error:', e); }
  },

  getSongs() { return this._get('songs') || []; },
  saveSongs(songs) { this._set('songs', songs); },
  getSetlists() { return this._get('setlists') || []; },
  saveSetlists(setlists) { this._set('setlists', setlists); },
  getTags() { return this._get('tags') || [...DEFAULT_TAGS]; },
  saveTags(tags) { this._set('tags', tags); },
  getSettings() { return this._get('settings') || { scrollSpeed: 3, fontSize: 16, backupMinutes: 15 }; },
  saveSettings(settings) { this._set('settings', settings); },

  exportAll() {
    return JSON.stringify({
      songs: this.getSongs(), setlists: this.getSetlists(),
      tags: this.getTags(), settings: this.getSettings(),
      exportedAt: new Date().toISOString(), version: 1
    }, null, 2);
  },

  importAll(json) {
    const data = JSON.parse(json);
    if (data.songs) this.saveSongs(data.songs);
    if (data.setlists) this.saveSetlists(data.setlists);
    if (data.tags) this.saveTags(data.tags);
    if (data.settings) this.saveSettings(data.settings);
    return true;
  },

  get isFileSystemSupported() { return 'showSaveFilePicker' in window; },
  get isConnectedToFile() { return !!this._fileHandle; },
  get connectedFileName() { return this._fileHandle?.name || null; },

  async connectToFile() {
    if (!this.isFileSystemSupported) { alert('Seu navegador não suporta acesso direto a arquivos. Use Chrome ou Edge.'); return false; }
    try {
      this._fileHandle = await window.showSaveFilePicker({
        suggestedName: 'drumcifra-data.json',
        types: [{ description: 'DrumCifra Data', accept: { 'application/json': ['.json'] } }]
      });
      await this._writeToFile();
      this._showStatus('Conectado a: ' + this._fileHandle.name, 'success');
      localStorage.setItem('drumcifra_fileConnected', 'true');
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') { console.error('File connect error:', e); this._showStatus('Erro ao conectar arquivo', 'error'); }
      return false;
    }
  },

  async openFromFile() {
    if (!this.isFileSystemSupported) { alert('Seu navegador não suporta acesso direto a arquivos. Use Chrome ou Edge.'); return false; }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'DrumCifra Data', accept: { 'application/json': ['.json'] } }]
      });
      this._fileHandle = handle;
      const file = await handle.getFile();
      const text = await file.text();
      this.importAll(text);
      this._showStatus('Dados carregados de: ' + handle.name, 'success');
      localStorage.setItem('drumcifra_fileConnected', 'true');
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') { console.error('File open error:', e); this._showStatus('Erro ao abrir arquivo', 'error'); }
      return false;
    }
  },

  disconnectFile() {
    this._fileHandle = null;
    localStorage.removeItem('drumcifra_fileConnected');
    this._showStatus('Arquivo desconectado', 'info');
  },

  async _writeToFile() {
    if (!this._fileHandle) return;
    try {
      const writable = await this._fileHandle.createWritable();
      await writable.write(this.exportAll());
      await writable.close();
      this._lastSavedToFile = new Date();
      this._showStatus('Salvo em ' + this._fileHandle.name, 'success', 2000);
    } catch (e) {
      console.error('File write error:', e);
      if (e.name === 'NotAllowedError') {
        this._fileHandle = null;
        localStorage.removeItem('drumcifra_fileConnected');
        this._showStatus('Permissão perdida. Reconecte o arquivo.', 'error');
      } else { this._showStatus('Erro ao salvar arquivo', 'error'); }
    }
  },

  _scheduleFileSave() {
    if (!this._fileHandle) return;
    clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => this._writeToFile(), 1000);
  },

  _scheduleCloudSync() {
    if (!CloudSync.isConnected) return;
    clearTimeout(this._cloudSyncTimeout);
    this._cloudSyncTimeout = setTimeout(() => {
      CloudSync.pushData({
        songs: this.getSongs(),
        setlists: this.getSetlists(),
        tags: this.getTags(),
        settings: this.getSettings()
      });
      this._showStatus('Sincronizado', 'success', 2000);
    }, 2000);
  },

  startAutoBackup(minutes) {
    this.stopAutoBackup();
    this._backupMinutes = minutes ?? 15;
    this._backupInterval = setInterval(() => this._downloadBackup(), this._backupMinutes * 60 * 1000);
  },

  stopAutoBackup() {
    if (this._backupInterval) { clearInterval(this._backupInterval); this._backupInterval = null; }
  },

  _downloadBackup() {
    const json = this.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');
    a.download = `drumcifra-autobackup-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._showStatus(`Backup automático salvo (${ts})`, 'success', 3000);
  },

  _showStatus(msg, type, autohideMs) {
    if (!this._statusEl) this._statusEl = document.getElementById('save-status');
    if (!this._statusEl) return;
    const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--accent)' };
    this._statusEl.textContent = msg;
    this._statusEl.style.color = colors[type] || colors.info;
    this._statusEl.classList.remove('hidden');
    if (autohideMs) setTimeout(() => { this._statusEl.classList.add('hidden'); }, autohideMs);
  }
};

// =============================================
// TEXT MEASUREMENT
// =============================================
const TextMeasure = {
  _canvas: null,
  _getCanvas() { if (!this._canvas) this._canvas = document.createElement('canvas'); return this._canvas; },
  measureText(text, font) { const ctx = this._getCanvas().getContext('2d'); ctx.font = font; return ctx.measureText(text).width; },
  getPositionFromX(text, x, font) {
    const ctx = this._getCanvas().getContext('2d');
    ctx.font = font;
    for (let i = 0; i <= text.length; i++) {
      if (ctx.measureText(text.substring(0, i)).width >= x) return Math.max(0, i - 1);
    }
    return text.length;
  }
};

// =============================================
// METRONOME
// =============================================
class Metronome {
  constructor() {
    this.audioCtx = null; this.isPlaying = false; this.bpm = 120;
    this.nextNoteTime = 0; this.currentBeat = 0; this.beatsPerBar = 4;
    this.lookahead = 25; this.scheduleAheadTime = 0.1; this.timerId = null; this.onBeat = null;
  }
  start(bpm) {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    this.bpm = bpm || this.bpm; this.isPlaying = true; this.currentBeat = 0;
    this.nextNoteTime = this.audioCtx.currentTime; this._scheduler();
  }
  stop() { this.isPlaying = false; clearTimeout(this.timerId); this.currentBeat = 0; if (this.onBeat) this.onBeat(-1); }
  _scheduler() {
    if (!this.isPlaying) return;
    while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
      this._scheduleNote(this.nextNoteTime, this.currentBeat);
      this.nextNoteTime += 60.0 / this.bpm;
      this.currentBeat = (this.currentBeat + 1) % this.beatsPerBar;
    }
    this.timerId = setTimeout(() => this._scheduler(), this.lookahead);
  }
  _scheduleNote(time, beat) {
    const osc = this.audioCtx.createOscillator(); const gain = this.audioCtx.createGain();
    osc.connect(gain); gain.connect(this.audioCtx.destination);
    osc.frequency.value = beat === 0 ? 1200 : 800;
    gain.gain.setValueAtTime(beat === 0 ? 0.6 : 0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    osc.start(time); osc.stop(time + 0.06);
    const delay = (time - this.audioCtx.currentTime) * 1000;
    if (delay >= 0 && this.onBeat) {
      setTimeout(() => { if (this.isPlaying && this.onBeat) this.onBeat(beat); }, delay);
    }
  }
}

// =============================================
// APP
// =============================================
const App = {
  songs: [], setlists: [], tags: [], settings: {},
  currentView: 'song-list', viewStack: [],
  editingSong: null, editingSongSnapshot: null,
  currentSongId: null, currentSetlistId: null,
  metronome: new Metronome(),
  scrollInterval: null, scrollSpeed: 3, isAutoScrolling: false,
  viewerFontSize: null, currentSectionIdx: 0,
  sortBy: 'title', sortDir: 'asc', groupBy: 'none',
  tagPickerCallback: null,
  undoStack: [], redoStack: [], maxUndoSteps: 50,

  init() {
    this.songs = Storage.getSongs();
    this.setlists = Storage.getSetlists();
    this.tags = Storage.getTags();
    this.settings = Storage.getSettings();
    this.viewerFontSize = parseInt(localStorage.getItem('drumcifra_viewerFontSize')) || 16;
    this.sortBy = localStorage.getItem('drumcifra_sortBy') || 'title';
    this.sortDir = localStorage.getItem('drumcifra_sortDir') || 'asc';
    this.groupBy = localStorage.getItem('drumcifra_groupBy') || 'none';

    this._bindNavigation();
    this._bindModals();
    this._bindBackButton();
    this._bindKeyboardShortcuts();

    const backupMin = this.settings.backupMinutes ?? 15;
    if (backupMin > 0) Storage.startAutoBackup(backupMin);

    if (localStorage.getItem('drumcifra_fileConnected') && Storage.isFileSystemSupported) {
      Storage._showStatus('Reconecte seu arquivo de dados em Config', 'info');
    }

    // Restore cloud sync connection
    CloudSync.restoreConnection((data) => this._onCloudData(data));

    this.navigate('song-list');
  },

  _onCloudData(data) {
    if (data.songs) Storage._set_local('songs', data.songs);
    if (data.setlists) Storage._set_local('setlists', data.setlists);
    if (data.tags) Storage._set_local('tags', data.tags);
    if (data.settings) Storage._set_local('settings', data.settings);
    this.songs = Storage.getSongs();
    this.setlists = Storage.getSetlists();
    this.tags = Storage.getTags();
    if (data.settings) this.settings = { ...this.settings, ...data.settings };
    Storage._showStatus('Dados recebidos da nuvem', 'success', 3000);
    if (this.currentView === 'song-list') this._renderSongList();
    else if (this.currentView === 'setlist-list') this._renderSetlistList();
    else if (this.currentView === 'settings') this._renderSettings();
  },

  // ---- Navigation ----
  navigate(view, params) {
    if (this.currentView === 'song-viewer') this._exitViewer();
    this.currentView = view;
    const title = document.getElementById('topbar-title');
    const backBtn = document.getElementById('back-btn');
    const actions = document.getElementById('topbar-actions');
    actions.innerHTML = '';
    backBtn.classList.toggle('hidden', ['song-list', 'setlist-list', 'settings'].includes(view));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.body.classList.remove('viewer-mode');
    document.getElementById('bottom-nav').classList.remove('hidden');
    document.getElementById('topbar').classList.remove('hidden');

    switch (view) {
      case 'song-list': title.textContent = 'DrumCifra'; this._renderSongList(); break;
      case 'song-editor': title.textContent = params?.isNew ? 'Nova Música' : 'Editar'; this._renderSongEditor(params); break;
      case 'song-viewer': this._renderSongViewer(params); break;
      case 'setlist-list': title.textContent = 'Setlists'; this._renderSetlistList(); break;
      case 'setlist-editor': title.textContent = 'Editar Setlist'; this._renderSetlistEditor(params); break;
      case 'setlist-player': this._renderSetlistPlayer(params); break;
      case 'settings': title.textContent = 'Configurações'; this._renderSettings(); break;
    }
  },

  _bindNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._guardUnsaved(() => { this.viewStack = []; this.navigate(btn.dataset.view); });
      });
    });
  },

  _bindBackButton() {
    document.getElementById('back-btn').addEventListener('click', () => {
      this._guardUnsaved(() => {
        if (this.currentView === 'song-editor' && this.editingSong) this._saveSong();
        if (this.viewStack.length > 0) { const prev = this.viewStack.pop(); this.navigate(prev.view, prev.params); }
        else this.navigate('song-list');
      });
    });
  },

  _pushView(view, params) {
    this.viewStack.push({ view: this.currentView, params: this._getCurrentParams() });
    this.navigate(view, params);
  },

  _getCurrentParams() {
    if (this.currentView === 'song-editor') return { songId: this.editingSong?.id };
    if (this.currentView === 'setlist-editor') return { setlistId: this.currentSetlistId };
    return {};
  },

  _bindModals() {
    document.querySelectorAll('.modal').forEach(modal => {
      const backdrop = modal.querySelector('.modal-backdrop');
      const closeBtn = modal.querySelector('.modal-close');
      if (backdrop) backdrop.addEventListener('click', () => this._closeModal(modal.id));
      if (closeBtn) closeBtn.addEventListener('click', () => this._closeModal(modal.id));
    });
  },

  _openModal(id) { document.getElementById(id).classList.remove('hidden'); },
  _closeModal(id) { document.getElementById(id).classList.add('hidden'); },

  // =============================================
  // UNSAVED CHANGES GUARD (Feature #4)
  // =============================================
  _isDirty() {
    if (!this.editingSong || !this.editingSongSnapshot) return false;
    return JSON.stringify(this.editingSong) !== this.editingSongSnapshot;
  },

  _guardUnsaved(callback) {
    if (this.currentView === 'song-editor' && this._isDirty()) {
      this._confirmSaveAction(
        'Você tem alterações não salvas. O que deseja fazer?',
        () => { this._saveSong(); callback(); },
        () => { this.editingSong = null; this.editingSongSnapshot = null; callback(); }
      );
    } else {
      callback();
    }
  },

  _confirmSaveAction(message, onSave, onDiscard) {
    document.getElementById('confirm-message').textContent = message;
    this._openModal('confirm-modal');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    okBtn.textContent = 'Salvar';
    okBtn.className = 'btn btn-primary';
    cancelBtn.textContent = 'Descartar';

    const cleanup = () => {
      this._closeModal('confirm-modal');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      okBtn.textContent = 'Confirmar';
      okBtn.className = 'btn btn-danger';
      cancelBtn.textContent = 'Cancelar';
    };
    const onOk = () => { cleanup(); onSave(); };
    const onCancel = () => { cleanup(); onDiscard(); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  },

  // =============================================
  // UNDO / REDO (Feature #3)
  // =============================================
  _pushUndo() {
    if (!this.editingSong) return;
    this.undoStack.push(JSON.stringify(this.editingSong));
    if (this.undoStack.length > this.maxUndoSteps) this.undoStack.shift();
    this.redoStack = [];
    this._updateUndoButtons();
  },

  _undo() {
    if (this.undoStack.length === 0 || !this.editingSong) return;
    this.redoStack.push(JSON.stringify(this.editingSong));
    this.editingSong = JSON.parse(this.undoStack.pop());
    this._updateUndoButtons();
    this._rebuildEditor();
  },

  _redo() {
    if (this.redoStack.length === 0 || !this.editingSong) return;
    this.undoStack.push(JSON.stringify(this.editingSong));
    this.editingSong = JSON.parse(this.redoStack.pop());
    this._updateUndoButtons();
    this._rebuildEditor();
  },

  _updateUndoButtons() {
    const u = document.getElementById('undo-btn');
    const r = document.getElementById('redo-btn');
    if (u) { u.disabled = this.undoStack.length === 0; u.style.opacity = this.undoStack.length === 0 ? '0.3' : '1'; }
    if (r) { r.disabled = this.redoStack.length === 0; r.style.opacity = this.redoStack.length === 0 ? '0.3' : '1'; }
  },

  _bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (this.currentView !== 'song-editor') return;
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
        // Only Ctrl+S in text fields
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          this._saveSong();
          Storage._showStatus('Salvo!', 'success', 1500);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); this._redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); this._saveSong(); Storage._showStatus('Salvo!', 'success', 1500); }
    });
  },

  // =============================================
  // SONG LIST (Feature #1 duplicate, Feature #2 sort)
  // =============================================
  _renderSongList() {
    const actions = document.getElementById('topbar-actions');
    actions.innerHTML = '';

    const sortOptions = [
      { key: 'title', label: 'Nome' },
      { key: 'artist', label: 'Artista' },
      { key: 'createdAt', label: 'Criação' },
      { key: 'updatedAt', label: 'Recente' }
    ];
    const groupOptions = [
      { key: 'none', label: 'A - Z' },
      { key: 'artist', label: 'Por Artista' },
      { key: 'bpm', label: 'Por BPM' }
    ];

    document.getElementById('app').innerHTML = `
      <div class="view">
        <div class="search-bar">
          <input type="text" id="search-input" placeholder="Buscar por título, artista ou letra..." autocomplete="off">
        </div>
        <div class="sort-toolbar" id="sort-toolbar">
          ${sortOptions.map(o => `<button class="sort-chip ${this.sortBy === o.key ? 'active' : ''}" data-sort="${o.key}">${o.label} ${this.sortBy === o.key ? '<span class="chip-arrow">' + (this.sortDir === 'asc' ? '↑' : '↓') + '</span>' : ''}</button>`).join('')}
          <span class="sort-sep"></span>
          ${groupOptions.map(o => `<button class="sort-chip ${this.groupBy === o.key ? 'active' : ''}" data-group="${o.key}">${o.label}</button>`).join('')}
        </div>
        <div id="song-list" class="list"></div>
        <button id="add-song-fab" class="fab" aria-label="Nova música">+</button>
      </div>
    `;

    this._updateSongList('');

    document.getElementById('search-input').addEventListener('input', debounce((e) => this._updateSongList(e.target.value), 200));

    document.getElementById('add-song-fab').addEventListener('click', () => {
      const song = this._createEmptySong();
      this.songs.push(song);
      Storage.saveSongs(this.songs);
      this._pushView('song-editor', { songId: song.id, isNew: true });
    });

    // Sort chips
    document.querySelectorAll('.sort-chip[data-sort]').forEach(chip => {
      chip.addEventListener('click', () => {
        const key = chip.dataset.sort;
        if (this.sortBy === key) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortBy = key;
          this.sortDir = 'asc';
        }
        localStorage.setItem('drumcifra_sortBy', this.sortBy);
        localStorage.setItem('drumcifra_sortDir', this.sortDir);
        this._renderSongList();
      });
    });

    // Group chips
    document.querySelectorAll('.sort-chip[data-group]').forEach(chip => {
      chip.addEventListener('click', () => {
        this.groupBy = chip.dataset.group;
        localStorage.setItem('drumcifra_groupBy', this.groupBy);
        this._renderSongList();
      });
    });
  },

  _sortSongs(songs) {
    const sorted = [...songs].sort((a, b) => {
      switch (this.sortBy) {
        case 'title': return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase(), 'pt');
        case 'artist': return (a.artist || '').toLowerCase().localeCompare((b.artist || '').toLowerCase(), 'pt');
        case 'createdAt': return (a.createdAt || 0) - (b.createdAt || 0);
        case 'updatedAt': return (a.updatedAt || 0) - (b.updatedAt || 0);
        default: return 0;
      }
    });
    return this.sortDir === 'desc' ? sorted.reverse() : sorted;
  },

  _songMatchesQuery(song, q) {
    if (song.title.toLowerCase().includes(q)) return true;
    if (song.artist.toLowerCase().includes(q)) return true;
    // Search in lyrics content
    if (song.sections) {
      for (const sec of song.sections) {
        if (sec.lines) {
          for (const line of sec.lines) {
            if (line.lyrics && line.lyrics.toLowerCase().includes(q)) return true;
          }
        }
      }
    }
    return false;
  },

  _getGroupKey(song) {
    switch (this.groupBy) {
      case 'artist': return song.artist?.trim() || 'Sem artista';
      case 'bpm': {
        const bpm = song.bpm || 0;
        if (bpm === 0) return 'Sem BPM';
        if (bpm < 80) return '< 80 BPM (Lento)';
        if (bpm < 110) return '80–109 BPM (Moderado)';
        if (bpm < 140) return '110–139 BPM (Médio)';
        if (bpm < 170) return '140–169 BPM (Rápido)';
        return '170+ BPM (Muito rápido)';
      }
      default: return null;
    }
  },

  _updateSongList(query) {
    const listEl = document.getElementById('song-list');
    if (!listEl) return;
    const q = query.toLowerCase().trim();
    const filtered = q ? this.songs.filter(s => this._songMatchesQuery(s, q)) : this.songs;
    const sorted = this._sortSongs(filtered);

    if (sorted.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><h3>${q ? 'Nenhum resultado' : 'Nenhuma música'}</h3><p>${q ? 'Tente outra busca' : 'Toque no + para adicionar sua primeira música'}</p></div>`;
      return;
    }

    // Group or flat rendering
    let html = '';
    if (this.groupBy === 'none') {
      // A-Z alphabetical headers
      let currentLetter = '';
      sorted.forEach(song => {
        const firstChar = (song.title || '').trim().charAt(0).toUpperCase();
        const letter = /[A-ZÀ-Ú]/.test(firstChar) ? firstChar : '#';
        if (letter !== currentLetter) {
          currentLetter = letter;
          html += `<div class="group-header">${escapeHtml(letter)}</div>`;
        }
        html += this._renderSongListItem(song);
      });
    } else {
      const groups = new Map();
      sorted.forEach(song => {
        const key = this._getGroupKey(song);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(song);
      });
      for (const [groupName, songs] of groups) {
        html += `<div class="group-header">${escapeHtml(groupName)} <span style="opacity:0.5;font-weight:400">(${songs.length})</span></div>`;
        html += songs.map(song => this._renderSongListItem(song)).join('');
      }
    }

    listEl.innerHTML = html;

    listEl.querySelectorAll('.list-item').forEach(item => {
      item.addEventListener('click', (e) => { if (e.target.closest('.icon-btn')) return; this._pushView('song-viewer', { songId: item.dataset.songId }); });
    });
    listEl.querySelectorAll('.edit-song-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._pushView('song-editor', { songId: btn.dataset.songId }); });
    });
    listEl.querySelectorAll('.dup-song-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._duplicateSong(btn.dataset.songId); });
    });
    listEl.querySelectorAll('.delete-song-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._confirmAction('Excluir esta música?', () => {
          this.songs = this.songs.filter(s => s.id !== btn.dataset.songId);
          Storage.saveSongs(this.songs);
          this._updateSongList(document.getElementById('search-input')?.value || '');
        });
      });
    });
  },

  // Feature #1: Duplicate song
  _renderSongListItem(song) {
    return `
      <div class="list-item" data-song-id="${song.id}">
        <div class="list-item-content">
          <div class="list-item-title">${escapeHtml(song.title || 'Sem título')}</div>
          <div class="list-item-subtitle">${escapeHtml(song.artist || 'Artista desconhecido')}${song.bpm ? ' · ' + song.bpm + ' BPM' : ''}</div>
        </div>
        <div class="list-item-actions">
          <button class="icon-btn dup-song-btn" data-song-id="${song.id}" aria-label="Duplicar" title="Duplicar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="icon-btn edit-song-btn" data-song-id="${song.id}" aria-label="Editar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn delete-song-btn" data-song-id="${song.id}" aria-label="Excluir" style="color:var(--danger)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  },

  _duplicateSong(songId) {
    const original = this.songs.find(s => s.id === songId);
    if (!original) return;
    const clone = JSON.parse(JSON.stringify(original));
    clone.id = uid();
    clone.title = (clone.title || 'Sem título') + ' (cópia)';
    clone.createdAt = Date.now();
    clone.updatedAt = Date.now();
    clone.sections.forEach(sec => {
      sec.id = uid();
      if (sec.lines) sec.lines.forEach(line => { line.id = uid(); if (line.tags) line.tags.forEach(t => { t.id = uid(); }); });
    });
    this.songs.push(clone);
    Storage.saveSongs(this.songs);
    this._updateSongList(document.getElementById('search-input')?.value || '');
    Storage._showStatus('Música duplicada!', 'success', 2000);
  },

  // =============================================
  // SONG EDITOR (with undo/redo buttons)
  // =============================================
  _renderSongEditor(params) {
    const song = this.songs.find(s => s.id === params?.songId);
    if (!song) return this.navigate('song-list');

    this.editingSong = JSON.parse(JSON.stringify(song));
    this.editingSongSnapshot = JSON.stringify(this.editingSong);
    this.undoStack = [];
    this.redoStack = [];

    const actions = document.getElementById('topbar-actions');
    actions.innerHTML = `
      <button id="undo-btn" class="icon-btn" aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled style="opacity:0.3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
      </button>
      <button id="redo-btn" class="icon-btn" aria-label="Refazer" title="Refazer (Ctrl+Y)" disabled style="opacity:0.3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>
      </button>
      <button id="save-song-btn" class="btn btn-primary btn-small">Salvar</button>
    `;
    document.getElementById('save-song-btn').addEventListener('click', () => { this._saveSong(); this.viewStack.pop(); this.navigate('song-list'); });
    document.getElementById('undo-btn').addEventListener('click', () => this._undo());
    document.getElementById('redo-btn').addEventListener('click', () => this._redo());
    this._rebuildEditor();
  },

  _rebuildEditor() {
    const song = this.editingSong;
    if (!song) return;
    document.getElementById('app').innerHTML = `
      <div class="view">
        <div class="editor-header">
          <input type="text" id="edit-title" placeholder="Título da música" value="${escapeHtml(song.title)}">
          <div class="editor-row">
            <input type="text" id="edit-artist" placeholder="Artista / Banda" value="${escapeHtml(song.artist)}">
            <input type="number" id="edit-bpm" placeholder="BPM" min="20" max="300" value="${song.bpm || ''}">
            <select id="edit-time-sig" style="flex:0 0 80px">
              <option value="4/4" ${(song.timeSignature || '4/4') === '4/4' ? 'selected' : ''}>4/4</option>
              <option value="3/4" ${song.timeSignature === '3/4' ? 'selected' : ''}>3/4</option>
              <option value="6/8" ${song.timeSignature === '6/8' ? 'selected' : ''}>6/8</option>
              <option value="7/8" ${song.timeSignature === '7/8' ? 'selected' : ''}>7/8</option>
              <option value="2/4" ${song.timeSignature === '2/4' ? 'selected' : ''}>2/4</option>
              <option value="5/4" ${song.timeSignature === '5/4' ? 'selected' : ''}>5/4</option>
            </select>
          </div>
          <div class="editor-row">
            <input type="text" id="edit-ref-link" placeholder="Link de referência (Spotify, YouTube...)" value="${escapeHtml(song.refLink || '')}">
          </div>
        </div>
        <div id="editor-sections"></div>
        <div style="display:flex;gap:var(--space-sm)">
          <button class="add-section-btn" id="add-section-btn" style="flex:1">+ Adicionar Seção</button>
          <button class="add-section-btn" id="paste-lyrics-btn" style="flex:1;border-color:var(--accent);color:var(--accent)">Colar Letra Completa</button>
        </div>
      </div>
    `;
    document.getElementById('edit-title').addEventListener('input', (e) => { this.editingSong.title = e.target.value; });
    document.getElementById('edit-artist').addEventListener('input', (e) => { this.editingSong.artist = e.target.value; });
    document.getElementById('edit-bpm').addEventListener('input', (e) => { this.editingSong.bpm = parseInt(e.target.value) || 0; });
    document.getElementById('edit-time-sig').addEventListener('change', (e) => { this.editingSong.timeSignature = e.target.value; });
    document.getElementById('edit-ref-link').addEventListener('input', (e) => { this.editingSong.refLink = e.target.value.trim(); });
    document.getElementById('add-section-btn').addEventListener('click', () => {
      this._pushUndo();
      this.editingSong.sections.push(this._createEmptySection());
      this._renderEditorSections();
    });
    document.getElementById('paste-lyrics-btn').addEventListener('click', () => this._openPasteLyricsModal());
    this._renderEditorSections();
  },

  _renderEditorSections() {
    const container = document.getElementById('editor-sections');
    if (!container) return;
    const song = this.editingSong;
    container.innerHTML = '';

    song.sections.forEach((section, sIdx) => {
      const el = document.createElement('div');
      el.className = 'section-block';
      const hasLyrics = section.lines && section.lines.length > 0 && section.lines.some(l => l.lyrics.trim() || (l.tags && l.tags.length > 0));
      const showLines = hasLyrics || section._showLines;
      const sectionTags = Array.isArray(section.tags) ? section.tags : (section.tag ? [section.tag] : []);
      const tagsHtml = sectionTags.map((t, tIdx) =>
        `<span class="tag-badge-section" data-sidx="${sIdx}" data-tidx="${tIdx}">${escapeHtml(t)} <span class="remove-section-tag" data-sidx="${sIdx}" data-tidx="${tIdx}">&times;</span></span>`
      ).join(' ');

      const DYNAMICS = ['', 'pp', 'p', 'mp', 'mf', 'f', 'ff'];
      const TRANSITIONS = ['', 'virada', 'fill', 'break', 'corte seco', 'build', 'crescendo'];

      el.innerHTML = `
        ${sIdx > 0 ? `<div class="transition-row">
          <select class="transition-select" data-sidx="${sIdx}">
            <option value="">— sem transição —</option>
            ${TRANSITIONS.filter(t => t).map(t => `<option value="${t}" ${section.transition === t ? 'selected' : ''}>${t.toUpperCase()}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="section-header">
          <select class="section-name-select" data-sidx="${sIdx}">
            ${[...DEFAULT_SECTIONS].sort((a, b) => a.localeCompare(b, 'pt')).map(s => `<option value="${s}" ${section.name === s ? 'selected' : ''}>${s}</option>`).join('')}
            <option value="__custom" ${!DEFAULT_SECTIONS.includes(section.name) ? 'selected' : ''}>Personalizado...</option>
          </select>
          ${!DEFAULT_SECTIONS.includes(section.name) ? `<input type="text" class="section-custom-name" value="${escapeHtml(section.name)}" placeholder="Nome" style="flex:1;padding:8px;border-radius:var(--radius-sm)">` : ''}
          <select class="dynamics-select" data-sidx="${sIdx}" title="Dinâmica">
            ${DYNAMICS.map(d => `<option value="${d}" ${(section.dynamics || '') === d ? 'selected' : ''}>${d || '—'}</option>`).join('')}
          </select>
          <select class="repeat-select" data-sidx="${sIdx}" title="Repetições" style="width:55px">
            <option value="1" ${(!section.repeat || section.repeat === 1) ? 'selected' : ''}>×1</option>
            <option value="2" ${section.repeat === 2 ? 'selected' : ''}>×2</option>
            <option value="3" ${section.repeat === 3 ? 'selected' : ''}>×3</option>
            <option value="4" ${section.repeat === 4 ? 'selected' : ''}>×4</option>
          </select>
          <div class="section-tag-input">${tagsHtml}<button class="add-section-tag-btn" data-sidx="${sIdx}">+ Tag</button></div>
          <button class="icon-btn remove-section-btn" data-sidx="${sIdx}" style="color:var(--danger)">&times;</button>
        </div>
        <div class="section-meta-row">
          <input type="text" class="section-notes-input" data-sidx="${sIdx}" placeholder="Notas / observações..." value="${escapeHtml(section.notes || '')}">
        </div>
        <div class="section-body" data-sidx="${sIdx}">
          ${showLines
            ? `${(section.lines || []).map((line, lIdx) => this._renderLineEditor(sIdx, lIdx, line)).join('')}<button class="add-line-btn" data-sidx="${sIdx}">+ Adicionar linha</button>`
            : `<div class="section-empty-state"><span class="section-empty-text">Seção sem letra (apenas tags)</span><button class="btn btn-ghost btn-small add-lyrics-btn" data-sidx="${sIdx}">+ Adicionar letra</button></div>`}
        </div>
      `;
      container.appendChild(el);

      // Section name
      el.querySelector('.section-name-select').addEventListener('change', (e) => {
        this._pushUndo();
        if (e.target.value === '__custom') { song.sections[sIdx].name = ''; this._renderEditorSections(); }
        else song.sections[sIdx].name = e.target.value;
      });

      // Merge button
      if (sIdx > 0) {
        const mb = document.createElement('button');
        mb.className = 'icon-btn'; mb.style.cssText = 'color:var(--text-secondary);font-size:0.7rem';
        mb.title = 'Juntar com seção anterior';
        mb.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 15 12 9 18 15"/></svg>`;
        mb.addEventListener('click', () => { this._pushUndo(); song.sections[sIdx - 1].lines.push(...(song.sections[sIdx].lines || [])); song.sections.splice(sIdx, 1); this._renderEditorSections(); });
        el.querySelector('.section-header').insertBefore(mb, el.querySelector('.remove-section-btn'));
      }

      // Custom name
      const ci = el.querySelector('.section-custom-name');
      if (ci) ci.addEventListener('input', (e) => { song.sections[sIdx].name = e.target.value; });

      // Notes
      const ni = el.querySelector('.section-notes-input');
      if (ni) ni.addEventListener('input', (e) => { song.sections[sIdx].notes = e.target.value; });

      // Dynamics
      el.querySelector('.dynamics-select')?.addEventListener('change', (e) => { this._pushUndo(); song.sections[sIdx].dynamics = e.target.value; });

      // Repeat
      el.querySelector('.repeat-select')?.addEventListener('change', (e) => { this._pushUndo(); song.sections[sIdx].repeat = parseInt(e.target.value) || 1; });

      // Transition
      el.querySelector('.transition-select')?.addEventListener('change', (e) => { this._pushUndo(); song.sections[sIdx].transition = e.target.value; });

      // Remove section
      el.querySelector('.remove-section-btn').addEventListener('click', () => {
        this._confirmAction('Remover esta seção?', () => { this._pushUndo(); song.sections.splice(sIdx, 1); this._renderEditorSections(); });
      });

      // Add section tag
      el.querySelector('.add-section-tag-btn')?.addEventListener('click', () => {
        this._openTagPicker((tagName) => {
          this._pushUndo();
          if (!Array.isArray(song.sections[sIdx].tags)) { song.sections[sIdx].tags = song.sections[sIdx].tag ? [song.sections[sIdx].tag] : []; delete song.sections[sIdx].tag; }
          if (!song.sections[sIdx].tags.includes(tagName)) song.sections[sIdx].tags.push(tagName);
          this._renderEditorSections();
        });
      });

      // Remove section tag
      el.querySelectorAll('.remove-section-tag').forEach(span => {
        span.addEventListener('click', (e) => {
          e.stopPropagation(); this._pushUndo();
          if (!Array.isArray(song.sections[sIdx].tags)) { song.sections[sIdx].tags = song.sections[sIdx].tag ? [song.sections[sIdx].tag] : []; delete song.sections[sIdx].tag; }
          song.sections[sIdx].tags.splice(parseInt(span.dataset.tidx), 1);
          this._renderEditorSections();
        });
      });

      // Add line
      el.querySelector('.add-line-btn')?.addEventListener('click', () => {
        this._pushUndo();
        if (!song.sections[sIdx].lines) song.sections[sIdx].lines = [];
        song.sections[sIdx].lines.push({ id: uid(), lyrics: '', tags: [] });
        this._renderEditorSections();
        const tas = container.querySelectorAll(`.section-body[data-sidx="${sIdx}"] textarea`);
        if (tas.length) tas[tas.length - 1].focus();
      });

      // Add lyrics btn (empty section)
      el.querySelector('.add-lyrics-btn')?.addEventListener('click', () => {
        song.sections[sIdx]._showLines = true;
        if (!song.sections[sIdx].lines || song.sections[sIdx].lines.length === 0) song.sections[sIdx].lines = [{ id: uid(), lyrics: '', tags: [] }];
        this._renderEditorSections();
      });

      if (showLines) this._bindLineEditors(el, sIdx);
    });
  },

  _renderLineEditor(sIdx, lIdx, line) {
    const t = line.lyrics || '';
    return `
      <div class="line-editor" data-sidx="${sIdx}" data-lidx="${lIdx}">
        <button class="insert-line-between-btn" data-sidx="${sIdx}" data-lidx="${lIdx}" title="Inserir linha aqui">+</button>
        <div class="line-preview-container" data-sidx="${sIdx}" data-lidx="${lIdx}">
          <span class="hint">clique para adicionar tag</span>
          <div class="tags-row" data-sidx="${sIdx}" data-lidx="${lIdx}"></div>
          <div class="lyrics-row">${escapeHtml(t) || '&nbsp;'}</div>
        </div>
        <div class="line-input-row">
          <textarea data-sidx="${sIdx}" data-lidx="${lIdx}" rows="1" placeholder="Digite a letra...">${escapeHtml(t)}</textarea>
          <div class="line-actions">
            <button class="icon-btn split-line-btn" data-sidx="${sIdx}" data-lidx="${lIdx}" title="Dividir seção aqui"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--section-color)" stroke-width="2" stroke-linecap="round"><line x1="2" y1="12" x2="22" y2="12"/><polyline points="8 8 4 12 8 16"/><polyline points="16 8 20 12 16 16"/></svg></button>
            <button class="icon-btn move-line-up-btn" data-sidx="${sIdx}" data-lidx="${lIdx}" title="Mover para cima"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="18 15 12 9 6 15"/></svg></button>
            <button class="icon-btn move-line-down-btn" data-sidx="${sIdx}" data-lidx="${lIdx}" title="Mover para baixo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></button>
            <button class="icon-btn remove-line-btn" data-sidx="${sIdx}" data-lidx="${lIdx}" style="color:var(--danger)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>
      </div>
    `;
  },

  _bindLineEditors(sectionEl, sIdx) {
    const song = this.editingSong;

    sectionEl.querySelectorAll(`textarea[data-sidx="${sIdx}"]`).forEach(ta => {
      const lIdx = parseInt(ta.dataset.lidx);
      ta.addEventListener('focus', () => this._pushUndo());
      ta.addEventListener('input', () => {
        song.sections[sIdx].lines[lIdx].lyrics = ta.value;
        const pc = sectionEl.querySelector(`.line-preview-container[data-sidx="${sIdx}"][data-lidx="${lIdx}"]`);
        if (pc) { pc.querySelector('.lyrics-row').textContent = ta.value || ' '; this._renderLineTags(pc, sIdx, lIdx); }
        ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
      });
      ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
    });

    sectionEl.querySelectorAll(`.remove-line-btn[data-sidx="${sIdx}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        this._pushUndo(); const lIdx = parseInt(btn.dataset.lidx);
        song.sections[sIdx].lines.splice(lIdx, 1);
        if (song.sections[sIdx].lines.length === 0) delete song.sections[sIdx]._showLines;
        this._renderEditorSections();
      });
    });

    sectionEl.querySelectorAll(`.insert-line-between-btn[data-sidx="${sIdx}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        this._pushUndo(); const lIdx = parseInt(btn.dataset.lidx);
        song.sections[sIdx].lines.splice(lIdx, 0, { id: uid(), lyrics: '', tags: [] });
        this._renderEditorSections();
      });
    });

    sectionEl.querySelectorAll(`.split-line-btn[data-sidx="${sIdx}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        this._pushUndo(); const lIdx = parseInt(btn.dataset.lidx);
        const linesForNew = song.sections[sIdx].lines.splice(lIdx);
        const ns = { id: uid(), name: 'Verso', tags: [], lines: linesForNew, _showLines: true };
        if (song.sections[sIdx].lines.length === 0) delete song.sections[sIdx]._showLines;
        song.sections.splice(sIdx + 1, 0, ns);
        this._renderEditorSections();
      });
    });

    sectionEl.querySelectorAll(`.move-line-up-btn[data-sidx="${sIdx}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        this._pushUndo(); const lIdx = parseInt(btn.dataset.lidx);
        if (lIdx > 0) { const [m] = song.sections[sIdx].lines.splice(lIdx, 1); song.sections[sIdx].lines.splice(lIdx - 1, 0, m); }
        else if (sIdx > 0) { const [m] = song.sections[sIdx].lines.splice(0, 1); song.sections[sIdx - 1].lines.push(m); if (song.sections[sIdx].lines.length === 0) song.sections[sIdx].lines.push({ id: uid(), lyrics: '', tags: [] }); }
        this._renderEditorSections();
      });
    });

    sectionEl.querySelectorAll(`.move-line-down-btn[data-sidx="${sIdx}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        this._pushUndo(); const lIdx = parseInt(btn.dataset.lidx);
        if (lIdx < song.sections[sIdx].lines.length - 1) { const [m] = song.sections[sIdx].lines.splice(lIdx, 1); song.sections[sIdx].lines.splice(lIdx + 1, 0, m); }
        else if (sIdx < song.sections.length - 1) { const [m] = song.sections[sIdx].lines.splice(lIdx, 1); song.sections[sIdx + 1].lines.unshift(m); if (song.sections[sIdx].lines.length === 0) song.sections[sIdx].lines.push({ id: uid(), lyrics: '', tags: [] }); }
        this._renderEditorSections();
      });
    });

    sectionEl.querySelectorAll(`.line-preview-container[data-sidx="${sIdx}"]`).forEach(container => {
      const lIdx = parseInt(container.dataset.lidx);
      this._renderLineTags(container, sIdx, lIdx);
      container.addEventListener('click', (e) => {
        if (e.target.closest('.tag-badge')) return;
        const lr = container.querySelector('.lyrics-row');
        const x = e.clientX - lr.getBoundingClientRect().left;
        const lyrics = song.sections[sIdx].lines[lIdx].lyrics || '';
        const charPos = TextMeasure.getPositionFromX(lyrics, x, getComputedStyle(lr).font);
        this._openTagPicker((tagName) => {
          this._pushUndo();
          song.sections[sIdx].lines[lIdx].tags.push({ id: uid(), name: tagName, position: charPos });
          this._renderLineTags(container, sIdx, lIdx);
        });
      });
    });
  },

  _renderLineTags(container, sIdx, lIdx) {
    const tagsRow = container.querySelector('.tags-row');
    const lyricsRow = container.querySelector('.lyrics-row');
    if (!tagsRow || !lyricsRow) return;
    const line = this.editingSong.sections[sIdx].lines[lIdx];
    const lyrics = line.lyrics || '';
    const font = getComputedStyle(lyricsRow).font;
    const tags = line.tags || [];
    tagsRow.innerHTML = '';
    tagsRow.style.height = tags.length > 0 ? '22px' : '0px';

    tags.forEach((tag, tIdx) => {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.innerHTML = `${escapeHtml(tag.name)}<span class="tag-remove" data-tidx="${tIdx}">&times;</span>`;
      badge.style.left = TextMeasure.measureText(lyrics.substring(0, tag.position), font) + 'px';
      badge.querySelector('.tag-remove').addEventListener('click', (e) => {
        e.stopPropagation(); this._pushUndo(); line.tags.splice(tIdx, 1); this._renderLineTags(container, sIdx, lIdx);
      });
      this._makeTagDraggable(badge, tag, lyricsRow, () => this._renderLineTags(container, sIdx, lIdx));
      tagsRow.appendChild(badge);
    });
  },

  _makeTagDraggable(badge, tagData, lyricsRow, onUpdate) {
    let startX = 0, startLeft = 0, isDragging = false;
    badge.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('tag-remove')) return;
      e.preventDefault(); e.stopPropagation();
      isDragging = true; this._pushUndo();
      startX = e.clientX; startLeft = parseFloat(badge.style.left) || 0;
      badge.classList.add('dragging');
      const onMove = (e2) => { if (!isDragging) return; badge.style.left = Math.max(0, startLeft + (e2.clientX - startX)) + 'px'; };
      const onUp = () => {
        if (!isDragging) return; isDragging = false; badge.classList.remove('dragging');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        tagData.position = TextMeasure.getPositionFromX(lyricsRow.textContent || '', parseFloat(badge.style.left) || 0, getComputedStyle(lyricsRow).font);
        onUpdate();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  },

  _saveSong() {
    if (!this.editingSong) return;
    const idx = this.songs.findIndex(s => s.id === this.editingSong.id);
    if (idx >= 0) { this.editingSong.updatedAt = Date.now(); this.songs[idx] = this.editingSong; }
    Storage.saveSongs(this.songs);
    this.editingSongSnapshot = JSON.stringify(this.editingSong);
  },

  _createEmptySong() {
    return { id: uid(), title: '', artist: '', bpm: 0, sections: [this._createEmptySection()], createdAt: Date.now(), updatedAt: Date.now() };
  },

  _createEmptySection() {
    return { id: uid(), name: 'Verso', tags: [], lines: [], notes: '', dynamics: '', repeat: 1, transition: '' };
  },

  // =============================================
  // PASTE LYRICS
  // =============================================
  _openPasteLyricsModal() {
    this._openModal('paste-lyrics-modal');
    const ta = document.getElementById('paste-lyrics-textarea');
    ta.value = ''; ta.focus();
    document.getElementById('paste-lyrics-clear').onclick = () => { ta.value = ''; ta.focus(); };
    document.getElementById('paste-lyrics-confirm').onclick = () => {
      const text = ta.value.trim();
      if (!text) return;
      const parsed = parseLyricsText(text);
      if (parsed.length === 0) { alert('Não foi possível detectar seções.'); return; }
      this._pushUndo();
      if (this.editingSong.sections.length > 0 && this.editingSong.sections.some(s => s.lines && s.lines.some(l => l.lyrics.trim()))) {
        this._closeModal('paste-lyrics-modal');
        this._confirmAction('Substituir as seções atuais ou adicionar ao final?', () => { this.editingSong.sections = parsed; this._renderEditorSections(); });
        document.getElementById('confirm-ok').textContent = 'Substituir';
        document.getElementById('confirm-cancel').textContent = 'Adicionar ao final';
        const cb = document.getElementById('confirm-cancel');
        const cb2 = cb.cloneNode(true);
        cb.parentNode.replaceChild(cb2, cb);
        cb2.addEventListener('click', () => { this._closeModal('confirm-modal'); this.editingSong.sections.push(...parsed); this._renderEditorSections(); });
      } else {
        this.editingSong.sections = parsed;
        this._closeModal('paste-lyrics-modal');
        this._renderEditorSections();
      }
    };
  },

  // =============================================
  // SONG VIEWER
  // =============================================
  _renderSongViewer(params) {
    const song = this.songs.find(s => s.id === params?.songId);
    if (!song) return this.navigate('song-list');
    this.currentSongId = song.id;
    this.currentSectionIdx = 0;
    document.body.classList.add('viewer-mode');
    document.getElementById('bottom-nav').classList.add('hidden');
    document.getElementById('topbar').classList.add('hidden');

    const timeSig = song.timeSignature || '4/4';
    const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4;
    const beatDotsHtml = Array.from({length: beatsPerBar}, (_, i) => `<span class="beat-dot" data-beat="${i}"></span>`).join('');

    document.getElementById('app').innerHTML = `
      <div class="viewer-container" id="viewer-scroll-area" style="--viewer-font-size:${this.viewerFontSize}px">
        <div class="viewer-song-header">
          <h1>${escapeHtml(song.title || 'Sem título')}</h1>
          <div class="artist">${escapeHtml(song.artist || '')}</div>
          ${song.bpm ? `<span class="bpm-badge">${song.bpm} BPM · ${timeSig}</span>` : (timeSig !== '4/4' ? `<span class="bpm-badge">${timeSig}</span>` : '')}
          ${song.refLink ? `<a href="${escapeHtml(song.refLink)}" target="_blank" rel="noopener" class="ref-link-badge">▶ Ouvir Referência</a>` : ''}
        </div>
        <div id="viewer-sections"></div>
      </div>
      <button class="icon-btn viewer-close-btn" id="viewer-close" style="background:var(--bg-tertiary)"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div class="metronome-indicator hidden" id="metronome-indicator"><span id="met-bpm-display">${song.bpm || 120} BPM · ${timeSig}</span>${beatDotsHtml}</div>
      <div class="section-nav hidden" id="section-nav">
        <div class="section-nav-prev" id="section-nav-prev"></div>
        <div class="section-nav-current" id="section-nav-current"></div>
        <div class="section-nav-next" id="section-nav-next"></div>
      </div>
      <div class="viewer-controls" id="viewer-controls">
        <button class="viewer-ctrl-btn" id="viewer-zoom-in" title="Aumentar fonte"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        <button class="viewer-ctrl-btn" id="viewer-zoom-out" title="Diminuir fonte"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        <button class="viewer-ctrl-btn" id="viewer-columns" title="Duas colunas"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg></button>
        <button class="viewer-ctrl-btn" id="viewer-compact" title="Compacto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg></button>
        <button class="viewer-ctrl-btn" id="viewer-metronome" title="Metrônomo"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5L7.5 21h9L12 1.5zM11 14V8h2v6h-2zm0 4v-2h2v2h-2z"/></svg></button>
        <button class="viewer-ctrl-btn" id="viewer-scroll" title="Auto-scroll"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></button>
        <button class="viewer-ctrl-btn" id="viewer-section-nav" title="Navegar por seção"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="16" width="16" height="4" rx="1"/></svg></button>
        <button class="viewer-ctrl-btn" id="viewer-print" title="Imprimir / PDF"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button>
        ${song.refLink ? `<button class="viewer-ctrl-btn" id="viewer-ref-link" title="Ouvir referência"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>` : ''}
        <button class="viewer-ctrl-btn" id="viewer-edit" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
      </div>
      <div class="scroll-speed-control hidden" id="scroll-speed-control"><span class="speed-label">Rápido</span><input type="range" min="1" max="10" value="${this.scrollSpeed}" id="scroll-speed-slider"><span class="speed-label">Lento</span></div>
    `;

    const sectionsEl = document.getElementById('viewer-sections');
    const sectionColors = this._getSectionColors();
    song.sections.forEach((section, secIdx) => {
      // Transition marker between sections
      if (secIdx > 0 && section.transition) {
        const transDiv = document.createElement('div');
        transDiv.className = 'viewer-transition';
        transDiv.textContent = section.transition.toUpperCase();
        sectionsEl.appendChild(transDiv);
      }

      const div = document.createElement('div'); div.className = 'viewer-section';
      const sectionColor = this._getSectionColorHex(section.name, sectionColors);
      div.style.border = `1px solid ${sectionColor}40`;
      div.style.borderLeft = `3px solid ${sectionColor}`;
      const sTags = Array.isArray(section.tags) ? section.tags : (section.tag ? [section.tag] : []);
      const dynClass = section.dynamics ? ' dyn-' + section.dynamics : '';

      let nh = `<div class="viewer-section-name${dynClass}" style="color:${sectionColor}">${escapeHtml(section.name)}`;
      if (section.dynamics) nh += ` <span class="viewer-dynamics-badge">${section.dynamics}</span>`;
      if (section.repeat && section.repeat > 1) nh += ` <span class="viewer-repeat-badge">×${section.repeat}</span>`;
      sTags.forEach(t => { nh += ` <span class="viewer-section-tag">${escapeHtml(t)}</span>`; });
      nh += `</div>`;
      if (section.notes) nh += `<div class="viewer-section-notes">${escapeHtml(section.notes)}</div>`;
      div.innerHTML = nh;

      (section.lines || []).filter(l => l.lyrics.trim() || (l.tags && l.tags.length > 0)).forEach(line => {
        const ld = document.createElement('div'); ld.className = 'viewer-line';
        const lyrics = line.lyrics || ''; const tags = line.tags || [];
        if (tags.length > 0) {
          const tr = document.createElement('div'); tr.className = 'viewer-tags-row'; tr.style.position = 'relative'; tr.style.minHeight = '22px';
          ld.appendChild(tr);
          const lr = document.createElement('div'); lr.className = 'viewer-lyrics-row'; lr.textContent = lyrics; ld.appendChild(lr);
          requestAnimationFrame(() => {
            const font = getComputedStyle(lr).font;
            tags.forEach(tag => {
              const sp = document.createElement('span'); sp.style.position = 'absolute'; sp.style.top = '0'; sp.style.fontWeight = '700';
              sp.textContent = tag.name; sp.style.left = TextMeasure.measureText(lyrics.substring(0, tag.position), font) + 'px';
              tr.appendChild(sp);
            });
          });
        } else {
          const lr = document.createElement('div'); lr.className = 'viewer-lyrics-row'; lr.textContent = lyrics; ld.appendChild(lr);
        }
        div.appendChild(ld);
      });
      sectionsEl.appendChild(div);
    });

    document.getElementById('viewer-close').addEventListener('click', () => { this._exitViewer(); if (this.viewStack.length > 0) { const p = this.viewStack.pop(); this.navigate(p.view, p.params); } else this.navigate('song-list'); });
    document.getElementById('viewer-edit').addEventListener('click', () => { this._exitViewer(); this._pushView('song-editor', { songId: song.id }); });
    document.getElementById('viewer-columns').addEventListener('click', () => { document.getElementById('viewer-scroll-area').classList.toggle('two-columns'); document.getElementById('viewer-columns').classList.toggle('active'); });
    document.getElementById('viewer-compact').addEventListener('click', () => { document.getElementById('viewer-scroll-area').classList.toggle('compact-mode'); document.getElementById('viewer-compact').classList.toggle('active'); });
    document.getElementById('viewer-metronome').addEventListener('click', () => {
      const btn = document.getElementById('viewer-metronome'); const ind = document.getElementById('metronome-indicator');
      if (this.metronome.isPlaying) { this.metronome.stop(); btn.classList.remove('active'); ind.classList.add('hidden'); }
      else {
        this.metronome.beatsPerBar = beatsPerBar;
        this.metronome.onBeat = (beat) => { document.querySelectorAll('.beat-dot').forEach((d, i) => d.classList.toggle('active', i === beat)); };
        this.metronome.start(song.bpm || 120); btn.classList.add('active'); ind.classList.remove('hidden');
      }
    });
    document.getElementById('viewer-scroll').addEventListener('click', () => {
      const btn = document.getElementById('viewer-scroll'); const sc = document.getElementById('scroll-speed-control');
      if (this.isAutoScrolling) { this._stopAutoScroll(); btn.classList.remove('active'); sc.classList.add('hidden'); }
      else { this._startAutoScroll(); btn.classList.add('active'); sc.classList.remove('hidden'); }
    });
    document.getElementById('scroll-speed-slider').addEventListener('input', (e) => { this.scrollSpeed = parseInt(e.target.value); });

    // Print button
    document.getElementById('viewer-print').addEventListener('click', () => { window.print(); });

    // Reference link button
    if (song.refLink) {
      document.getElementById('viewer-ref-link')?.addEventListener('click', () => { window.open(song.refLink, '_blank', 'noopener'); });
    }

    // Feature 7: Zoom font
    document.getElementById('viewer-zoom-in').addEventListener('click', () => {
      this.viewerFontSize = Math.min(32, this.viewerFontSize + 2);
      localStorage.setItem('drumcifra_viewerFontSize', this.viewerFontSize);
      document.getElementById('viewer-scroll-area').style.setProperty('--viewer-font-size', this.viewerFontSize + 'px');
    });
    document.getElementById('viewer-zoom-out').addEventListener('click', () => {
      this.viewerFontSize = Math.max(10, this.viewerFontSize - 2);
      localStorage.setItem('drumcifra_viewerFontSize', this.viewerFontSize);
      document.getElementById('viewer-scroll-area').style.setProperty('--viewer-font-size', this.viewerFontSize + 'px');
    });

    // Feature 8: Section-by-section navigation
    const sectionEls = document.querySelectorAll('#viewer-sections .viewer-section');
    const sectionNames = song.sections.map(s => s.name);

    document.getElementById('viewer-section-nav').addEventListener('click', () => {
      const btn = document.getElementById('viewer-section-nav');
      const nav = document.getElementById('section-nav');
      if (nav.classList.contains('hidden')) {
        nav.classList.remove('hidden');
        btn.classList.add('active');
        this.currentSectionIdx = 0;
        this._updateSectionNav(sectionEls, sectionNames);
        if (sectionEls[0]) sectionEls[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        nav.classList.add('hidden');
        btn.classList.remove('active');
      }
    });

    let fadeTimer = setTimeout(() => document.getElementById('viewer-controls')?.classList.add('faded'), 3000);
    document.addEventListener('mousemove', () => {
      document.getElementById('viewer-controls')?.classList.remove('faded');
      clearTimeout(fadeTimer); fadeTimer = setTimeout(() => document.getElementById('viewer-controls')?.classList.add('faded'), 3000);
    }, { passive: true });

    // Swipe gesture navigation (mobile)
    this._initSwipeGesture(document.getElementById('viewer-scroll-area'), sectionEls, sectionNames);
  },

  _initSwipeGesture(container, sectionEls, sectionNames) {
    if (!container) return;
    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    const MIN_SWIPE_DIST = 60;
    const MAX_SWIPE_TIME = 400;
    const MAX_VERT_RATIO = 1.5; // allow some vertical movement

    container.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      if (e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      const elapsed = Date.now() - touchStartTime;
      if (elapsed > MAX_SWIPE_TIME) return;
      if (Math.abs(dx) < MIN_SWIPE_DIST) return;
      if (Math.abs(dy) > Math.abs(dx) * MAX_VERT_RATIO) return;

      // Horizontal swipe detected
      if (dx < 0) {
        // Swipe left → next section
        if (this.currentSectionIdx < sectionNames.length - 1) {
          this.currentSectionIdx++;
          this._updateSectionNav(sectionEls, sectionNames);
          sectionEls[this.currentSectionIdx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          this._showSwipeIndicator('next');
        }
      } else {
        // Swipe right → previous section
        if (this.currentSectionIdx > 0) {
          this.currentSectionIdx--;
          this._updateSectionNav(sectionEls, sectionNames);
          sectionEls[this.currentSectionIdx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          this._showSwipeIndicator('prev');
        }
      }
    }, { passive: true });
  },

  _showSwipeIndicator(direction) {
    const existing = document.querySelector('.swipe-indicator');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'swipe-indicator ' + direction;
    el.textContent = direction === 'next' ? '→' : '←';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 600);
  },

  _exitViewer() { document.body.classList.remove('viewer-mode'); this.metronome.stop(); this._stopAutoScroll(); },
  _startAutoScroll() { this.isAutoScrolling = true; const s = () => { if (!this.isAutoScrolling) return; window.scrollBy(0, this.scrollSpeed * 0.5); this.scrollInterval = requestAnimationFrame(s); }; s(); },
  _stopAutoScroll() { this.isAutoScrolling = false; if (this.scrollInterval) { cancelAnimationFrame(this.scrollInterval); this.scrollInterval = null; } },

  // Section color helpers
  _getSectionColors() {
    return this.settings.sectionColors || { ...DEFAULT_SECTION_COLORS };
  },

  _getSectionColorHex(sectionName, colors) {
    if (!colors) colors = this._getSectionColors();
    const lower = (sectionName || '').toLowerCase();
    // Direct match
    if (colors[lower]) return colors[lower];
    // Numbered section match (e.g. "Verso 2" → "verso")
    const base = lower.replace(/\s*\d+$/, '').trim();
    if (colors[base]) return colors[base];
    // Default fallback
    return '#6B7280';
  },

  _saveSectionColors(colors) {
    this.settings.sectionColors = colors;
    Storage.saveSettings(this.settings);
  },

  _updateSectionNav(sectionEls, sectionNames) {
    const prev = document.getElementById('section-nav-prev');
    const curr = document.getElementById('section-nav-current');
    const next = document.getElementById('section-nav-next');
    const i = this.currentSectionIdx;
    prev.textContent = i > 0 ? '← ' + sectionNames[i - 1] : '';
    curr.textContent = sectionNames[i] || '';
    next.textContent = i < sectionNames.length - 1 ? sectionNames[i + 1] + ' →' : '';

    prev.onclick = () => {
      if (i > 0) { this.currentSectionIdx--; this._updateSectionNav(sectionEls, sectionNames); sectionEls[this.currentSectionIdx]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    };
    next.onclick = () => {
      if (i < sectionNames.length - 1) { this.currentSectionIdx++; this._updateSectionNav(sectionEls, sectionNames); sectionEls[this.currentSectionIdx]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    };
    curr.onclick = () => { sectionEls[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  },

  // =============================================
  // SETLIST
  // =============================================
  _renderSetlistList() {
    document.getElementById('app').innerHTML = `<div class="view"><div id="setlist-list" class="list"></div><button id="add-setlist-fab" class="fab">+</button></div>`;
    this._updateSetlistList();
    document.getElementById('add-setlist-fab').addEventListener('click', () => {
      const sl = { id: uid(), name: '', songIds: [], createdAt: Date.now() };
      this.setlists.push(sl); Storage.saveSetlists(this.setlists);
      this._pushView('setlist-editor', { setlistId: sl.id });
    });
  },

  _updateSetlistList() {
    const el = document.getElementById('setlist-list'); if (!el) return;
    if (this.setlists.length === 0) { el.innerHTML = `<div class="empty-state"><h3>Nenhuma setlist</h3><p>Organize suas músicas em setlists para shows e ensaios</p></div>`; return; }
    el.innerHTML = this.setlists.map(sl => `
      <div class="list-item" data-setlist-id="${sl.id}"><div class="list-item-content"><div class="list-item-title">${escapeHtml(sl.name || 'Sem nome')}</div><div class="list-item-subtitle">${sl.songIds.length} música${sl.songIds.length !== 1 ? 's' : ''}</div></div>
      <div class="list-item-actions">
        <button class="icon-btn play-setlist-btn" data-setlist-id="${sl.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
        <button class="icon-btn edit-setlist-btn" data-setlist-id="${sl.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="icon-btn delete-setlist-btn" data-setlist-id="${sl.id}" style="color:var(--danger)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div></div>`).join('');
    el.querySelectorAll('.play-setlist-btn').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._pushView('setlist-player', { setlistId: b.dataset.setlistId, index: 0 }); }));
    el.querySelectorAll('.edit-setlist-btn').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._pushView('setlist-editor', { setlistId: b.dataset.setlistId }); }));
    el.querySelectorAll('.list-item').forEach(i => i.addEventListener('click', (e) => { if (e.target.closest('.icon-btn')) return; this._pushView('setlist-editor', { setlistId: i.dataset.setlistId }); }));
    el.querySelectorAll('.delete-setlist-btn').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._confirmAction('Excluir esta setlist?', () => { this.setlists = this.setlists.filter(s => s.id !== b.dataset.setlistId); Storage.saveSetlists(this.setlists); this._updateSetlistList(); }); }));
  },

  _renderSetlistEditor(params) {
    const sl = this.setlists.find(s => s.id === params?.setlistId);
    if (!sl) return this.navigate('setlist-list');
    this.currentSetlistId = sl.id;
    document.getElementById('topbar-actions').innerHTML = `<button id="print-setlist-top" class="icon-btn" title="Imprimir Setlist"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button><button id="play-setlist-top" class="icon-btn"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>`;
    document.getElementById('play-setlist-top').addEventListener('click', () => this._pushView('setlist-player', { setlistId: sl.id, index: 0 }));
    document.getElementById('print-setlist-top').addEventListener('click', () => this._printSetlist(sl));
    document.getElementById('app').innerHTML = `<div class="view"><div class="setlist-header"><input type="text" id="setlist-name" placeholder="Nome da setlist" value="${escapeHtml(sl.name)}"></div><div id="setlist-songs" class="list"></div><button class="add-section-btn mt-md" id="add-to-setlist">+ Adicionar Música</button></div>`;
    document.getElementById('setlist-name').addEventListener('input', (e) => { sl.name = e.target.value; Storage.saveSetlists(this.setlists); });
    document.getElementById('add-to-setlist').addEventListener('click', () => this._openSongPicker((id) => { sl.songIds.push(id); Storage.saveSetlists(this.setlists); this._renderSetlistSongs(sl); }));
    this._renderSetlistSongs(sl);
  },

  _renderSetlistSongs(sl) {
    const c = document.getElementById('setlist-songs'); if (!c) return;
    if (sl.songIds.length === 0) { c.innerHTML = `<div class="empty-state"><p>Nenhuma música na setlist</p></div>`; return; }
    c.innerHTML = sl.songIds.map((sid, idx) => {
      const s = this.songs.find(x => x.id === sid); if (!s) return '';
      return `<div class="setlist-item" data-idx="${idx}" draggable="true"><span class="drag-handle">⠿</span><span class="order-num">${idx + 1}</span><div class="list-item-content"><div class="list-item-title">${escapeHtml(s.title || 'Sem título')}</div><div class="list-item-subtitle">${escapeHtml(s.artist || '')}${s.bpm ? ' · ' + s.bpm + ' BPM' : ''}</div></div><button class="icon-btn remove-from-setlist" data-idx="${idx}" style="color:var(--danger)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`;
    }).join('');
    c.querySelectorAll('.remove-from-setlist').forEach(b => b.addEventListener('click', () => { sl.songIds.splice(parseInt(b.dataset.idx), 1); Storage.saveSetlists(this.setlists); this._renderSetlistSongs(sl); }));
    let di = null;
    c.querySelectorAll('.setlist-item').forEach(item => {
      item.addEventListener('dragstart', (e) => { di = parseInt(item.dataset.idx); item.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; });
      item.addEventListener('dragend', () => { item.style.opacity = '1'; c.querySelectorAll('.setlist-item').forEach(i => i.classList.remove('dragging-over')); });
      item.addEventListener('dragover', (e) => { e.preventDefault(); c.querySelectorAll('.setlist-item').forEach(i => i.classList.remove('dragging-over')); item.classList.add('dragging-over'); });
      item.addEventListener('drop', (e) => { e.preventDefault(); const dropIdx = parseInt(item.dataset.idx); if (di !== null && di !== dropIdx) { const [m] = sl.songIds.splice(di, 1); sl.songIds.splice(dropIdx, 0, m); Storage.saveSetlists(this.setlists); this._renderSetlistSongs(sl); } di = null; });
    });
  },

  _renderSetlistPlayer(params) {
    const sl = this.setlists.find(s => s.id === params?.setlistId);
    if (!sl || sl.songIds.length === 0) return this.navigate('setlist-list');
    const idx = params?.index || 0;
    if (!sl.songIds[idx]) return this.navigate('setlist-list');
    this._renderSongViewer({ songId: sl.songIds[idx] });
    const controls = document.getElementById('viewer-controls');
    if (controls) {
      const ce = document.createElement('div'); ce.style.cssText = 'text-align:center;font-size:0.7rem;color:var(--text-secondary);font-family:var(--font-mono);margin-top:4px;'; ce.textContent = `${idx + 1}/${sl.songIds.length}`;
      controls.appendChild(ce);
      const nd = document.createElement('div'); nd.style.cssText = 'display:flex;gap:var(--space-sm);margin-top:var(--space-sm)';
      if (idx > 0) { const pb = document.createElement('button'); pb.className = 'viewer-ctrl-btn'; pb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`; pb.addEventListener('click', () => { this._exitViewer(); this.navigate('setlist-player', { setlistId: sl.id, index: idx - 1 }); }); nd.appendChild(pb); }
      if (idx < sl.songIds.length - 1) { const nb = document.createElement('button'); nb.className = 'viewer-ctrl-btn'; nb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`; nb.addEventListener('click', () => { this._exitViewer(); this.navigate('setlist-player', { setlistId: sl.id, index: idx + 1 }); }); nd.appendChild(nb); }
      controls.appendChild(nd);
    }
    // Swipe left/right to navigate between setlist songs
    this._initSetlistSwipe(sl, idx);
  },

  _initSetlistSwipe(sl, idx) {
    const container = document.getElementById('viewer-scroll-area');
    if (!container) return;
    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    const MIN_SWIPE = 80, MAX_TIME = 400;

    container.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      if (e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Date.now() - touchStartTime > MAX_TIME) return;
      if (Math.abs(dx) < MIN_SWIPE) return;
      if (Math.abs(dy) > Math.abs(dx)) return;

      if (dx < 0 && idx < sl.songIds.length - 1) {
        this._exitViewer(); this.navigate('setlist-player', { setlistId: sl.id, index: idx + 1 });
      } else if (dx > 0 && idx > 0) {
        this._exitViewer(); this.navigate('setlist-player', { setlistId: sl.id, index: idx - 1 });
      }
    }, { passive: true });
  },

  _printSetlist(sl) {
    const songs = sl.songIds.map(id => this.songs.find(s => s.id === id)).filter(Boolean);
    const sectionColors = this._getSectionColors();
    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(sl.name || 'Setlist')}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 10mm; color: #000; font-size: 10pt; }
        .setlist-title { text-align: center; font-size: 16pt; font-weight: 700; margin-bottom: 6mm; border-bottom: 1px solid #ccc; padding-bottom: 3mm; }
        .song-block { page-break-inside: avoid; margin-bottom: 6mm; }
        .song-title { font-size: 12pt; font-weight: 700; margin-bottom: 1mm; }
        .song-artist { font-size: 9pt; color: #555; margin-bottom: 2mm; }
        .song-meta { font-size: 8pt; color: #666; margin-bottom: 2mm; }
        .section { margin-bottom: 3mm; padding: 2mm 3mm; border: 1px solid #ddd; border-radius: 2mm; border-left: 3px solid #ddd; }
        .section-name { font-size: 9pt; font-weight: 700; text-transform: uppercase; margin-bottom: 1mm; font-family: monospace; }
        .section-tag { font-size: 8pt; color: #555; background: #f0f0f0; padding: 0 3px; border-radius: 2px; }
        .lyrics { font-family: monospace; font-size: 9pt; line-height: 1.4; }
        .tag-line { font-family: monospace; font-size: 8pt; font-weight: 700; color: #333; }
        .transition { text-align: center; font-size: 7pt; color: #666; font-family: monospace; text-transform: uppercase; margin: 1mm 0; }
      </style></head><body>
      <div class="setlist-title">${escapeHtml(sl.name || 'Setlist')}</div>`;
    songs.forEach((song, i) => {
      html += `<div class="song-block"><div class="song-title">${i + 1}. ${escapeHtml(song.title || 'Sem título')}</div>`;
      html += `<div class="song-artist">${escapeHtml(song.artist || '')}</div>`;
      if (song.bpm) html += `<div class="song-meta">${song.bpm} BPM · ${song.timeSignature || '4/4'}</div>`;
      song.sections.forEach((sec, secIdx) => {
        if (secIdx > 0 && sec.transition) html += `<div class="transition">— ${escapeHtml(sec.transition)} —</div>`;
        const color = this._getSectionColorHex(sec.name, sectionColors);
        html += `<div class="section" style="border-left-color:${color}"><div class="section-name" style="color:${color}">${escapeHtml(sec.name)}`;
        if (sec.dynamics) html += ` <span style="font-style:italic">${sec.dynamics}</span>`;
        if (sec.repeat && sec.repeat > 1) html += ` ×${sec.repeat}`;
        const sTags = Array.isArray(sec.tags) ? sec.tags : [];
        sTags.forEach(t => { html += ` <span class="section-tag">${escapeHtml(t)}</span>`; });
        html += `</div>`;
        if (sec.notes) html += `<div style="font-size:7pt;font-style:italic;color:#666">${escapeHtml(sec.notes)}</div>`;
        (sec.lines || []).forEach(line => {
          if (line.tags && line.tags.length > 0) html += `<div class="tag-line">${line.tags.map(t => escapeHtml(t.name)).join('  ')}</div>`;
          if (line.lyrics.trim()) html += `<div class="lyrics">${escapeHtml(line.lyrics)}</div>`;
        });
        html += `</div>`;
      });
      html += `</div>`;
    });
    html += `</body></html>`;
    const printWin = window.open('', '_blank');
    printWin.document.write(html);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => printWin.print(), 300);
  },

  // =============================================
  // SETTINGS
  // =============================================
  _renderSettings() {
    document.getElementById('app').innerHTML = `
      <div class="view">
        <div class="settings-group"><div class="settings-group-title">Tags de Bateria</div><div class="settings-tags-list" id="tags-list"></div><div class="add-tag-row"><input type="text" id="new-tag-input" placeholder="Nome da nova tag..." style="text-transform:uppercase"><button class="btn btn-primary btn-small" id="add-tag-btn">Adicionar</button></div></div>
        <div class="settings-group"><div class="settings-group-title">Sincronização na Nuvem</div>
          ${!CloudSync.isAvailable ? `<div class="settings-item"><div><div class="settings-item-label" style="color:var(--danger)">Firebase não configurado</div><div class="settings-item-desc">Configure o arquivo firebase-config.js para ativar a sincronização.</div></div></div>` :
          CloudSync.isConnected ? `
            <div class="settings-item"><div><div class="settings-item-label" style="color:var(--success)">✓ Conectado</div><div class="settings-item-desc">Código: <strong>${escapeHtml(CloudSync.syncCode)}</strong> — Use este mesmo código em outros dispositivos.</div></div></div>
            <div class="settings-item" id="cloud-push-btn" style="cursor:pointer"><div><div class="settings-item-label">Enviar dados para nuvem</div><div class="settings-item-desc">Envia todos os dados locais para a nuvem agora</div></div><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg></div>
            <div class="settings-item" id="cloud-pull-btn" style="cursor:pointer"><div><div class="settings-item-label">Baixar dados da nuvem</div><div class="settings-item-desc">Substitui dados locais pelos da nuvem</div></div><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><polyline points="7 16 12 21 17 16"/><line x1="12" y1="21" x2="12" y2="9"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg></div>
            <div class="settings-item" id="cloud-disconnect-btn" style="cursor:pointer"><div><div class="settings-item-label" style="color:var(--danger)">Desconectar da nuvem</div><div class="settings-item-desc">Para de sincronizar (dados locais permanecem)</div></div></div>
          ` : `
            <div class="settings-item"><div><div class="settings-item-label">Sincronize entre dispositivos</div><div class="settings-item-desc">Crie um código pessoal e use o mesmo código em todos os seus dispositivos para manter tudo sincronizado.</div></div></div>
            <div class="settings-item"><div style="width:100%"><input type="text" id="sync-code-input" placeholder="Digite seu código pessoal (min. 3 caracteres)..." style="width:100%;margin-bottom:var(--space-xs)"><div style="display:flex;gap:var(--space-sm)"><button class="btn btn-primary btn-small" id="cloud-connect-btn">Conectar</button><button class="btn btn-ghost btn-small" id="cloud-connect-pull-btn">Conectar e Baixar</button></div></div></div>
          `}
        </div>
        <div class="settings-group"><div class="settings-group-title">Armazenamento em Arquivo</div>
          <div class="settings-item"><div><div class="settings-item-label">${Storage.isConnectedToFile ? 'Conectado: ' + escapeHtml(Storage.connectedFileName) : 'Nenhum arquivo conectado'}</div><div class="settings-item-desc">Salva automaticamente num arquivo .json no seu PC.</div></div></div>
          <div class="settings-item" id="connect-file-btn" style="cursor:pointer"><div><div class="settings-item-label">${Storage.isConnectedToFile ? 'Trocar arquivo' : 'Escolher arquivo para salvar'}</div><div class="settings-item-desc">Cria ou escolhe um .json no seu computador</div></div><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
          <div class="settings-item" id="open-file-btn" style="cursor:pointer"><div><div class="settings-item-label">Abrir arquivo existente</div><div class="settings-item-desc">Carrega dados de um .json já salvo</div></div><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
          ${Storage.isConnectedToFile ? `<div class="settings-item" id="disconnect-file-btn" style="cursor:pointer"><div><div class="settings-item-label" style="color:var(--danger)">Desconectar arquivo</div><div class="settings-item-desc">Volta a salvar apenas no navegador</div></div></div>` : ''}
        </div>
        <div class="settings-group"><div class="settings-group-title">Backup Automático</div>
          <div class="settings-item"><div><div class="settings-item-label">Intervalo de backup</div><div class="settings-item-desc">Baixa um backup automaticamente</div></div><select id="backup-interval-select" style="width:auto;padding:6px 10px;border-radius:var(--radius-sm);background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border)"><option value="0" ${this.settings.backupMinutes===0?'selected':''}>Desligado</option><option value="5" ${this.settings.backupMinutes===5?'selected':''}>5 min</option><option value="15" ${this.settings.backupMinutes===15||this.settings.backupMinutes===undefined?'selected':''}>15 min</option><option value="30" ${this.settings.backupMinutes===30?'selected':''}>30 min</option><option value="60" ${this.settings.backupMinutes===60?'selected':''}>1 hora</option></select></div>
          <div class="settings-item" id="backup-now-btn" style="cursor:pointer"><div><div class="settings-item-label">Fazer backup agora</div></div><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
        </div>
        <div class="settings-group"><div class="settings-group-title">Exportar / Importar</div>
          <div class="settings-item" id="export-btn" style="cursor:pointer"><div><div class="settings-item-label">Exportar tudo</div><div class="settings-item-desc">Salvar como JSON</div></div><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
          <div class="settings-item" id="import-btn" style="cursor:pointer"><div><div class="settings-item-label">Importar dados</div><div class="settings-item-desc">Restaurar de um backup</div></div><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
        </div>
        <div class="settings-group"><div class="settings-group-title">Cores das Seções</div><div class="settings-item"><div class="settings-item-desc" style="width:100%">Defina cores para cada tipo de seção. As cores são usadas no viewer para identificar visualmente cada parte.</div></div><div id="section-colors-list" class="section-colors-grid"></div><div class="settings-item" id="reset-colors-btn" style="cursor:pointer;margin-top:2px"><div><div class="settings-item-label" style="color:var(--danger)">Restaurar cores padrão</div></div></div></div>
        <div class="settings-group"><div class="settings-group-title">Estatísticas</div>
          <div class="settings-item"><span class="settings-item-label">Músicas</span><span class="text-accent" style="font-weight:700;font-family:var(--font-mono)">${this.songs.length}</span></div>
          <div class="settings-item"><span class="settings-item-label">Setlists</span><span class="text-accent" style="font-weight:700;font-family:var(--font-mono)">${this.setlists.length}</span></div>
          <div class="settings-item"><span class="settings-item-label">Tags</span><span class="text-accent" style="font-weight:700;font-family:var(--font-mono)">${this.tags.length}</span></div>
        </div>
        <div class="settings-group"><div class="settings-group-title">Sobre</div><div class="settings-item"><div><div class="settings-item-label">DrumCifra</div><div class="settings-item-desc">Cifras de bateria simplificadas. v1.3 — Section Colors, Print, Swipe</div></div></div></div>
      </div>
    `;
    this._renderTagsList();
    this._renderSectionColorsList();
    const ati = document.getElementById('new-tag-input');
    document.getElementById('add-tag-btn').addEventListener('click', () => { const n = ati.value.trim().toUpperCase(); if (n && !this.tags.includes(n)) { this.tags.push(n); Storage.saveTags(this.tags); ati.value = ''; this._renderTagsList(); } });
    ati.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('add-tag-btn').click(); });
    // Cloud sync bindings
    document.getElementById('cloud-connect-btn')?.addEventListener('click', () => {
      const code = document.getElementById('sync-code-input')?.value;
      if (CloudSync.connect(code, (data) => this._onCloudData(data))) {
        CloudSync.pushData({ songs: this.songs, setlists: this.setlists, tags: this.tags, settings: this.settings });
        Storage._showStatus('Conectado e dados enviados!', 'success', 3000);
        this._renderSettings();
      } else { alert('Código inválido. Use pelo menos 3 caracteres.'); }
    });
    document.getElementById('cloud-connect-pull-btn')?.addEventListener('click', async () => {
      const code = document.getElementById('sync-code-input')?.value;
      if (CloudSync.connect(code, (data) => this._onCloudData(data))) {
        const data = await CloudSync.pullData();
        if (data && data.songs) { this._onCloudData(data); Storage._showStatus('Dados baixados da nuvem!', 'success', 3000); }
        else { Storage._showStatus('Conectado (nenhum dado na nuvem ainda)', 'info', 3000); }
        this._renderSettings();
      } else { alert('Código inválido. Use pelo menos 3 caracteres.'); }
    });
    document.getElementById('cloud-push-btn')?.addEventListener('click', async () => {
      await CloudSync.pushData({ songs: this.songs, setlists: this.setlists, tags: this.tags, settings: this.settings });
      Storage._showStatus('Dados enviados!', 'success', 3000);
    });
    document.getElementById('cloud-pull-btn')?.addEventListener('click', async () => {
      const data = await CloudSync.pullData();
      if (data && data.songs) { this._onCloudData(data); Storage._showStatus('Dados baixados!', 'success', 3000); this._renderSettings(); }
      else { Storage._showStatus('Nenhum dado encontrado na nuvem', 'info', 3000); }
    });
    document.getElementById('cloud-disconnect-btn')?.addEventListener('click', () => { CloudSync.disconnect(); Storage._showStatus('Desconectado da nuvem', 'info', 3000); this._renderSettings(); });
    document.getElementById('connect-file-btn')?.addEventListener('click', async () => { if (await Storage.connectToFile()) this._renderSettings(); });
    document.getElementById('open-file-btn')?.addEventListener('click', async () => { if (await Storage.openFromFile()) { this.songs = Storage.getSongs(); this.setlists = Storage.getSetlists(); this.tags = Storage.getTags(); this._renderSettings(); } });
    document.getElementById('disconnect-file-btn')?.addEventListener('click', () => { Storage.disconnectFile(); this._renderSettings(); });
    document.getElementById('backup-interval-select')?.addEventListener('change', (e) => { const m = parseInt(e.target.value); this.settings.backupMinutes = m; Storage.saveSettings(this.settings); m === 0 ? Storage.stopAutoBackup() : Storage.startAutoBackup(m); });
    document.getElementById('backup-now-btn')?.addEventListener('click', () => Storage._downloadBackup());
    document.getElementById('export-btn').addEventListener('click', () => { const b = new Blob([Storage.exportAll()], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `drumcifra-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(u); });
    document.getElementById('import-btn').addEventListener('click', () => this._openModal('import-modal'));
    document.getElementById('import-confirm-btn').addEventListener('click', () => { try { Storage.importAll(document.getElementById('import-textarea').value); this.songs = Storage.getSongs(); this.setlists = Storage.getSetlists(); this.tags = Storage.getTags(); this._closeModal('import-modal'); this._renderSettings(); } catch { alert('JSON inválido.'); } });
    document.getElementById('import-file-btn').addEventListener('click', () => document.getElementById('import-file').click());
    document.getElementById('import-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => { document.getElementById('import-textarea').value = ev.target.result; }; r.readAsText(f); });
  },

  _renderTagsList() {
    const c = document.getElementById('tags-list'); if (!c) return;
    const sortedTags = this.tags.slice().sort((a, b) => a.localeCompare(b, 'pt'));
    c.innerHTML = sortedTags.map((tag) => { const idx = this.tags.indexOf(tag); return `<span class="settings-tag ${DEFAULT_TAGS.includes(tag) ? 'is-default' : ''}">${escapeHtml(tag)}<button class="remove-btn" data-idx="${idx}">&times;</button></span>`; }).join('');
    c.querySelectorAll('.remove-btn').forEach(b => b.addEventListener('click', () => { this.tags.splice(parseInt(b.dataset.idx), 1); Storage.saveTags(this.tags); this._renderTagsList(); }));
  },

  _renderSectionColorsList() {
    const c = document.getElementById('section-colors-list'); if (!c) return;
    const colors = this._getSectionColors();
    const uniqueKeys = Object.keys(DEFAULT_SECTION_COLORS).sort((a, b) => a.localeCompare(b, 'pt'));
    c.innerHTML = uniqueKeys.map(key => {
      const color = colors[key] || DEFAULT_SECTION_COLORS[key] || '#6B7280';
      return `<div class="section-color-item"><input type="color" class="section-color-picker" data-key="${key}" value="${color}"><span class="section-color-label">${escapeHtml(key)}</span></div>`;
    }).join('');
    c.querySelectorAll('.section-color-picker').forEach(input => {
      input.addEventListener('change', (e) => {
        const key = e.target.dataset.key;
        const currentColors = this._getSectionColors();
        currentColors[key] = e.target.value;
        this._saveSectionColors(currentColors);
      });
    });
    document.getElementById('reset-colors-btn')?.addEventListener('click', () => {
      this._saveSectionColors({ ...DEFAULT_SECTION_COLORS });
      this._renderSectionColorsList();
      Storage._showStatus('Cores restauradas!', 'success', 2000);
    });
  },

  // =============================================
  // TAG / SONG PICKER MODALS
  // =============================================
  _openTagPicker(cb) {
    this.tagPickerCallback = cb; this._openModal('tag-picker-modal');
    const si = document.getElementById('tag-search'); si.value = ''; si.focus();
    this._renderTagGrid('');
    si.oninput = () => this._renderTagGrid(si.value);
    si.onkeydown = (e) => { if (e.key === 'Enter') { const v = si.value.trim().toUpperCase(); if (v) this._selectTag(v); } };
  },

  _renderTagGrid(query) {
    const g = document.getElementById('tag-grid'); const q = query.toLowerCase().trim();
    const f = (q ? this.tags.filter(t => t.toLowerCase().includes(q)) : this.tags).slice().sort((a, b) => a.localeCompare(b, 'pt'));
    let h = f.map(t => `<button class="tag-option" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('');
    if (q && !this.tags.some(t => t.toLowerCase() === q)) h += `<button class="tag-option" data-tag="${escapeHtml(q.toUpperCase())}" style="border-color:var(--accent);color:var(--accent)">+ ${escapeHtml(q.toUpperCase())}</button>`;
    g.innerHTML = h;
    g.querySelectorAll('.tag-option').forEach(b => b.addEventListener('click', () => this._selectTag(b.dataset.tag)));
  },

  _selectTag(name) {
    if (!this.tags.includes(name)) { this.tags.push(name); Storage.saveTags(this.tags); }
    this._closeModal('tag-picker-modal');
    if (this.tagPickerCallback) { this.tagPickerCallback(name); this.tagPickerCallback = null; }
  },

  _openSongPicker(cb) {
    this._openModal('song-picker-modal');
    const si = document.getElementById('song-picker-search'); si.value = ''; si.focus();
    const render = (q) => {
      const el = document.getElementById('song-picker-list'); const query = q.toLowerCase().trim();
      const f = query ? this.songs.filter(s => s.title.toLowerCase().includes(query) || s.artist.toLowerCase().includes(query)) : this.songs;
      el.innerHTML = f.map(s => `<div class="list-item" data-song-id="${s.id}"><div class="list-item-content"><div class="list-item-title">${escapeHtml(s.title || 'Sem título')}</div><div class="list-item-subtitle">${escapeHtml(s.artist || '')}</div></div></div>`).join('');
      el.querySelectorAll('.list-item').forEach(i => i.addEventListener('click', () => { this._closeModal('song-picker-modal'); cb(i.dataset.songId); }));
    };
    render(''); si.oninput = () => render(si.value);
  },

  _confirmAction(message, onConfirm) {
    document.getElementById('confirm-message').textContent = message;
    this._openModal('confirm-modal');
    const ok = document.getElementById('confirm-ok'); const cancel = document.getElementById('confirm-cancel');
    const cleanup = () => { this._closeModal('confirm-modal'); ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); };
    const onOk = () => { cleanup(); onConfirm(); };
    const onCancel = () => { cleanup(); };
    ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
