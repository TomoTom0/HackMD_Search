"use strict";

// Helper functions to replace jQuery
function hasClass(element, className) {
    return element.classList && element.classList.contains(className);
}
function closest(element, selector) {
    while (element && element.nodeType === 1) {
        if (element.matches(selector)) return element;
        element = element.parentElement;
    }
    return null;
}

const operateStorage = (key = null, storageKey = "sync", operate = "get") => new Promise(resolve => {
    chrome.storage[storageKey][operate](key, resolve);
});

// history API cache
let hackmd_idTime_cache = null;
let hackmd_idTime_cache_time = 0;
const HACKMD_IDTIME_CACHE_TTL = 30000; // 30秒

async function getHackmdIdTime() {
    const now = Date.now();
    if (hackmd_idTime_cache && (now - hackmd_idTime_cache_time) < HACKMD_IDTIME_CACHE_TTL) {
        return hackmd_idTime_cache;
    }

    const hackmd_url = "https://hackmd.io";
    hackmd_idTime_cache = await fetch(`${hackmd_url}/history`).then(d => d.json())
        .then(d => d["history"].reduce((acc, cur) => Object.assign(acc, { [cur.id]: cur.time }), {}));
    hackmd_idTime_cache_time = now;
    return hackmd_idTime_cache;
}

// Chrome拡張機能のcontent scriptではwindow.onloadは既に発火済みの場合があるため直接実行
(async function init() {
    console.log("[HackMD Search] Initializing...");
    addMenuButton();
    StoreToStorage();
    setInterval(StoreToStorage, 30000);

    try {
        await hackmdStorage.init();

        // 自動移行を実行（既存ユーザー向け）
        const migrationResult = await autoMigrate();
        if (migrationResult.needed && migrationResult.result) {
            console.log(`[HackMD Search] Migration completed: ${migrationResult.result.migrated} notes migrated.`);
        }

        const metadata = await hackmdStorage.getMetadata();
        if (Date.now() - metadata.lastStoredDate > 30 * 86400 * 1000) {
            await StoreAllNotes();
        }
    } catch (error) {
        console.error('Failed to initialize storage:', error);
    }

    // URLパラメータにnav=search&q=xxxがある場合は自動的に検索を実行（検索結果ページ）
    const sps_par = new URLSearchParams(location.search);
    if (sps_par.get("nav") === "search" && sps_par.has("q")) {
        const q_val = sps_par.get("q");
        if (q_val && q_val !== "?StoreAllNotes") {
            console.log("[HackMD Search] Auto-searching on search results page for:", q_val);
            await searchFromStorage(q_val);
        }

        // 広告非表示設定を確認して、必要に応じて広告を非表示にする
        chrome.storage.sync.get({ hideUpgradeAds: true }, function(items) {
            if (items.hideUpgradeAds) {
                hideUpgradeAds();
            }
        });
    }

    // キャプチャフェーズでイベントを取得して、HackMD標準の検索機能より先に動作するようにする
    document.addEventListener("keydown", async function (e) {
        if (hasClass(e.target, "ui-overview-sidebar-search-input") && e.key == "Enter") {
            const q_val = e.target.value.trim();
            // ?StoreAllNotesコマンドの場合のみ、デフォルトの動作を抑制
            if (q_val == "?StoreAllNotes") {
                e.preventDefault();
                e.stopPropagation();
                await StoreAllNotes();
                return;
            }
            // それ以外の場合は、HackMD標準の検索機能を動作させる（ページ遷移する）
        }
        if (hasClass(e.target, "menu_sideHackMDsearch")) {
            document.querySelectorAll(".sidenav.main-sidenav").forEach(el => el.classList.remove("in"));
            document.querySelectorAll(".sidenav.sidenav-menu").forEach(el => el.classList.remove("in"));
        }
    }, true); // キャプチャフェーズでイベントを取得
    document.addEventListener("click", async function (e) {
        if (hasClass(e.target, "menu_storeAllNotes")) {
            await StoreAllNotes();
        }
    });

    // URLの変更を監視して、ページ遷移時に検索結果コンテナを再配置
    let lastUrl = location.href;
    setInterval(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            console.log("[HackMD Search] URL changed:", url);
            // ページ遷移後の処理
            setTimeout(() => {
                // 検索結果ページ（?nav=search&q=xxx）に遷移した場合は検索を実行
                const sps_par = new URLSearchParams(location.search);
                if (sps_par.get("nav") === "search" && sps_par.has("q")) {
                    const q_val = sps_par.get("q");
                    if (q_val && q_val !== "?StoreAllNotes") {
                        console.log("[HackMD Search] Auto-searching on URL change for:", q_val);
                        searchFromStorage(q_val);
                    }
                    // 広告非表示設定を確認
                    chrome.storage.sync.get({ hideUpgradeAds: false }, function(items) {
                        if (items.hideUpgradeAds) {
                            hideUpgradeAds();
                        }
                    });
                } else {
                    // 検索結果ページ以外では、検索結果コンテナを削除
                    const container = document.getElementById("hackmd-search-results");
                    if (container) {
                        console.log("[HackMD Search] Removing container on non-search page");
                        container.remove();
                    }
                }
            }, 500);
        }
    }, 1000);

    console.log("[HackMD Search] Initialization completed");
})();


