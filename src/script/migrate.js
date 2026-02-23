"use strict";

/**
 * chrome.storage.localからIndexedDBへのデータ移行スクリプト
 */

/**
 * データ移行を実行
 */
async function migrateToIndexedDB() {
  console.log('[Migration] Starting migration to IndexedDB...');

  try {
    // 1. 既存データを取得
    console.log('[Migration] Fetching data from chrome.storage.local...');
    const oldData = await new Promise(resolve => {
      chrome.storage.local.get({ store: {}, lastStoredDate: 0 }, resolve);
    });

    const notes = Object.values(oldData.store || {});
    const noteCount = notes.length;

    if (noteCount === 0) {
      console.log('[Migration] No notes to migrate.');
      return { success: true, noteCount: 0, migrated: 0 };
    }

    console.log(`[Migration] Found ${noteCount} notes.`);

    // 2. IndexedDBを初期化
    console.log('[Migration] Initializing IndexedDB...');
    await hackmdStorage.init();
    console.log('[Migration] IndexedDB initialized.');

    // 3. データを移行
    console.log('[Migration] Migrating notes...');
    let migrated = 0;
    let failed = 0;

    for (const note of notes) {
      try {
        const noteWithSize = {
          id: note.id,
          md: note.md,
          title: note.title,
          time: note.time,
          size: new Blob([note.md]).size
        };

        await hackmdStorage.setNote(noteWithSize);
        migrated++;

        // 進捗表示（100件ごと）
        if (migrated % 100 === 0) {
          console.log(`[Migration] Progress: ${migrated}/${noteCount}`);
        }
      } catch (error) {
        console.error(`[Migration] Failed to migrate note ${note.id}:`, error);
        failed++;
      }
    }

    console.log(`[Migration] Migrated ${migrated} notes, ${failed} failed.`);

    // 4. メタデータを移行
    console.log('[Migration] Migrating metadata...');
    await hackmdStorage.setMetadata({
      lastStoredDate: oldData.lastStoredDate || Date.now(),
      noteCount: migrated,
      dbVersion: 1,
      migratedAt: Date.now()
    });
    console.log('[Migration] Metadata migrated.');

    // 5. 検証
    console.log('[Migration] Verifying migration...');
    const storedNotes = await hackmdStorage.getAllNotes();
    const metadata = await hackmdStorage.getMetadata();

    if (storedNotes.length !== migrated) {
      throw new Error(`Verification failed: expected ${migrated} notes, got ${storedNotes.length}`);
    }

    console.log('[Migration] Verification successful.');
    console.log(`[Migration] Total notes: ${metadata.noteCount}`);
    console.log(`[Migration] Last stored date: ${new Date(metadata.lastStoredDate).toISOString()}`);

    // 6. 古いデータを削除（オプション）
    // ユーザーに確認を取るか、一定期間残してから削除することを推奨
    // ここでは自動削除は行わず、ログのみ出力
    console.log('[Migration] To remove old data, run: chrome.storage.local.clear()');

    return {
      success: true,
      noteCount,
      migrated,
      failed
    };

  } catch (error) {
    console.error('[Migration] Migration failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 移行状態を確認
 */
async function checkMigrationStatus() {
  try {
    await hackmdStorage.init();
    const metadata = await hackmdStorage.getMetadata();

    if (metadata.migratedAt) {
      console.log(`[Migration] Already migrated at ${new Date(metadata.migratedAt).toISOString()}`);
      console.log(`[Migration] ${metadata.noteCount} notes in IndexedDB.`);
      return { migrated: true, metadata };
    }

    // chrome.storage.localを確認
    const oldData = await new Promise(resolve => {
      chrome.storage.local.get({ store: {} }, resolve);
    });
    const oldNoteCount = Object.keys(oldData.store || {}).length;

    console.log(`[Migration] Not migrated yet.`);
    console.log(`[Migration] ${oldNoteCount} notes in chrome.storage.local.`);

    return { migrated: false, oldNoteCount };

  } catch (error) {
    console.error('[Migration] Failed to check migration status:', error);
    return { migrated: false, error: error.message };
  }
}

/**
 * 古いデータを削除
 */
async function cleanupOldData() {
  console.log('[Migration] Cleaning up old data from chrome.storage.local...');
  await new Promise(resolve => {
    chrome.storage.local.clear(resolve);
  });
  console.log('[Migration] Old data cleaned up.');
}

/**
 * 自動移行を実行
 * 既存ユーザーのchrome.storage.localからIndexedDBへの自動移行
 */
async function autoMigrate() {
  console.log('[Migration] Checking if migration is needed...');

  try {
    // 1. IndexedDBを初期化
    await hackmdStorage.init();

    // 2. メタデータを確認
    const metadata = await hackmdStorage.getMetadata();

    // 既に移行済みの場合はスキップ
    if (metadata.migratedAt) {
      console.log('[Migration] Already migrated, skipping.');
      return { needed: false, reason: 'already_migrated' };
    }

    // 3. chrome.storage.localに既存データがあるか確認
    const oldData = await new Promise(resolve => {
      chrome.storage.local.get({ store: {}, lastStoredDate: 0 }, resolve);
    });
    const oldNotes = Object.values(oldData.store || {});
    const oldNoteCount = oldNotes.length;

    if (oldNoteCount === 0) {
      console.log('[Migration] No existing data in chrome.storage.local.');
      return { needed: false, reason: 'no_data' };
    }

    // 4. IndexedDBが空か確認
    const currentNotes = await hackmdStorage.getAllNotes();
    if (currentNotes.length > 0) {
      console.log('[Migration] IndexedDB already has data, skipping migration.');
      // 既存データがある場合は移行済みとマーク
      await hackmdStorage.setMetadata({
        ...metadata,
        migratedAt: Date.now(),
        noteCount: currentNotes.length
      });
      return { needed: false, reason: 'indexeddb_has_data' };
    }

    // 5. 移行を実行
    console.log(`[Migration] Migration needed. Found ${oldNoteCount} notes in chrome.storage.local.`);
    console.log('[Migration] Starting automatic migration...');

    const result = await migrateToIndexedDB();

    if (result.success) {
      console.log('[Migration] Automatic migration completed successfully.');
      return { needed: true, result };
    } else {
      console.error('[Migration] Automatic migration failed:', result.error);
      return { needed: true, error: result.error };
    }

  } catch (error) {
    console.error('[Migration] Auto migration check failed:', error);
    return { needed: false, error: error.message };
  }
}

// コンソールから実行できるようにグローバル関数をエクスポート
if (typeof window !== 'undefined') {
  window.HackMDMigration = {
    migrate: migrateToIndexedDB,
    checkStatus: checkMigrationStatus,
    cleanup: cleanupOldData
  };
  console.log('[Migration] HackMDMigration API available. Usage:');
  console.log('  await HackMDMigration.migrate()');
  console.log('  await HackMDMigration.checkStatus()');
  console.log('  await HackMDMigration.cleanup()');
}
