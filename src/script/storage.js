"use strict";

/**
 * HackMD Storage Wrapper
 * IndexedDBを使用したノート保存・検索のためのストレージレイヤー
 */
class HackMDStorage {
  constructor() {
    this.db = null;
    this.dbName = 'HackMDSearchDB';
    this.dbVersion = 1;
  }

  /**
   * データベースを初期化
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // notes ObjectStore
        if (!db.objectStoreNames.contains('notes')) {
          const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
          notesStore.createIndex('byTime', 'time', { unique: false });
          notesStore.createIndex('byTitle', 'title', { unique: false });
        }

        // metadata ObjectStore
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }

        // searchIndex ObjectStore
        if (!db.objectStoreNames.contains('searchIndex')) {
          db.createObjectStore('searchIndex', { keyPath: 'word' });
        }
      };
    });
  }

  /**
   * 全ノートを取得
   */
  async getAllNotes() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const index = store.index('byTime');
      const request = index.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to get all notes: ${request.error}`));
    });
  }

  /**
   * 単一ノートを取得
   */
  async getNote(noteId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const request = store.get(noteId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error(`Failed to get note: ${request.error}`));
    });
  }

  /**
   * ノートを保存（新規・更新）
   */
  async setNote(note) {
    if (!this.db) await this.init();

    // サイズを計算
    const noteWithSize = {
      ...note,
      size: new Blob([note.md]).size
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['notes'], 'readwrite');
      const store = transaction.objectStore('notes');
      const request = store.put(noteWithSize);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to save note: ${request.error}`));
    });
  }

  /**
   * ノートを削除
   */
  async deleteNote(noteId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['notes'], 'readwrite');
      const store = transaction.objectStore('notes');
      const request = store.delete(noteId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to delete note: ${request.error}`));
    });
  }

  /**
   * メタデータを取得
   */
  async getMetadata() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['metadata'], 'readonly');
      const store = transaction.objectStore('metadata');
      const request = store.get('config');

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : {
          lastStoredDate: 0,
          noteCount: 0,
          dbVersion: this.dbVersion
        });
      };
      request.onerror = () => reject(new Error(`Failed to get metadata: ${request.error}`));
    });
  }

  /**
   * メタデータを保存
   */
  async setMetadata(metadata) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['metadata'], 'readwrite');
      const store = transaction.objectStore('metadata');
      const request = store.put({
        key: 'config',
        value: metadata
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save metadata: ${request.error}`));
    });
  }

  /**
   * 検索インデックスを取得
   */
  async getSearchIndex() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['searchIndex'], 'readonly');
      const store = transaction.objectStore('searchIndex');
      const request = store.getAll();

      request.onsuccess = () => {
        const index = {};
        request.result.forEach(item => {
          index[item.word] = item.noteIds;
        });
        resolve(index);
      };
      request.onerror = () => reject(new Error(`Failed to get search index: ${request.error}`));
    });
  }

  /**
   * 検索インデックスを保存
   */
  async setSearchIndex(index) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['searchIndex'], 'readwrite');
      const store = transaction.objectStore('searchIndex');

      // トランザクション完了イベントでresolve
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error(`Failed to save search index: ${transaction.error}`));

      // 既存のインデックスをクリアしてから新しいインデックスを保存
      const clearRequest = store.clear();
      clearRequest.onsuccess = () => {
        // 新しいインデックスを保存
        const entries = Object.entries(index.words || {});
        entries.forEach(([word, noteIds]) => {
          store.put({ word, noteIds });
        });
      };
      clearRequest.onerror = () => reject(new Error(`Failed to clear search index: ${clearRequest.error}`));
    });
  }

  /**
   * ストレージサイズを取得
   */
  async getStorageSize() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      // ノートの合計サイズを計算
      const transaction = this.db.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const request = store.getAll();

      request.onsuccess = () => {
        const notes = request.result;
        const totalSize = notes.reduce((acc, note) => acc + (note.size || 0), 0);
        resolve({
          bytes: totalSize,
          kb: Math.round(totalSize / 1024),
          mb: Math.round(totalSize / 1024 / 1024 * 100) / 100,
          count: notes.length
        });
      };
      request.onerror = () => reject(new Error(`Failed to get storage size: ${request.error}`));
    });
  }

  /**
   * 全データを削除
   */
  async clear() {
    if (!this.db) await this.init();

    const objectStores = ['notes', 'metadata', 'searchIndex'];
    const promises = objectStores.map(storeName => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error(`Failed to clear ${storeName}: ${request.error}`));
      });
    });

    await Promise.all(promises);
  }

  /**
   * データベースを閉じる
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// グローバルインスタンスを作成
const hackmdStorage = new HackMDStorage();