function escape_html(str) {
    if (!str) return "";
    return str.replace(/[<>&"'`]/g, (match) => {
        const escape = {
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&#39;',
            '`': '&#x60;'
        };
        return escape[match];
    });
}

function showNotification(message, duration = 3000) {
    // 既存の通知を削除
    const existingNotification = document.getElementById("hackmd-search-notification");
    if (existingNotification) {
        existingNotification.remove();
    }

    // 通知要素を作成
    const notification = document.createElement("div");
    notification.id = "hackmd-search-notification";
    notification.className = "toast toast-success";
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        background: #4caf50;
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        font-size: 14px;
        animation: slideIn 0.3s ease-out;
    `;

    // アニメーション用のスタイルを追加
    if (!document.getElementById("hackmd-search-notification-style")) {
        const style = document.createElement("style");
        style.id = "hackmd-search-notification-style";
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes fadeOut {
                from {
                    opacity: 1;
                }
                to {
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    notification.textContent = message;
    document.body.appendChild(notification);

    // 指定時間後に通知を削除
    setTimeout(() => {
        notification.style.animation = "fadeOut 0.3s ease-out";
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

function addMenuButton() {
    const input_head = "全文検索";
    const menu_ul = document.querySelector("ul .dropdown-menu.list[aria-label=メニュー]");
    if (!menu_ul) return;
    const sep = document.createElement("li");
    sep.setAttribute("role", "presentation");
    sep.setAttribute("aria-hidden", "true");
    sep.className = "divider";
    sep.id = "sep_TOC";
    const heading = document.createElement("li");
    heading.className = "dropdown-header";
    heading.append(input_head);
    menu_ul.appendChild(sep);
    menu_ul.appendChild(heading);

    const menu_side_ul = document.querySelector(".sidenav.sidenav-menu");
    if (!menu_side_ul) return;
    const side_heading = document.createElement("div");
    side_heading.className = "divider-header";
    side_heading.append(input_head);
    menu_side_ul.appendChild(side_heading);

    const input_comps = [{ class: "menu_storeAllNotes", text: "Store All Notes" }];
    for (const input_comp of input_comps) {
        // menu comp
        const comp = document.createElement("li");
        comp.setAttribute("role", "presentation");
        const comp_a = document.createElement("a");
        comp_a.setAttribute("role", "menuitem");
        comp_a.className = input_comp.class;
        comp_a.href = "#";
        comp_a.tabIndex = -1;
        comp_a.append(input_comp.text);
        comp.appendChild(comp_a);
        menu_ul.appendChild(comp);

        // side menu comp
        const side_comp = document.createElement("a");
        side_comp.className = `sidenav-item menu_sideHackMDsearch ${input_comp.class}`;
        side_comp.tabIndex = -1;
        side_comp.setAttribute("data-toggle", "modal");
        side_comp.setAttribute("data-target", "#namedRevisionModal");
        const side_span = document.createElement("span");
        side_span.append(input_comp.text);
        side_comp.appendChild(side_span);
        menu_side_ul.appendChild(side_comp);
    }
}

async function StoreToStorage() {
    if (/\?nav=/.test(location.href)) return;
    const titleEl = document.querySelector("head > title");
    if (!titleEl) return;
    const titleText = titleEl.textContent.match(/^.*(?=\s-\sHackMD$)/);
    if (!titleText) return;
    const note_title = titleText[0].replace(/\s|\//g, "_");
    const note_idTmp = location.href.match(/(?<=hackmd.io\/)[^\?#@]+/);
    if (!note_idTmp) return;
    const note_id = note_idTmp[0];
    const hackmd_url = "https://hackmd.io";
    const note_md = await fetch(`${hackmd_url}/${note_id}/download`).then(d => d.text());
    await hackmdStorage.setNote({
        id: note_id,
        md: note_md,
        title: note_title,
        time: Date.now()
    });
}

async function StoreAllNotes() {
    console.log("[HackMD Search] StoreAllNotes started");
    const hackmd_url = "https://hackmd.io";
    const hackmd_histories = await fetch(`${hackmd_url}/history`).then(d => d.json()).then(d => d["history"]);
    console.log("[HackMD Search] Fetched histories:", hackmd_histories.length, "items");
    let idAndNotes = [];
    for (const history of hackmd_histories) {
        const orig_id = history.id;
        const id_tmpTmp = orig_id.match(/^[^\?@#]+(?=\??.*$)/);
        if (!id_tmpTmp) continue;
        const id_tmp = id_tmpTmp[0];
        if (idAndNotes.map(d => d.id).indexOf(id_tmp) != -1 || /^@|\//.test(id_tmp)) continue;
        idAndNotes.push({
            id: id_tmp,
            title: history.text,
            md: await fetch(`${hackmd_url}/${id_tmp}/download`).then(d => d.text()),
            time: history.time
        });
    }
    console.log("[HackMD Search] Filtered notes:", idAndNotes.length, "items");
    await hackmdStorage.clear();
    console.log("[HackMD Search] IndexedDB cleared");
    for (const idAndNote of idAndNotes) {
        await hackmdStorage.setNote({
            id: idAndNote.id,
            md: idAndNote.md,
            title: idAndNote.title,
            time: idAndNote.time
        });
    }
    console.log("[HackMD Search] All notes saved to IndexedDB");
    await hackmdStorage.setMetadata({
        lastStoredDate: Date.now(),
        noteCount: idAndNotes.length,
        dbVersion: 1
    });

    // 保存を確認
    const savedNotes = await hackmdStorage.getAllNotes();
    console.log("[HackMD Search] Verified notes in IndexedDB:", savedNotes.length, "items");

    console.log("Backup of All Notes Finished");
    showNotification(`${idAndNotes.length}件のノートを保存しました`);
}

function searchQuerySplit(q) {
    const replace_obj = { "\\\\": "__BACKSLASH__", '\\"': "__WQ__" };
    const escaped_q = Object.keys(replace_obj).reduce((acc, key) => acc.split(key).join(replace_obj[key]), q);
    const escaped_q2 = escaped_q.replace(/\s+/g, " ").replace(/^"/g, ' "').split(' "').map((d, ind) => {
        if (ind % 2 == 0) return d;
        else return d.replace(/ /g, "__SPACE__").replace(/"$/, "");
    }).join("");
    return Object.keys(replace_obj).reduce((acc, key) => acc.split(replace_obj[key]).join(key), escaped_q2)
        .split(" ").map(d => d.replace(/__SPACE__/g, " "));
}

async function searchFromStorage(q_in = "") {
    const queries_tmp = searchQuerySplit(q_in);
    const queries = {
        minus: queries_tmp.filter(d => /^-/.test(d)).map(d => d.slice(1)),
        reg: queries_tmp.filter(d => /^reg:/.test(d)).map(d => d.slice(4)),
        reg_compiled: [],
        plus: queries_tmp.filter(d => !/^-|^reg:/.test(d)).map(d => d.replace(/^\\(?=(-|reg:))/, ""))
    };
    // プリコンパイル正規表現
    queries.reg_compiled = queries.reg.map(pattern => {
        try {
            return new RegExp(pattern);
        } catch (e) {
            console.error(`Invalid regex: ${pattern}`, e);
            return null;
        }
    }).filter(re => re !== null);

    const hackmd_idTime = await getHackmdIdTime();
    const notes = await hackmdStorage.getAllNotes();

    // ノートIDをキーにしたマップを作成
    const notesMap = {};
    notes.forEach(note => {
        notesMap[note.id] = note;
    });

    const result_ids = Object.keys(queries).reduce((acc, key) => {
        if (key == "reg_compiled") return acc; // プリコンパイル済みを使用
        return acc.filter(id => {
            if (!notesMap[id]) return false;
            return queries[key].every((q) => {
                if (key == "plus") return notesMap[id].md.indexOf(q) != -1;
                if (key == "minus") return notesMap[id].md.indexOf(q) == -1;
                return true;
            });
        });
    }, Object.keys(notesMap))
        .filter(id => {
            if (!notesMap[id]) return false;
            return queries.reg_compiled.every(re => re.test(notesMap[id].md));
        })
        .sort((a, b) => -(hackmd_idTime[a] - hackmd_idTime[b]));
    await showSearchResult(result_ids, { "plus": queries.plus, "reg": queries.reg_compiled });
}

// グローバル変数：ページング状態
let searchResultCurrentPage = 1;
let searchResultPageSize = 50; // デフォルト値
let searchResultTotalPages = 1;
let currentSearchResultIds = [];
let currentSearchQueries = {};

async function getSearchSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({ searchPageSize: 50 }, (result) => {
            searchResultPageSize = result.searchPageSize;
            resolve(result.searchPageSize);
        });
    });
}

function hideUpgradeAds() {
    // 広告セクションを非表示にする
    // 「Upgrade to Prime」広告を含むセクションを探す
    const adSections = document.querySelectorAll('section.bg-background-primary-subtler');
    adSections.forEach(section => {
        const heading = section.querySelector('h4');
        if (heading && heading.textContent.includes('Upgrade to Prime')) {
            section.style.display = 'none';
            console.log("[HackMD Search] Hidden upgrade ad");
        }
    });
}

function insertSearchResultContainer(container) {
    // 常に適切な要素に挿入する（ページタイプに関わらず）
    // まず ui-next-content-neo要素を探す（一覧ページ、検索結果ページなど）
    let neoElement = document.querySelector('.ui-next-content-neo');
    if (neoElement) {
        // navbarの後に挿入するため、navbarを探す
        const navbar = neoElement.querySelector('.ui-next-navbar-neo-container');
        if (navbar && navbar.nextSibling) {
            // navbarの次の要素（コンテンツエリア）を取得
            const contentArea = navbar.nextSibling;
            // sticky要素を探して、その後に挿入
            const stickyElement = contentArea.querySelector('.sticky');
            if (stickyElement && stickyElement.nextSibling) {
                contentArea.insertBefore(container, stickyElement.nextSibling);
            } else if (stickyElement) {
                // sticky要素が最後の場合
                contentArea.appendChild(container);
            } else if (contentArea.firstElementChild) {
                contentArea.insertBefore(container, contentArea.firstElementChild);
            } else {
                contentArea.appendChild(container);
            }
        } else {
            neoElement.insertBefore(container, neoElement.firstElementChild);
        }
    } else {
        // ui-next-content-neoがない場合は、ui-contentクラスを持つ要素を探す（ノートページ）
        const uiContent = document.querySelector('.ui-content');
        if (uiContent) {
            uiContent.insertBefore(container, uiContent.firstElementChild);
        } else {
            // フォールバック: body直下に追加
            document.body.appendChild(container);
        }
    }
}

async function showSearchResult(result_ids, queries) {
    console.log("[HackMD Search] showSearchResult called, result_ids:", result_ids.length, "queries:", queries);
    const hackmd_url = "https://hackmd.io";
    const containerId = "hackmd-search-results";

    // 設定を取得
    await getSearchSettings();

    // plusクエリの正規表現をプリコンパイル（パフォーマンス最適化）
    const plus_compiled = (queries.plus || []).map(q => {
        const pattern = typeof q === "string" ? q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
        return {
            matchRegex: new RegExp(`(.|\n){0,20}${pattern}(.|\n){0,20}`, "gi"),
            highlightRegex: new RegExp(`(${pattern})`, "gi")
        };
    });

    // 現在の検索結果を保存（プリコンパイル済み正規表現を含む）
    currentSearchResultIds = result_ids;
    currentSearchQueries = {
        ...queries,
        plus_compiled
    };
    searchResultCurrentPage = 1;
    searchResultTotalPages = Math.ceil(result_ids.length / searchResultPageSize);

    // 既存のコンテナを取得または新規作成
    let container = document.getElementById(containerId);
    let resultUl = document.getElementById("list_ul_searchResult");

    if (!container) {
        // 新規コンテナを作成
        container = document.createElement("div");
        container.id = containerId;
        // HackMDのスタイルに合わせてpaddingとmarginを設定
        container.style.cssText = "display: block; width: 100%; padding: 0 24px; margin: 1rem 0;";

        // タイトル（HackMDのスタイルに合わせる）
        const title = document.createElement("h3");
        title.className = "font-bold text-text-emphasize mb-0 mt-3 flex items-center gap-1.5";
        title.style.cssText = "font-size: 1.25rem; font-weight: bold; margin: 1rem 0 0.5rem 0; color: rgb(244, 244, 245);";
        title.innerHTML = `<span>全文検索結果 (${result_ids.length}件)</span>`;
        container.appendChild(title);

        // ページング情報エリア
        const pageInfo = document.createElement("div");
        pageInfo.id = "hackmd-search-page-info";
        pageInfo.className = "text-text-subtler text-sm";
        pageInfo.style.cssText = "color: rgb(161, 161, 170); font-size: 0.875rem; margin: 0.5rem 0;";
        container.appendChild(pageInfo);

        // 結果リスト（HackMDのグリッドスタイルに合わせる）
        resultUl = document.createElement("ul");
        resultUl.id = "list_ul_searchResult";
        resultUl.className = "list-none grid grid-cols-[repeat(auto-fill,minmax(264px,1fr))] gap-3 pl-0 mb-0 mt-3";
        resultUl.style.cssText = "list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(264px, 1fr)); gap: 0.75rem; padding: 0; margin: 0.75rem 0 0 0;";
        container.appendChild(resultUl);

        // ページングコントロール
        const pagingControls = document.createElement("div");
        pagingControls.id = "hackmd-search-paging";
        pagingControls.className = "flex items-center gap-2 mt-3";
        pagingControls.style.cssText = "display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem;";

        // 前へボタン
        const prevButton = document.createElement("button");
        prevButton.id = "hackmd-search-prev";
        prevButton.className = "btn btn-sm btn-default";
        prevButton.textContent = "前へ";
        prevButton.style.cssText = "padding: 0.375rem 0.75rem; font-size: 0.875rem; border-radius: 0.25rem; background-color: rgb(60, 60, 65); color: rgb(244, 244, 245); border: 1px solid rgba(255, 255, 255, 0.1); cursor: pointer;";
        prevButton.addEventListener("click", () => goToPage(searchResultCurrentPage - 1));
        pagingControls.appendChild(prevButton);

        // ページ番号表示
        const pageInfo2 = document.createElement("span");
        pageInfo2.id = "hackmd-search-page-info-2";
        pageInfo2.className = "text-text-subtler text-sm";
        pageInfo2.style.cssText = "color: rgb(161, 161, 170); font-size: 0.875rem;";
        pagingControls.appendChild(pageInfo2);

        // 次へボタン
        const nextButton = document.createElement("button");
        nextButton.id = "hackmd-search-next";
        nextButton.className = "btn btn-sm btn-default";
        nextButton.textContent = "次へ";
        nextButton.style.cssText = "padding: 0.375rem 0.75rem; font-size: 0.875rem; border-radius: 0.25rem; background-color: rgb(60, 60, 65); color: rgb(244, 244, 245); border: 1px solid rgba(255, 255, 255, 0.1); cursor: pointer;";
        nextButton.addEventListener("click", () => goToPage(searchResultCurrentPage + 1));
        pagingControls.appendChild(nextButton);

        container.appendChild(pagingControls);

        // コンテナを配置
        insertSearchResultContainer(container);
    } else {
        // 既存の結果をクリア
        console.log("[HackMD Search] Reusing existing container");
        if (resultUl) resultUl.innerHTML = "";
        // タイトルを更新
        const title = container.querySelector("h3");
        if (title) title.innerHTML = `<span>全文検索結果 (${result_ids.length}件)</span>`;

        // ページングコントロールを取得
        const prevButton = document.getElementById("hackmd-search-prev");
        const nextButton = document.getElementById("hackmd-search-next");
        if (prevButton) prevButton.addEventListener("click", () => goToPage(searchResultCurrentPage - 1));
        if (nextButton) nextButton.addEventListener("click", () => goToPage(searchResultCurrentPage + 1));
    }

    // 現在のページの結果のみレンダリング
    renderCurrentPage();
    console.log("[HackMD Search] showSearchResult completed");
}

async function renderCurrentPage() {
    const container = document.getElementById("hackmd-search-results");
    if (!container) return;

    const resultUl = document.getElementById("list_ul_searchResult");
    if (!resultUl) return;

    // 既存の結果をクリア
    resultUl.innerHTML = "";

    // ページング情報を更新
    const startIdx = (searchResultCurrentPage - 1) * searchResultPageSize;
    const endIdx = Math.min(startIdx + searchResultPageSize, currentSearchResultIds.length);
    const pageResultIds = currentSearchResultIds.slice(startIdx, endIdx);

    // ページング情報を更新
    const pageInfo = document.getElementById("hackmd-search-page-info");
    const pageInfo2 = document.getElementById("hackmd-search-page-info-2");
    const infoText = `${searchResultCurrentPage} / ${searchResultTotalPages} ページ (${currentSearchResultIds.length}件中 ${startIdx + 1}-${endIdx}件を表示)`;
    if (pageInfo) pageInfo.textContent = infoText;
    if (pageInfo2) pageInfo2.textContent = infoText;

    // ボタンの有効/無効を更新
    const prevButton = document.getElementById("hackmd-search-prev");
    const nextButton = document.getElementById("hackmd-search-next");
    if (prevButton) prevButton.disabled = searchResultCurrentPage <= 1;
    if (nextButton) nextButton.disabled = searchResultCurrentPage >= searchResultTotalPages;
    if (prevButton) prevButton.style.opacity = searchResultCurrentPage <= 1 ? "0.5" : "1";
    if (nextButton) nextButton.style.opacity = searchResultCurrentPage >= searchResultTotalPages ? "0.5" : "1";

    const hackmd_url = "https://hackmd.io";
    // ページに表示するノートのみを取得（全ノート読み込みを回避）
    const pageNotes = await Promise.all(pageResultIds.map(id => hackmdStorage.getNote(id)));
    const notesMap = {};
    pageNotes.forEach(note => {
        if (note) notesMap[note.id] = note;
    });

    // 検索結果を追加
    const fragment = document.createDocumentFragment();
    for (const note_id of pageResultIds) {
        try {
            const note = notesMap[note_id];
            if (!note) continue;
            const note_title = escape_html(note.title);
            const note_md = note.md;
            const note_url = `${hackmd_url}/${note_id.match(/^[^\?]+(?=\??.*$)/)[0]}`;

            // プリコンパイル済み正規表現を使用
            const searched_parts = [
                // plusクエリ: プリコンパイル済み正規表現を使用
                ...(currentSearchQueries.plus_compiled || []).reduce((acc, { matchRegex, highlightRegex }) => {
                    const matches = note_md.match(matchRegex) || [];
                    return acc.concat(matches.map(m =>
                        escape_html(m).replace(highlightRegex, `<span style="color: orange;">$1</span>`)
                    ));
                }, []),
                // regクエリ: プリコンパイル済み正規表現を使用
                ...(currentSearchQueries.reg || []).reduce((acc, regex) => {
                    const matches = note_md.match(regex) || [];
                    return acc.concat(matches.map(m => {
                        const escaped = escape_html(m);
                        return escaped.replace(regex, (match) => `<span style="color: orange;">${match}</span>`);
                    }));
                }, [])
            ].join(" ... ") || note_md.slice(0, 100);

            // 結果カードを作成（HackMDのスタイルに合わせる）
            const section = document.createElement("li");
            section.style.cssText = "display: list-item; list-style: none;";

            const div = document.createElement("div");
            div.style.cssText = "display: block;";

            const a = document.createElement("a");
            a.href = note_url;
            a.style.cssText = "display: block; text-decoration: none; color: rgb(212, 212, 216); padding: 0.625rem; border-radius: 0.375rem; border: 1px solid rgba(255, 255, 255, 0.1); transition: background-color 0.15s, border-color 0.15s;";
            // hover効果を追加
            a.addEventListener('mouseenter', function() {
                this.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                this.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            });
            a.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent';
                this.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            });

            const article = document.createElement("article");
            article.className = "px-1 text-left text-normal leading-normal text-text-emphasize line-clamp-2 max-w-full overflow-hidden overflow-ellipsis whitespace-normal [overflow-wrap:anywhere]";
            article.style.cssText = "padding-left: 0.25rem; text-align: left; color: rgb(244, 244, 245); display: flow-root; overflow: hidden; overflow-ellipsis; white-space: normal;";
            article.textContent = note_title;

            const preview = document.createElement("div");
            preview.className = "text-text-subtler text-sm mt-1 line-clamp-3";
            preview.style.cssText = "color: rgb(161, 161, 170); font-size: 0.875rem; margin-top: 0.25rem; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;";
            preview.innerHTML = searched_parts;

            a.appendChild(article);
            a.appendChild(preview);
            div.appendChild(a);
            section.appendChild(div);
            fragment.appendChild(section);
        } catch (e) {
            console.error("[HackMD Search] Error rendering result:", note_id, e);
        }
    }

    resultUl.appendChild(fragment);
    console.log("[HackMD Search] Current page rendered, items:", resultUl.children.length);
}

function goToPage(pageNum) {
    if (pageNum < 1 || pageNum > searchResultTotalPages) return;
    searchResultCurrentPage = pageNum;
    renderCurrentPage();

    // コンテナまでスクロール
    const container = document.getElementById("hackmd-search-results");
    if (container) {
        container.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

// Not used
async function downloadHTML() {
    const html = document.createElement("html");
    html.lang = "ja";
    const head = document.head.cloneNode(true);
    const body = document.createElement("body");
    body.style.backgroundColor = "white";
    body.style.paddingTop = "51px";
    const row = document.createElement("div");
    row.className = "row-ui-content";
    const area = document.createElement("div");
    area.className = "ui-view-area";
    const doc = document.querySelector("#doc");
    if (doc) area.appendChild(doc.cloneNode(true));
    body.appendChild(row.appendChild(area));
    // scripts
    document.querySelectorAll("div.ui-content ~ *").forEach(obj => body.appendChild(obj.cloneNode(true)));
    html.appendChild(head);
    html.appendChild(body);
    const content = html.outerHTML;
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = "markdown.html";
    a.href = url;
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
