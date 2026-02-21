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

window.onload = async function () {
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

    document.addEventListener("keydown", async function (e) {
        const sps_par = new URLSearchParams(location.search);
        if (hasClass(e.target, "ui-overview-sidebar-search-input") && e.key == "Enter" && sps_par.has("nav") && sps_par.has("q")) {
            const q_val = sps_par.get("q");
            if (q_val == "?StoreAllNotes") {
                await StoreAllNotes();
                return;
            }
            await searchFromStorage(q_val);
        }
        if (hasClass(e.target, "menu_sideHackMDsearch")) {
            document.querySelectorAll(".sidenav.main-sidenav").forEach(el => el.classList.remove("in"));
            document.querySelectorAll(".sidenav.sidenav-menu").forEach(el => el.classList.remove("in"));
        }
    });
    document.addEventListener("click", async function (e) {
        if (hasClass(e.target, "menu_storeAllNotes")) {
            await StoreAllNotes();
        }
    });
};

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
    const hackmd_url = "https://hackmd.io";
    const hackmd_histories = await fetch(`${hackmd_url}/history`).then(d => d.json()).then(d => d["history"]);
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
    await hackmdStorage.clear();
    for (const idAndNote of idAndNotes) {
        await hackmdStorage.setNote({
            id: idAndNote.id,
            md: idAndNote.md,
            title: idAndNote.title,
            time: idAndNote.time
        });
    }
    await hackmdStorage.setMetadata({
        lastStoredDate: Date.now(),
        noteCount: idAndNotes.length,
        dbVersion: 1
    });
    console.log("Backup of All Notes Finished");
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

    chrome.storage.local.get({ "store": {} }, async (oldResult) => {
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
    });
}

async function showSearchResult(result_ids, queries) {
    const hackmd_url = "https://hackmd.io";
    const containerId = "hackmd-search-results";

    // 既存のコンテナを取得または新規作成
    let container = document.getElementById(containerId);
    let resultUl = document.getElementById("list_ul_searchResult");

    if (!container) {
        // 新規コンテナを作成
        container = document.createElement("div");
        container.id = containerId;

        // タイトル（HackMDのスタイルに合わせる）
        const title = document.createElement("h3");
        title.className = "font-bold text-text-emphasize mb-0 mt-3 flex items-center gap-1.5";
        title.innerHTML = `<span>全文検索結果 (${result_ids.length}件)</span>`;
        container.appendChild(title);

        // 結果リスト（HackMDのグリッドスタイルに合わせる）
        resultUl = document.createElement("ul");
        resultUl.id = "list_ul_searchResult";
        resultUl.className = "list-none grid grid-cols-[repeat(auto-fill,minmax(264px,1fr))] gap-3 pl-0 mb-0 mt-3";
        container.appendChild(resultUl);

        // section.bg-background-defaultの最後の子要素の前に挿入
        const ov = document.querySelector("section.bg-background-default");
        if (!ov) {
            console.error("[HackMD Search] section.bg-background-default not found");
            return;
        }
        const marker = ov.lastElementChild;
        if (marker) {
            marker.insertAdjacentElement("beforebegin", container);
        } else {
            ov.appendChild(container);
        }
    } else {
        // 既存の結果をクリア
        if (resultUl) resultUl.innerHTML = "";
        // タイトルを更新
        const title = container.querySelector("h3");
        if (title) title.innerHTML = `<span>全文検索結果 (${result_ids.length}件)</span>`;
    }

    const notes = await hackmdStorage.getAllNotes();
    const notesMap = {};
    notes.forEach(note => {
        notesMap[note.id] = note;
    });

    // 検索結果を追加
    const fragment = document.createDocumentFragment();
    for (const note_id of result_ids) {
        try {
            const note = notesMap[note_id];
            if (!note) continue;
            const note_title = escape_html(note.title);
            const note_md = note.md;
            const note_url = `${hackmd_url}/${note_id.match(/^[^\?]+(?=\??.*$)/)[0]}`;

            // プリコンパイル済み正規表現を使用
            const searched_parts = Object.keys(queries).reduce((parts_now, q_key) =>
                parts_now.concat(queries[q_key].reduce((acc, q) => {
                    if (q_key == "reg") {
                        // プリコンパイル済み正規表現
                        const matches = note_md.match(q) || [];
                        return acc.concat(matches.map(m => {
                            // プリコンパイル済み正規表現でハイライト
                            const escaped = escape_html(m);
                            return escaped.replace(q, (match) => `<span style="color: orange;">${match}</span>`);
                        }));
                    } else {
                        // 文字列一致（plusクエリ）
                        const pattern = typeof q === "string" ? q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
                        const regex = new RegExp(`(.|\n){0,20}${pattern}(.|\n){0,20}`, "gi");
                        const matches = note_md.match(regex) || [];
                        return acc.concat(matches.map(m =>
                            escape_html(m).split(new RegExp(`(${pattern})`, "gi"))
                                .join(`<span style="color: orange;">$1</span>`)
                        ));
                    }
                }, []))
                , []).join(" ... ") || note_md.slice(0, 100);

            // 結果カードを作成（HackMDのスタイルに合わせる）
            const section = document.createElement("section");
            section.className = "flex flex-col rounded bg-background-subtler px-4 py-3.5 mb-1";

            const a = document.createElement("a");
            a.href = note_url;
            a.className = "text-text-default hocus:text-text-emphasize hocus:no-underline";

            const article = document.createElement("article");
            article.className = "line-clamp-2 max-w-full overflow-hidden overflow-ellipsis whitespace-normal pt-1.5 [overflow-wrap:anywhere] font-semibold leading-normal text-text-emphasize";
            article.textContent = note_title;

            const preview = document.createElement("div");
            preview.className = "text-text-subtler text-sm mt-1 line-clamp-3";
            preview.innerHTML = searched_parts;

            a.appendChild(article);
            a.appendChild(preview);
            section.appendChild(a);
            fragment.appendChild(section);
        } catch (e) {
            console.error("[HackMD Search] Error rendering result:", note_id, e);
        }
    }

    if (resultUl) {
        resultUl.appendChild(fragment);
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
