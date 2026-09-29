/*
 * Keepsake storage and handoff for the web booth.
 *
 * Two jobs, in this order of importance:
 *
 *  1. Do not lose a photo. Until now the web build kept keepsakes only as
 *     in-memory blob URLs, so closing the tab threw the night away. Every
 *     keepsake now goes to IndexedDB first and stays there until it is
 *     confirmed uploaded.
 *
 *  2. Hand the guest their photo. The booth picks the short code itself, so
 *     the QR can be on screen before the upload has finished -- the upload is
 *     never on the critical path. If it fails, the photo is still on the
 *     tablet and the queue retries.
 *
 * Everything degrades rather than throws. No IndexedDB (private window, a
 * browser that refuses it) means no persistence, but the booth still works.
 */
(function (global) {
  'use strict';

  var DB_NAME = 'booth';
  var DB_VERSION = 1;
  var STORE = 'keepsakes';

  /* No 0/O/1/I/L: a code may end up read aloud or typed when a scan fails. */
  var ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  var CODE_LENGTH = 10;

  /* Retry backoff in ms. After the last one the item waits for a manual
     retry, a fresh save, or the network coming back. */
  var BACKOFF = [2000, 6000, 15000, 45000, 120000];

  var config = { uploadBase: '', uploadKey: '' };
  var db = null;
  var dbFailed = false;
  var inFlight = {};
  var timers = {};
  var listeners = [];

  // ------------------------------------------------------------------ util

  /* Counts come from the store, so refresh them before telling anyone --
     otherwise every listener sees the state from one change ago. */
  function announce() {
    return refreshCounts().then(function () {
      var snapshot = status();
      listeners.forEach(function (fn) {
        try { fn(snapshot); } catch (e) { /* a bad listener must not stop the rest */ }
      });
    });
  }

  function newCode() {
    var out = '';
    var bytes = new Uint8Array(CODE_LENGTH);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(bytes);
    } else {
      for (var j = 0; j < CODE_LENGTH; j++) bytes[j] = Math.floor(Math.random() * 256);
    }
    // Rejection-free and close enough to uniform: 256 % 31 skews the first
    // few letters by under 4%, which no attacker can use against 2^49 codes.
    for (var i = 0; i < CODE_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
  }

  function linkFor(code) {
    if (!config.uploadBase) return '';
    return config.uploadBase.replace(/\/+$/, '') + '/p/' + code;
  }

  function configured() {
    return !!(config.uploadBase && config.uploadKey);
  }

  // -------------------------------------------------------------- indexeddb

  function open() {
    if (db) return Promise.resolve(db);
    if (dbFailed || !global.indexedDB) return Promise.resolve(null);

    return new Promise(function (resolve) {
      var request;
      try { request = global.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { dbFailed = true; resolve(null); return; }

      request.onupgradeneeded = function () {
        var upgrade = request.result;
        if (!upgrade.objectStoreNames.contains(STORE)) {
          var store = upgrade.createObjectStore(STORE, { keyPath: 'code' });
          store.createIndex('uploaded', 'uploaded', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = function () { db = request.result; resolve(db); };
      request.onerror = function () { dbFailed = true; resolve(null); };
      request.onblocked = function () { dbFailed = true; resolve(null); };
    });
  }

  function tx(mode, fn) {
    return open().then(function (handle) {
      if (!handle) return null;
      return new Promise(function (resolve, reject) {
        var transaction;
        try { transaction = handle.transaction(STORE, mode); }
        catch (e) { resolve(null); return; }
        var request = fn(transaction.objectStore(STORE));
        transaction.onabort = function () { reject(transaction.error || new Error('aborted')); };
        transaction.oncomplete = function () { resolve(request ? request.result : null); };
        transaction.onerror = function () { reject(transaction.error || new Error('failed')); };
      });
    }).catch(function (err) {
      // A full disk shows up here. Make room and let the caller retry once.
      if (err && err.name === 'QuotaExceededError') return purgeUploaded().then(function () { return null; });
      return null;
    });
  }

  function put(record) { return tx('readwrite', function (store) { return store.put(record); }); }
  function get(code) { return tx('readonly', function (store) { return store.get(code); }); }
  function all() { return tx('readonly', function (store) { return store.getAll(); }); }

  /* Oldest-first removal of what is already safely uploaded. */
  function purgeUploaded() {
    return all().then(function (records) {
      if (!records || !records.length) return 0;
      var done = records.filter(function (r) { return r.uploaded; })
                        .sort(function (a, b) { return a.createdAt - b.createdAt; });
      if (!done.length) return 0;
      var drop = done.slice(0, Math.max(1, Math.ceil(done.length / 2)));
      return Promise.all(drop.map(function (r) {
        return tx('readwrite', function (store) { return store.delete(r.code); });
      })).then(function () { return drop.length; });
    });
  }

  // ----------------------------------------------------------------- upload

  function send(record) {
    if (!configured()) return Promise.resolve(false);
    if (inFlight[record.code]) return Promise.resolve(false);
    inFlight[record.code] = true;
    announce();

    return fetch(linkForUpload(record.code), {
      method: 'PUT',
      headers: { 'Content-Type': record.mime, 'X-Booth-Key': config.uploadKey },
      body: record.blob
    }).then(function (response) {
      delete inFlight[record.code];
      if (response.ok) {
        record.uploaded = true;
        record.lastError = '';
        return put(record).then(function () { announce(); return true; });
      }
      // 4xx other than 429 means retrying changes nothing.
      var permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
      record.lastError = 'HTTP ' + response.status;
      record.attempts = permanent ? BACKOFF.length : (record.attempts || 0) + 1;
      return put(record).then(function () { schedule(record); announce(); return false; });
    }).catch(function (err) {
      delete inFlight[record.code];
      record.lastError = (err && err.name) || 'network';
      record.attempts = (record.attempts || 0) + 1;
      return put(record).then(function () { schedule(record); announce(); return false; });
    });
  }

  function linkForUpload(code) {
    return config.uploadBase.replace(/\/+$/, '') + '/u/' + code;
  }

  function schedule(record) {
    var attempt = record.attempts || 0;
    if (attempt >= BACKOFF.length) return;          // waits for retryAll or online
    clearTimeout(timers[record.code]);
    timers[record.code] = setTimeout(function () {
      get(record.code).then(function (fresh) {
        if (fresh && !fresh.uploaded) send(fresh);
      });
    }, BACKOFF[attempt]);
  }

  // -------------------------------------------------------------- public

  /**
   * Stores a keepsake and starts its upload. Safe to call again with the same
   * code -- a signature added after the fact replaces what is stored and
   * overwrites the same object, so the QR the guest already scanned still
   * resolves to the version they kept.
   */
  function save(code, blob, meta) {
    var record = {
      code: code,
      blob: blob,
      mime: (meta && meta.mime) || 'image/jpeg',
      mode: (meta && meta.mode) || '',
      filename: (meta && meta.filename) || '',
      createdAt: Date.now(),
      uploaded: false,
      attempts: 0,
      lastError: ''
    };
    clearTimeout(timers[code]);
    delete inFlight[code];
    return put(record).then(function () {
      announce();
      return send(record);
    });
  }

  /** Re-queues everything still unsent, ignoring backoff. */
  function retryAll() {
    return all().then(function (records) {
      if (!records) return 0;
      var waiting = records.filter(function (r) { return !r.uploaded; });
      waiting.forEach(function (r) { r.attempts = 0; clearTimeout(timers[r.code]); send(r); });
      return waiting.length;
    });
  }

  /** Picks up where a reload or a crash left off. */
  function resume() {
    if (!configured()) return Promise.resolve(0);
    return all().then(function (records) {
      if (!records) return 0;
      var waiting = records.filter(function (r) { return !r.uploaded; });
      waiting.forEach(function (r) { r.attempts = 0; send(r); });
      return waiting.length;
    });
  }

  var counts = { stored: 0, pending: 0, uploaded: 0 };

  function refreshCounts() {
    return all().then(function (records) {
      if (!records) { counts = { stored: 0, pending: 0, uploaded: 0 }; return counts; }
      // With no Worker configured there is nowhere to upload to, so an
      // unsent keepsake is not "pending" -- it is simply stored, and saying
      // otherwise leaves a warning on screen that the operator cannot clear.
      counts = {
        stored: records.length,
        pending: configured()
          ? records.filter(function (r) { return !r.uploaded; }).length : 0,
        uploaded: records.filter(function (r) { return r.uploaded; }).length
      };
      return counts;
    });
  }

  function status() {
    return {
      configured: configured(),
      persistent: !!db && !dbFailed,
      inFlight: Object.keys(inFlight).length,
      stored: counts.stored,
      pending: counts.pending,
      uploaded: counts.uploaded
    };
  }

  function onChange(fn) { listeners.push(fn); }

  function init(options) {
    config.uploadBase = (options && options.uploadBase) || '';
    config.uploadKey = (options && options.uploadKey) || '';
    return open()
      .then(announce)
      .then(resume);
  }

  if (global.addEventListener) {
    global.addEventListener('online', function () { retryAll(); });
  }

  global.BoothShare = {
    init: init,
    newCode: newCode,
    linkFor: linkFor,
    configured: configured,
    save: save,
    retryAll: retryAll,
    status: status,
    onChange: onChange,
    list: all,
    _purgeUploaded: purgeUploaded
  };
})(typeof window !== 'undefined' ? window : this);
